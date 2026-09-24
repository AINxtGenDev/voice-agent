import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import twilio from 'twilio';
import WebSocket from 'ws';
import { createTelephony } from '../src/telephony.mjs';

const accountSid = `AC${'a'.repeat(32)}`;
const callSid = `CA${'b'.repeat(32)}`;
const streamSid = `MZ${'c'.repeat(32)}`;
const authToken = 'offline-test-token';
const publicBaseUrl = 'https://voice.example';
const destination = { customerId: 'fixture', mobile: '+436641234567' };
function fixture(overrides = {}) {
  let request;
  let hangups = 0;
  const calls = () => ({ async update() { hangups++; return { status: 'completed' }; } });
  calls.create = async (options) => { request = options; return { sid: callSid }; };
  const client = { calls };
  const app = createTelephony({ accountSid, authToken, publicBaseUrl, fromNumber: '+436641234568', apiKey: 'test-key', client, closeTimeoutMs: 20, ...overrides });
  return { app, client, request: () => request, hangups: () => hangups };
}

test('outbound reservation prevents concurrent dial; carrier duration and signed callbacks are fixed', async () => {
  const f = fixture();
  try {
    const pending = f.app.start(destination);
    await assert.rejects(f.app.start(destination), /reserved/);
    await pending;
    assert.equal(f.request().timeLimit, 300);
    assert.equal(f.request().timeout, 20);
    assert.equal(f.request().statusCallback, 'https://voice.example/twilio/status');
    assert.match(f.request().twiml, /<Response><Pause length="2"\/><Say[^>]*>Guten Tag/u);
    assert.match(f.request().twiml, /<Gather/u);
    assert.match(f.request().twiml, /erstellt von Werner/u);
    assert.doesNotMatch(f.request().twiml, /<Stream/u);
    assert.equal(f.app.status().call.finalized, false);
    await f.app.stop();
    assert.equal(f.hangups(), 1);
    assert.equal(f.app.status().call.finalized, true);
  } finally { await f.app.shutdown(); }
});

test('ambiguous outbound creation cannot be retried, and durable reservation precedes provider call', async () => {
  let paidRequests = 0;
  const calls = () => ({ update: async () => ({ status: 'completed' }) });
  calls.create = async () => { paidRequests++; throw new Error('network timeout'); };
  const f = fixture({ client: { calls } });
  try {
    await assert.rejects(f.app.start(destination));
    assert.equal(f.app.status().call.state, 'unconfirmed');
    assert.equal(f.app.status().call.finalized, false);
    await assert.rejects(f.app.start(destination), /reserved/);
    assert.equal(paidRequests, 1);
  } finally { await f.app.shutdown(); }
  const blocked = fixture({ client: { calls }, onState() { throw new Error('Storage unavailable'); } });
  await assert.rejects(blocked.app.start(destination), /Storage/);
  assert.equal(paidRequests, 1);
});

async function listen(app) {
  await new Promise((resolve) => app.gateway.listen(0, '127.0.0.1', resolve));
  return app.gateway.address().port;
}
function callback(port, params, valid = true) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/twilio/status', method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': valid ? twilio.getExpectedTwilioSignature(authToken, 'https://voice.example/twilio/status', params) : 'invalid',
    } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(new URLSearchParams(params).toString());
  });
}
const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('gateway rejects unsigned callbacks and unknown calls; terminal status cannot regress', async () => {
  const f = fixture();
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    const params = { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed' };
    assert.equal(await callback(port, params, false), 403);
    assert.equal(await callback(port, { ...params, CallSid: `CA${'d'.repeat(32)}` }), 403);
    assert.equal(await callback(port, params), 204);
    await delay();
    assert.equal(f.app.status().call.state, 'completed');
    assert.equal(await callback(port, { ...params, CallStatus: 'ringing' }), 204);
    assert.equal(f.app.status().call.state, 'completed');
  } finally { await f.app.shutdown(); }
});

