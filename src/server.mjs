import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SessionManager, SessionError } from './session-manager.mjs';
import { createLiveProvider } from './live-provider.mjs';
import { CustomerStore, CustomerError } from './customers.mjs';
import { createTelephony, TelephonyError } from './telephony.mjs';
import { TOPICS, isSupportedTopic, openingForTopic } from './conversation-policy.mjs';
import { knowledgeVersion } from './hpe-knowledge.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/customers.js', ['customers.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function reply(response, status, value, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new SessionError('Content-Type must be application/json.', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw new SessionError('Request exceeds 64 KiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SessionError('Invalid JSON.', 400); }
}

export function createServer({ provider, customerStore, telephony, port = 3000, publicOrigin, ...managerOptions } = {}) {
  const manager = new SessionManager(provider, managerOptions);
  let callStarting = false;
  const phoneBusy = () => callStarting || (telephony?.status().call && !telephony.status().call.finalized) || customerStore?.hasUnresolvedCalls();
  // Host header -> the only Origin accepted for it. A reverse proxy adds one HTTPS origin.
  const origins = new Map([`localhost:${port}`, `127.0.0.1:${port}`].map((host) => [host, `http://${host}`]));
  if (publicOrigin) { const url = new URL(publicOrigin); origins.set(url.host, url.origin); }
  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    try {
      const host = request.headers.host;
      if (!origins.has(host)) return reply(response, 403, { error: 'Unexpected request host.' });
      const origin = request.headers.origin;
      const documentNavigation = request.method === 'GET' && request.url === '/' && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
      if ((origin && origin !== origins.get(host)) || (!documentNavigation && request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) return reply(response, 403, { error: 'Unexpected request origin.' });
      if (request.method === 'GET' && request.url === '/api/customers') {
        if (!customerStore) throw new CustomerError('Customer storage is unavailable.', 503);
        return reply(response, 200, { customers: customerStore.list() });
      }
      if (request.method === 'GET' && request.url === '/api/topics') return reply(response, 200, { topics: Object.entries(TOPICS).map(([id, name]) => ({ id, name, language: 'de-AT', opening: openingForTopic(id), knowledgeVersion })) });
      if (request.method === 'GET' && request.url === '/api/calling-status') return reply(response, 200, telephony ? {
        ...telephony.status(),
        ...(customerStore?.hasUnresolvedCalls() && !telephony.status().call ? { configured: false, reason: 'Earlier call closure requires reconciliation.' } : {}),
      } : { configured: false, reason: 'Telephone provider is not configured.', provider: null });
      if (request.method === 'GET' && request.url === '/api/status') return reply(response, 200, manager.status());
      if (request.method === 'GET' && files.has(request.url)) {
        const [file, type] = files.get(request.url);
        return reply(response, 200, await readFile(new URL(`../public/${file}`, import.meta.url)), type);
      }
      if (request.method !== 'POST' || !['/api/session', '/api/heartbeat', '/api/close', '/api/customers', '/api/customers/delete', '/api/calls', '/api/calls/stop'].includes(request.url)) return reply(response, 404, { error: 'Not found.' });
      if (origin !== origins.get(host)) return reply(response, 403, { error: 'Unexpected request origin.' });
      const body = await readJson(request);
      if (request.url === '/api/calls/stop') {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new CustomerError('No stop parameters are accepted.');
        if (!telephony) throw new CustomerError('Telephone provider is not configured.', 503);
        return reply(response, 200, await telephony.stop());
      }
      if (['/api/customers', '/api/customers/delete', '/api/calls'].includes(request.url)) {
        if (!customerStore) throw new CustomerError('Customer storage is unavailable.', 503);
        if (request.url === '/api/customers') return reply(response, 201, { customer: customerStore.create(body) });
        const key = request.url === '/api/calls' ? 'customerId' : 'id';
        const fields = request.url === '/api/calls' ? ['customerId', 'topicId', 'requestId'] : ['id'];
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body[key] !== 'string' || Object.keys(body).some((field) => !fields.includes(field))) throw new CustomerError('A customer ID is required.');
        if (request.url === '/api/customers/delete') {
          if (phoneBusy()) throw new CustomerError('Cannot delete contacts while a call is unresolved.', 409);
          customerStore.delete(body.id);
          return reply(response, 200, { deleted: true });
        }
        const selected = customerStore.get(body.customerId);
        if (!selected) throw new CustomerError('Customer not found.', 404);
        if (!selected.contactAllowed) throw new CustomerError('Contact permission has not been recorded for this customer.', 403);
        if (!telephony) throw new CustomerError('Telephone provider is not configured. No call was placed.', 503);
        if (!isSupportedTopic(body.topicId) || typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/iu.test(body.requestId)) throw new CustomerError('A supported topic and unique request ID are required.');
        const prior = customerStore.callRequest(body.requestId);
        if (prior) {
          if (prior.customerId !== selected.id || prior.topicId !== body.topicId) throw new CustomerError('Request ID belongs to another conversation.', 409);
          if (!prior.result) throw new CustomerError('Earlier request remains unresolved; automatic retry is blocked.', 409);
          return reply(response, 200, { call: prior.result });
        }
        if (phoneBusy() || !['idle', 'closed'].includes(manager.state)) throw new CustomerError('A conversation is active or unresolved.', 409);
        callStarting = true;
        try {
          customerStore.reserveCallRequest(body.requestId, selected.id, body.topicId);
          const call = await telephony.start({ customerId: selected.id, mobile: selected.mobile, topicId: body.topicId });
          customerStore.completeCallRequest(body.requestId, call);
          return reply(response, 201, { call });
        } catch (error) {
          const call = telephony.status().call;
          if (call?.finalized && call.customerId === selected.id) {
            customerStore.completeCallRequest(body.requestId, call);
          } else if (error instanceof TelephonyError && error.status === 400 && !call) {
            customerStore.completeCallRequest(body.requestId, { customerId: selected.id, topicId: body.topicId, state: 'failed', finalized: true });
          }
          throw error;
        } finally { callStarting = false; }
      }
      if (request.url === '/api/session') {
        if (typeof body?.sdp !== 'string' || !body.sdp.startsWith('v=0') || body.sdp.length < 10 || body.permission !== true || !isSupportedTopic(body.topicId) || Object.keys(body).some((key) => !['sdp', 'topicId', 'permission'].includes(key))) throw new SessionError('A valid SDP offer, supported topic and explicit test opt-in are required.', 400);
        if (phoneBusy()) throw new SessionError('A telephone call is active or unresolved.');
        const result = await manager.create(body.sdp);
        if (response.destroyed) { await manager.close(result.session.id); return; }
        return reply(response, 201, result);
      }
      if (typeof body?.id !== 'string' || Object.keys(body).some((key) => key !== 'id')) throw new SessionError('A session ID is required.', 400);
      const result = request.url === '/api/heartbeat' ? manager.heartbeat(body.id) : await manager.close(body.id);
      return reply(response, 200, result);
    } catch (error) {
      const known = error instanceof SessionError || error instanceof CustomerError || error instanceof TelephonyError;
      if (!response.destroyed) reply(response, known ? error.status : 500, { error: known ? error.message : 'Request failed.' });
    }
  });
  server.sessionManager = manager;
  server.shutdown = async () => {
    const stopped = new Promise((resolve) => server.close(resolve));
    await manager.shutdown();
    await telephony?.shutdown();
    server.closeAllConnections();
    await stopped;
    customerStore?.close();
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { loadCredential } = await import('./credentials.mjs');
    const apiKey = await loadCredential();
    const provider = createLiveProvider({ apiKey });
    const maxDurationSeconds = process.env.MAX_SESSION_SECONDS === undefined ? 60 : Number(process.env.MAX_SESSION_SECONDS);
    const customerStore = new CustomerStore(fileURLToPath(new URL('../.private/customers.sqlite', import.meta.url)));
    let telephony;
    // Off unless an operator explicitly configures the private callback service.
    if (process.env.ENABLE_TELEPHONY === 'true') {
      const { loadTwilioCredentials } = await import('./twilio-credentials.mjs');
      const credentials = await loadTwilioCredentials(process.env.TWILIO_CREDENTIAL_FILE);
      const { createCallReporter } = await import('./call-report.mjs');
      const onFinished = createCallReporter({ apiKey, customerStore, directory: fileURLToPath(new URL('../reports/', import.meta.url)) });
      telephony = createTelephony({ ...credentials, apiKey, publicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL,
        region: process.env.TWILIO_REGION || 'ie1', edge: process.env.TWILIO_EDGE || 'dublin',
        maxDurationSeconds: process.env.MAX_CALL_SECONDS === undefined ? 300 : Number(process.env.MAX_CALL_SECONDS),
        onState: (state) => customerStore.recordCall(state), onSuppression: (id) => customerStore.suppress(id), onFinished });
      await new Promise((resolve, reject) => {
        telephony.gateway.once('error', reject);
        telephony.gateway.listen(3001, process.env.LISTEN_HOST || '127.0.0.1', resolve);
      });
    }
    const server = createServer({ provider, customerStore, telephony, maxDurationSeconds, publicOrigin: process.env.PUBLIC_UI_ORIGIN });
    server.on('error', () => { customerStore.close(); console.error('Local server failed to start.'); process.exitCode = 1; });
    server.listen(3000, process.env.LISTEN_HOST || '127.0.0.1', () => console.log('Voice test available at http://127.0.0.1:3000'));
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await server.shutdown();
      if (server.sessionManager.state === 'unconfirmed') {
        console.error('Session closure remains unconfirmed. Verify usage before restarting.');
        process.exitCode = 1;
      }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch {
    console.error('Startup failed. Check credential configuration and session duration.');
    process.exitCode = 1;
  }
}
