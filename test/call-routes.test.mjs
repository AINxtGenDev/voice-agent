import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { CustomerStore } from '../src/customers.mjs';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'voice-routes-'));
  const store = new CustomerStore(join(root, 'private', 'customers.sqlite'));
  let starts = 0;
  let current = null;
  const telephony = {
    status: () => ({ configured: true, provider: 'twilio', reason: null, call: current }),
    async start({ customerId, topicId }) {
      starts++;
      current = { id: 'fixture-call', customerId, topicId, state: 'dialing', liveState: 'not-started', finalized: false };
      store.recordCall(current);
      return current;
    },
    async stop() { if (current) { current = { ...current, state: 'completed', finalized: true }; store.recordCall(current); } return this.status(); },
    async shutdown() {},
  };
  const server = createServer({ customerStore: store, telephony, provider: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { Host: 'localhost:3000', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const customer = store.create({ name: 'Synthetic contact', mobile: '+436641234567', product: 'HPE Private Cloud AI', contactAllowed: true });
  return { store, customer, telephony, starts: () => starts, request,
    cleanup: async () => { await server.shutdown(); rmSync(root, { recursive: true, force: true }); } };
}
const requestId = '11111111-1111-4111-8111-111111111111';
const topicId = 'hpe-private-cloud-ai';

test('call start resolves destination server-side and retries cannot redial', async () => {
  const f = await fixture();
  try {
    const body = { customerId: f.customer.id, topicId, requestId };
    assert.equal((await f.request('/api/calls', { ...body, mobile: '+436641234568' })).status, 400);
    assert.equal((await f.request('/api/calls', { ...body, topicId: 'injected' })).status, 400);
    assert.equal((await f.request('/api/calls', { ...body, topicId: '' })).status, 400);
    assert.equal((await f.request('/api/calls', { customerId: f.customer.id, requestId })).status, 400);
    assert.equal(f.starts(), 0);
    assert.equal((await f.request('/api/calls', body)).status, 201);
    assert.equal((await f.request('/api/calls', body)).status, 200);
    assert.equal(f.starts(), 1);
    assert.equal((await f.request('/api/customers/delete', { id: f.customer.id })).status, 409);
    const session = { sdp: 'v=0\r\no=fixture', topicId, permission: true };
    assert.equal((await f.request('/api/session', session)).status, 409);
    assert.equal((await f.request('/api/calls/stop', {})).body.call.finalized, true);
    assert.equal((await f.request('/api/calls', body)).status, 200);
    assert.equal(f.starts(), 1);
  } finally { await f.cleanup(); }
});

test('unresolved durable reservation blocks new IDs and suppressed contacts cannot be called', async () => {
  const f = await fixture();
  try {
    f.store.reserveCallRequest(requestId, f.customer.id, topicId);
    assert.equal(f.store.hasUnresolvedCalls(), true);
    const next = { customerId: f.customer.id, topicId, requestId: '22222222-2222-4222-8222-222222222222' };
    assert.equal((await f.request('/api/calls', next)).status, 409);
    f.store.suppress(f.customer.id);
    assert.equal((await f.request('/api/calls', next)).status, 403);
    assert.equal(f.starts(), 0);
  } finally { await f.cleanup(); }
});

test('browser test requires explicit opt-in and a server-approved topic', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/session', { sdp: 'v=0\r\no=fixture', topicId })).status, 400);
    const topics = await f.request('/api/topics');
    assert.equal(topics.body.topics[0].id, topicId);
    assert.match(topics.body.topics[0].opening, /erstellt von Werner/);
  } finally { await f.cleanup(); }
});
