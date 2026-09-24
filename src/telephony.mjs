import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import WebSocket, { WebSocketServer } from 'ws';
import { openingForTopic, buildConversationInstructions, buildBackendInstructions, objectsToSummary, BACKEND_MODEL, KNOWLEDGE_TOOL, ConversationGate } from './conversation-policy.mjs';
import { createLiveConversation } from './live-conversation.mjs';

const terminal = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
const phone = /^\+[1-9][0-9]{7,14}$/u;
const DIALOGUE_LIMIT = 40_000;
const WRAP_UP = 'Die Gesprächszeit endet in etwa einer Minute. Kommen Sie freundlich zum Abschluss: Falls noch nicht geschehen, bieten Sie einen Folgetermin mit HPE-Expertinnen und -Experten an, fassen Sie Vereinbartes kurz zusammen und verabschieden Sie sich.';


export class TelephonyError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export function createTelephony({ accountSid, authToken, fromNumber, publicBaseUrl, apiKey, region = 'ie1', edge = 'dublin', client = twilio(accountSid, authToken, { region, edge, autoRetry: false, timeout: 10_000 }), WebSocketImpl = WebSocket, maxDurationSeconds = 300, closeTimeoutMs = 10_000, reportWaitMs = 20_000, onState = () => {}, onSuppression = () => {}, onFinished = () => {} } = {}) {
  const base = new URL(publicBaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Public telephony URL must be an HTTPS origin.');
  if (!/^AC[a-fA-F0-9]{32}$/u.test(accountSid) || !authToken || !apiKey || !phone.test(fromNumber)) throw new Error('Invalid telephony configuration.');
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 300) throw new Error('Invalid call duration.');
  const statusUrl = `${base.origin}/twilio/status`;
  const mediaUrl = `${base.origin.replace(/^https:/u, 'wss:')}/twilio/media`;
  let current = null;
  let shuttingDown = false;
  const snapshot = (call) => call ? { id: call.id, customerId: call.customerId, topicId: call.topicId, permission: call.permission, ...(call.callSid ? { callSid: call.callSid } : {}), state: call.state, liveState: call.liveState, finalized: call.phoneEnded && ['not-started', 'closed'].includes(call.liveState), startedAt: call.startedAt, ...(call.usage ? { usage: call.usage } : {}) } : null;
  const publish = (call) => onState(snapshot(call));
  const status = () => ({ configured: true, provider: 'twilio', reason: null, call: snapshot(current) });
  // Dialogue is kept in memory only until the report is handed off.
  const remember = (call, speaker, text) => {
    if (typeof text !== 'string' || !text || call.dialogueLength + text.length > DIALOGUE_LIMIT) return;
    call.dialogueLength += text.length;
    const last = call.dialogue.at(-1);
    if (last?.speaker === speaker) last.text += text; else call.dialogue.push({ speaker, text });
    if (speaker === 'customer' && objectsToSummary(call.dialogue.at(-1).text)) call.summaryAllowed = false;
  };
  const report = (call) => {
    if (call.reported) return;
    call.reported = true;
    clearTimeout(call.reportTimer);
    const endedAt = call.endedAt ?? new Date().toISOString();
    const carrier = call.carrierDuration !== undefined;
    const summaryAllowed = call.summaryAllowed && call.permission === 'granted';
    const data = { callId: call.id, customerId: call.customerId, topicId: call.topicId, permission: call.permission, outcome: call.state, startedAt: call.startedAt, answeredAt: call.answeredAt ?? null, endedAt,
      durationSeconds: carrier ? call.carrierDuration : (call.answeredAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(call.answeredAt)) / 1000)) : 0),
      durationSource: carrier ? 'carrier' : 'local', summaryAllowed, dialogue: summaryAllowed ? call.dialogue : [] };
    call.dialogue = [];
    Promise.resolve().then(() => onFinished(data)).catch(() => {});
  };
  const finish = (call) => {
    if (call.phoneEnded && ['not-started', 'closed'].includes(call.liveState)) {
      call.endedAt ??= new Date().toISOString();
      clearTimeout(call.wrapUpTimer);
      clearTimeout(call.deadline);
      clearTimeout(call.startupTimer);
      clearTimeout(call.closeTimer);
      call.state = call.phoneStatus ?? 'completed';
      call.conversation?.dispose();
      call.media?.terminate();
      publish(call);
      // Report after the final state is set; wait briefly for the carrier's duration.
      if (call.carrierDuration !== undefined) report(call);
      else if (!call.reported && !call.reportTimer) { call.reportTimer = setTimeout(() => report(call), reportWaitMs); call.reportTimer.unref?.(); }
    }
  };
  const send = (socket, data) => {
    if (socket?.readyState !== WebSocketImpl.OPEN || socket.bufferedAmount > 256 * 1024) throw new Error('Media transport unavailable.');
    socket.send(JSON.stringify(data));
  };
  const stop = async () => {
    const call = current;
    if (!call || terminal.has(call.state)) return status();
    if (call.stopping) { await call.stopping; return status(); }
    call.state = 'closing';
    try { publish(call); } catch { /* Cleanup must proceed even if local journaling fails. */ }
    call.stopping = (async () => {
      await call.creation?.catch(() => {});
      clearTimeout(call.startupTimer);
      call.media?.terminate();
      const liveClose = new Promise((resolve) => {
        if (['not-started', 'closed'].includes(call.liveState)) return resolve();
        call.resolveLiveClose = resolve;
        call.closeTimer = setTimeout(() => { call.liveState = 'unconfirmed'; call.live?.terminate(); resolve(); }, closeTimeoutMs);
        try { send(call.live, { type: 'session.close' }); } catch { call.liveState = 'unconfirmed'; clearTimeout(call.closeTimer); resolve(); }
      });
      if (call.callSid && !call.phoneEnded) {
        try {
          const result = await client.calls(call.callSid).update({ status: 'completed' });
          if (terminal.has(result.status)) { call.phoneEnded = true; call.phoneStatus = result.status; }
        } catch { /* An unsuccessful cancellation never proves the call ended. */ }
      }
      await liveClose;
      if (!call.phoneEnded || !['not-started', 'closed'].includes(call.liveState)) call.state = 'unconfirmed';
      finish(call);
      publish(call);
    })();
    await call.stopping;
    return status();
  };
  const abort = (call = current) => {
    if (!call || call !== current || terminal.has(call.state)) return;
    void stop().catch(() => { if (call === current) call.state = 'unconfirmed'; });
  };

  async function start({ customerId, mobile, topicId = 'hpe-private-cloud-ai' }) {
    if (shuttingDown || (current && !terminal.has(current.state))) throw new TelephonyError('A call is already reserved or its closure is unconfirmed.');
    if (typeof customerId !== 'string' || !customerId || typeof mobile !== 'string' || !phone.test(mobile) || mobile === fromNumber) throw new TelephonyError('Invalid customer destination.', 400);
    openingForTopic(topicId); // Validate the server-approved topic before any paid operation.
    const call = { id: randomUUID(), customerId, topicId, permission: 'pending', permissionAttempt: 0, permissionGate: new ConversationGate(topicId), state: 'dialing', liveState: 'not-started', startedAt: new Date().toISOString(), nonce: randomBytes(32).toString('hex'), phoneEnded: false, dialogue: [], dialogueLength: 0, summaryAllowed: true };
    current = call;
    publish(call); // Durable reservation must succeed before the paid request.
    const xml = permissionPrompt(call, openingForTopic(topicId));
    remember(call, 'agent', openingForTopic(topicId));
    call.creation = (async () => {
      try {
        const result = await client.calls.create({ to: mobile, from: fromNumber, twiml: xml.toString(), timeLimit: maxDurationSeconds, timeout: 20, statusCallback: statusUrl, statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'] });
        if (!/^CA[a-fA-F0-9]{32}$/u.test(result.sid)) throw new Error('Invalid provider response');
        call.callSid = result.sid;
        publish(call);
        call.deadline = setTimeout(() => abort(call), (maxDurationSeconds + 30) * 1000);
      } catch (error) {
        const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
        call.state = rejected ? 'failed' : 'unconfirmed';
        call.phoneEnded = rejected;
        call.phoneStatus = rejected ? 'failed' : undefined;
        publish(call);
        throw new TelephonyError('Telephone provider could not confirm call creation. Check call status before retrying.', 502);
      }
    })();
    await call.creation;
    if (shuttingDown) await stop();
    return snapshot(call);
  }

  function permissionPrompt(call, message) {
    const xml = new twilio.twiml.VoiceResponse();
    xml.say({ language: 'de-DE' }, message);
    xml.gather({ input: 'speech', language: 'de-DE', speechTimeout: '2', timeout: 7, actionOnEmptyResult: true, method: 'POST', action: `${base.origin}/twilio/permission?attempt=${call.permissionAttempt}` });
    xml.hangup();
    return xml;
  }

  const gateway = http.createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    const respond = (code) => { response.writeHead(code, { 'Cache-Control': 'no-store' }); response.end(); };
    const permissionRequest = /^\/twilio\/permission\?attempt=[01]$/u.test(request.url ?? '');
    if (request.method !== 'POST' || (request.url !== '/twilio/status' && !permissionRequest)) return respond(404);
    if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return respond(415);
    try {
      let body = '';
      for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 16384) return respond(413); }
      const pairs = new URLSearchParams(body);
      const params = Object.fromEntries(pairs);
      if (Array.from(pairs.keys()).length !== Object.keys(params).length) return respond(400);
      if (!twilio.validateRequest(authToken, request.headers['x-twilio-signature'] ?? '', permissionRequest ? `${base.origin}${request.url}` : statusUrl, params)) return respond(403);
      const call = current;
      await call?.creation?.catch(() => {});
      if (!call || params.AccountSid !== accountSid || params.CallSid !== call.callSid) return respond(403);
      if (permissionRequest) {
        const attempt = Number(new URL(request.url, base).searchParams.get('attempt'));
        if (call.permission !== 'pending' || attempt !== call.permissionAttempt || ['closing', 'unconfirmed'].includes(call.state) || terminal.has(call.state)) return respond(409);
        const speech = typeof params.SpeechResult === 'string' ? params.SpeechResult.trim() : '';
        call.answeredAt ??= new Date().toISOString();
        if (speech) remember(call, 'customer', speech.slice(0, 1000));
        const result = speech ? call.permissionGate.handleTranscript(speech) : call.permissionGate.handleSilence();
        let xml;
        if (result.action === 'consent_granted' && result.mayDiscussProduct) {
          call.permission = 'granted';
          xml = new twilio.twiml.VoiceResponse();
          const stream = xml.connect().stream({ url: mediaUrl });
          stream.parameter({ name: 'reservation', value: call.nonce });
          xml.hangup();
        } else if (result.action !== 'end' && attempt === 0) {
          call.permissionAttempt = 1;
          xml = permissionPrompt(call, result.message || 'Darf ich mit Ihnen über HPE Private Cloud AI sprechen? Bitte antworten Sie mit Ja oder Nein.');
        } else {
          call.permission = 'denied';
          if (result.suppressContact) onSuppression(call.customerId);
          xml = new twilio.twiml.VoiceResponse();
          xml.say({ language: 'de-DE' }, 'Selbstverständlich. Vielen Dank für Ihre Zeit. Ich wünsche Ihnen einen schönen Tag. Auf Wiederhören.');
          xml.hangup();
        }
        publish(call);
        response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(xml.toString());
        return;
      }
      if (terminal.has(params.CallStatus) && /^[0-9]{1,6}$/u.test(params.CallDuration ?? '')) call.carrierDuration = Number(params.CallDuration);
      if (params.CallStatus === 'in-progress') call.answeredAt ??= new Date().toISOString();
      if (!terminal.has(call.state)) {
        if (terminal.has(params.CallStatus)) {
          call.phoneEnded = true;
          call.phoneStatus = params.CallStatus;
          finish(call);
          abort(call);
        } else if (['queued', 'initiated', 'ringing', 'in-progress'].includes(params.CallStatus) && !['closing', 'unconfirmed'].includes(call.state)) {
          const rank = { dialing: 0, queued: 0, initiated: 1, ringing: 2, 'in-progress': 3 };
          if ((rank[params.CallStatus] ?? 0) >= (rank[call.state] ?? 0)) call.state = params.CallStatus;
          publish(call);
        }
      }
      if (terminal.has(call.state) && call.carrierDuration !== undefined) report(call);
      respond(204);
    } catch { respond(400); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  gateway.on('upgrade', (request, socket, head) => {
    const valid = request.url === '/twilio/media' && twilio.validateRequest(authToken, request.headers['x-twilio-signature'] ?? '', mediaUrl, {});
    if (!valid || !current || current.permission !== 'granted' || terminal.has(current.state) || current.media || ['closing', 'unconfirmed'].includes(current.state)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, (media) => attachMedia(media, current));
  });

  function attachMedia(media, call) {
    call.media = media;
    call.startupTimer = setTimeout(() => abort(call), 10_000);
    media.on('error', () => abort(call));
    media.on('close', () => { if (!terminal.has(call.state) && call.state !== 'closing') abort(call); });
    media.on('message', async (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== 'object' || typeof event.event !== 'string') throw new Error('Invalid envelope');
        if (event.event === 'connected') return;
        if (event.event === 'start') {
          if (call.streamSid || call.startReceived) throw new Error('Duplicate stream');
          call.startReceived = true;
          await call.creation;
          const startEvent = event.start;
          const nonce = startEvent?.customParameters?.reservation;
          if (call !== current || call.state === 'closing' || call.state === 'unconfirmed' || startEvent?.accountSid !== accountSid || startEvent?.callSid !== call.callSid || typeof nonce !== 'string' || nonce.length !== call.nonce.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(call.nonce)) || !/^MZ[a-fA-F0-9]{32}$/u.test(startEvent?.streamSid) || startEvent?.mediaFormat?.encoding !== 'audio/x-mulaw' || startEvent.mediaFormat.sampleRate !== 8000 || startEvent.mediaFormat.channels !== 1) throw new Error('Unauthorized media stream');
          call.streamSid = startEvent.streamSid;
          openLive(call);
        } else if (event.event === 'media') {
          if (event.streamSid !== call.streamSid || typeof event.media?.payload !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(event.media.payload) || event.media.payload.length > 8192) throw new Error('Invalid audio');
          if (call.liveState === 'active' && call.state !== 'closing') send(call.live, { type: 'session.input_audio.append', audio: event.media.payload });
        } else if (event.event === 'stop') abort(call);
      } catch { abort(call); }
    });
  }

  function openLive(call) {
    call.liveState = 'connecting';
    publish(call);
    const live = new WebSocketImpl('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'local-voice-agent/0.1' }, handshakeTimeout: 10_000, maxPayload: 1024 * 1024, followRedirects: false });
    call.live = live;
    live.on('open', () => {
      try {
        if (call.state === 'closing' || call.state === 'unconfirmed') return abort(call);
        call.liveState = 'starting';
        send(live, { type: 'session.start', session: { model: 'gpt-live-1', store: false, instructions: buildConversationInstructions(call.topicId), audio: { format: { type: 'audio/pcmu', rate: 8000 }, output: { voice: 'marin' } }, delegation: { type: 'responses', responses: { model: BACKEND_MODEL, instructions: buildBackendInstructions(call.topicId), reasoning: { effort: 'medium' }, tools: [KNOWLEDGE_TOOL], tool_choice: 'auto', parallel_tool_calls: false } } } });
      } catch { abort(call); }
    });
    live.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error('Invalid envelope');
        if (call.liveState === 'closed') return;
        if (event.type === 'session.started') {
          clearTimeout(call.startupTimer);
          if (['closing', 'unconfirmed'].includes(call.state)) { send(live, { type: 'session.close' }); return; }
          call.liveState = 'active';
          call.state = 'in-progress';
          publish(call);
          call.conversation = createLiveConversation({ send: (event) => send(live, event), close: () => { try { send(call.media, { event: 'clear', streamSid: call.streamSid }); } catch { /* Stop still closes both legs. */ } abort(call); }, onSuppression: () => onSuppression(call.customerId), topicId: call.topicId, consentGranted: true, delegationMode: 'responses' });
          call.conversation.start();
          const remaining = maxDurationSeconds * 1000 - (Date.now() - Date.parse(call.answeredAt ?? call.startedAt));
          if (maxDurationSeconds > 90) call.wrapUpTimer = setTimeout(() => { try { send(live, { type: 'session.instructions.append', delegation_id: null, content: WRAP_UP }); } catch { /* The carrier limit still ends the call. */ } }, Math.max(0, remaining - 60_000));
        } else if (event.type === 'session.output_audio.delta' && call.state === 'in-progress') {
          if (typeof event.delta !== 'string') throw new Error('Invalid audio');
          send(call.media, { event: 'media', streamSid: call.streamSid, media: { payload: event.delta } });
        } else if (event.type === 'session.closed') {
          clearTimeout(call.closeTimer);
          call.liveState = 'closed';
          call.usage = event.usage ?? null;
          call.resolveLiveClose?.();
          live.close();
          if (!call.phoneEnded) abort(call);
          finish(call);
        } else if (event.type === 'error') abort(call);
        else {
          if (event.type === 'session.input_transcript.delta' && event.delta?.trim()) {
            send(call.media, { event: 'clear', streamSid: call.streamSid });
          }
          if (event.type === 'session.input_transcript.delta') remember(call, 'customer', event.delta);
          if (event.type === 'session.output_transcript.delta') remember(call, 'agent', event.delta);
          call.conversation?.handle(event);
        }
      } catch { abort(call); }
    });
    live.on('error', () => abort(call));
    live.on('close', () => { if (call.liveState !== 'closed') { call.liveState = 'unconfirmed'; call.resolveLiveClose?.(); abort(call); } });
  }

  async function shutdown() {
    shuttingDown = true;
    await stop();
    if (current && terminal.has(current.state)) report(current);
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    if (gateway.listening) await new Promise((resolve) => { gateway.close(resolve); gateway.closeAllConnections(); });
  }
  return { gateway, status, start, stop, shutdown };
}