test('only the signed reserved stream starts Live; audio codec and both-leg finalization are verified', async () => {
  class MockLive extends EventEmitter {
    static OPEN = 1;
    static instances = [];
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; MockLive.instances.push(this); queueMicrotask(() => this.emit('open')); }
    send(raw) {
      const event = JSON.parse(raw);
      this.sent.push(event);
      if (event.type === 'session.start') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.started"}')));
      if (event.type === 'session.close') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.closed","usage":{"seconds":2}}')));
    }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
  }
  const f = fixture({ WebSocketImpl: MockLive });
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    const consent = await permission(port, 'Ja, gerne.');
    assert.equal(consent.status, 200);
    const nonce = /name="reservation" value="([a-f0-9]+)"/u.exec(consent.body)[1];
    const media = new WebSocket(`ws://127.0.0.1:${port}/twilio/media`, { headers: { 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(authToken, 'wss://voice.example/twilio/media', {}) } });
    await once(media, 'open');
    media.send(JSON.stringify({ event: 'start', start: { accountSid, callSid, streamSid, customParameters: { reservation: nonce }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } }));
    await delay();
    assert.equal(MockLive.instances.length, 1);
    assert.deepEqual(MockLive.instances[0].sent[0].session.audio.format, { type: 'audio/pcmu', rate: 8000 });
    assert.equal(MockLive.instances[0].sent[0].session.store, false);
    media.send(JSON.stringify({ event: 'media', streamSid, media: { payload: '/w==' } }));
    await delay();
    assert.equal(MockLive.instances[0].sent.at(-1).type, 'session.input_audio.append');
    await f.app.stop();
    assert.equal(f.app.status().call.finalized, true);
    assert.equal(f.app.status().call.liveState, 'closed');
    assert.deepEqual(f.app.status().call.usage, { seconds: 2 });
    assert.equal(f.hangups(), 1);
  } finally { await f.app.shutdown(); }
});

test('early signed callback waits for create result without losing final state', async () => {
  let release;
  const calls = () => ({ update: async () => ({ status: 'completed' }) });
  calls.create = () => new Promise((resolve) => { release = resolve; });
  const f = fixture({ client: { calls } });
  const port = await listen(f.app);
  try {
    const creation = f.app.start(destination);
    const early = callback(port, { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed' });
    await delay(10);
    release({ sid: callSid });
    await creation;
    assert.equal(await early, 204);
    await delay();
    assert.equal(f.app.status().call.finalized, true);
    assert.equal(f.app.status().call.state, 'completed');
  } finally { await f.app.shutdown(); }
});

test('signed stream with incorrect reservation cannot open a paid Live session', async () => {
  let liveConnections = 0;
  class ForbiddenLive { static OPEN = 1; constructor() { liveConnections++; throw new Error('Must not connect'); } }
  const f = fixture({ WebSocketImpl: ForbiddenLive });
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    await permission(port, 'Ja');
    const media = new WebSocket(`ws://127.0.0.1:${port}/twilio/media`, { headers: { 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(authToken, 'wss://voice.example/twilio/media', {}) } });
    await once(media, 'open');
    media.send(JSON.stringify({ event: 'start', start: { accountSid, callSid, streamSid, customParameters: { reservation: '0'.repeat(64) }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } }));
    await delay();
    assert.equal(liveConnections, 0);
    assert.equal(f.hangups(), 1);
  } finally { await f.app.shutdown(); }
});

function permission(port, speech, { attempt = 0, valid = true } = {}) {
  const path = `/twilio/permission?attempt=${attempt}`;
  const params = { AccountSid: accountSid, CallSid: callSid, ...(speech === null ? {} : { SpeechResult: speech }) };
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': valid ? twilio.getExpectedTwilioSignature(authToken, `https://voice.example${path}`, params) : 'invalid',
    } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(new URLSearchParams(params).toString());
  });
}

test('permission callback rejects forged and replayed responses before enabling media', async () => {
  const f = fixture();
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    assert.equal((await permission(port, 'Ja', { valid: false })).status, 403);
    assert.equal(f.app.status().call.permission, 'pending');
    const accepted = await permission(port, 'Ja, gerne');
    assert.equal(accepted.status, 200);
    assert.match(accepted.body, /<Stream/);
    assert.equal(f.app.status().call.permission, 'granted');
    assert.equal((await permission(port, 'Ja')).status, 409);
  } finally { await f.app.shutdown(); }
});

test('refusal never opens media; silence and ambiguity receive at most one clarification', async () => {
  for (const speech of ['Nein danke', 'Ja, aber nicht jetzt', null, 'Vielleicht']) {
    const f = fixture();
    const port = await listen(f.app);
    try {
      await f.app.start(destination);
      let result = await permission(port, speech);
      assert.doesNotMatch(result.body, /<Stream/);
      if (/<Gather/.test(result.body)) result = await permission(port, null, { attempt: 1 });
      assert.match(result.body, /<Hangup/);
      assert.doesNotMatch(result.body, /<Gather|<Stream/);
      assert.equal(f.app.status().call.permission, 'denied');
      assert.equal(f.app.status().call.liveState, 'not-started');
    } finally { await f.app.shutdown(); }
  }
});

test('permission withdrawal persists contact suppression and never opens Live', async () => {
  const suppressed = [];
  const f = fixture({ onSuppression: id => suppressed.push(id) });
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    const result = await permission(port, 'Bitte nicht mehr anrufen');
    assert.deepEqual(suppressed, ['fixture']);
    assert.match(result.body, /<Hangup/);
    assert.doesNotMatch(result.body, /<Stream/);
  } finally { await f.app.shutdown(); }
});

test('finished call hands off carrier duration and dialogue once; objection drops content; backend is Terra', async () => {
  class MockLive extends EventEmitter {
    static OPEN = 1;
    static instances = [];
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; MockLive.instances.push(this); queueMicrotask(() => this.emit('open')); }
    send(raw) {
      const event = JSON.parse(raw);
      this.sent.push(event);
      if (event.type === 'session.start') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.started"}')));
      if (event.type === 'session.close') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.closed","usage":{"seconds":180}}')));
    }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
  }
  for (const objection of [false, true]) {
    MockLive.instances = [];
    const finished = [];
    const f = fixture({ WebSocketImpl: MockLive, onFinished: data => finished.push(data) });
    const port = await listen(f.app);
    try {
      await f.app.start(destination);
      const consent = await permission(port, 'Ja, gerne.');
      const nonce = /name="reservation" value="([a-f0-9]+)"/u.exec(consent.body)[1];
      const media = new WebSocket(`ws://127.0.0.1:${port}/twilio/media`, { headers: { 'X-Twilio-Signature': twilio.getExpectedTwilioSignature(authToken, 'wss://voice.example/twilio/media', {}) } });
      await once(media, 'open');
      media.send(JSON.stringify({ event: 'start', start: { accountSid, callSid, streamSid, customParameters: { reservation: nonce }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } }));
      await delay();
      const live = MockLive.instances[0];
      const delegation = live.sent[0].session.delegation;
      assert.equal(delegation.type, 'responses');
      assert.equal(delegation.responses.model, 'gpt-5.6-terra');
      assert.deepEqual(delegation.responses.reasoning, { effort: 'medium' });
      assert.equal(delegation.responses.tools[0].name, 'search_hpe_knowledge');
      const emit = event => live.emit('message', Buffer.from(JSON.stringify(event)));
      emit({ type: 'session.output_transcript.delta', delta: 'Was interessiert Sie besonders?' });
      emit({ type: 'session.input_transcript.delta', delta: objection ? 'Bitte nicht aufschreiben. ' : 'Inferenz. ' });
      emit({ type: 'session.input_transcript.delta', delta: 'Dienstag vormittags passt.' });
      emit({ type: 'response.event', delegation_id: 'r1', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'search_hpe_knowledge', arguments: '{"query":"Inferenz"}' } } });
      await delay();
      assert.deepEqual(live.sent.slice(-2).map(e => e.type), ['response.item.create', 'response.create']);
      assert.equal(await callback(port, { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed', CallDuration: '187' }), 204);
      await delay(50);
      assert.equal(await callback(port, { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed', CallDuration: '187' }), 204);
      await delay();
      assert.equal(finished.length, 1);
      const [data] = finished;
      assert.equal(data.durationSeconds, 187);
      assert.equal(data.durationSource, 'carrier');
      assert.equal(data.outcome, 'completed');
      assert.ok(Date.parse(data.answeredAt) <= Date.parse(data.endedAt));
      if (objection) {
        assert.equal(data.summaryAllowed, false);
        assert.deepEqual(data.dialogue, []);
      } else {
        assert.equal(data.summaryAllowed, true);
        assert.deepEqual(data.dialogue.map(turn => turn.speaker), ['agent', 'customer', 'agent', 'customer']);
        assert.match(data.dialogue[0].text, /schriftlichen Zusammenfassung/);
        assert.equal(data.dialogue[1].text, 'Ja, gerne.');
        assert.equal(data.dialogue[3].text, 'Inferenz. Dienstag vormittags passt.');
      }
    } finally { await f.app.shutdown(); }
  }
});

test('without a carrier duration the report falls back to local timing after the wait', async () => {
  const finished = [];
  const f = fixture({ onFinished: data => finished.push(data), reportWaitMs: 30 });
  const port = await listen(f.app);
  try {
    await f.app.start(destination);
    await permission(port, 'Nein danke');
    assert.equal(await callback(port, { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed' }), 204);
    await delay(80);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].durationSource, 'local');
    assert.equal(finished[0].permission, 'denied');
    assert.equal(finished[0].summaryAllowed, false);
  } finally { await f.app.shutdown(); }
});
