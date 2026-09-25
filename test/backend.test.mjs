import test from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager.mjs';
import { createLiveProvider, ProviderError } from '../src/live-provider.mjs';
import { createServer } from '../src/server.mjs';

function fakeProvider({ finalize = true } = {}) {
  const provider = {
    calls: 0,
    async create() { this.calls++; return { session: { id: `live_${this.calls}` }, transport: { type: 'webrtc', sdp: 'answer' } }; },
    attach(id, callbacks) {
      this.callbacks = callbacks;
      return { ready: Promise.resolve(), requestClose() { if (finalize) queueMicrotask(() => callbacks.onClosed({ seconds: 1 })); }, dispose() {} };
    },
  };
  return provider;
}

test('concurrent creation is rejected before provider call; confirmed close releases reservation', async () => {
  const provider = fakeProvider();
  const manager = new SessionManager(provider);
  const first = manager.create('offer');
  await assert.rejects(manager.create('offer'), /reserved/);
  await first;
  assert.equal(provider.calls, 1);
  await manager.close('live_1');
  assert.equal(manager.status().state, 'closed');
  await manager.create('offer');
  await manager.shutdown();
});

test('ambiguous creation errors block further spending; definitive rejection allows retry', async () => {
  for (const definitive of [false, true]) {
    const manager = new SessionManager({ async create() { throw new ProviderError('rejected', { definitive }); } });
    await assert.rejects(manager.create('offer'));
    assert.equal(manager.state, definitive ? 'idle' : 'unconfirmed');
    if (!definitive) await assert.rejects(manager.create('offer'), /reserved/);
  }
});

test('missing close event blocks next session', async () => {
  const manager = new SessionManager(fakeProvider({ finalize: false }), { closeTimeoutMs: 10 });
  await manager.create('offer');
  assert.equal((await manager.close('live_1')).state, 'unconfirmed');
  await assert.rejects(manager.create('offer'), /reserved/);
});

test('sideband loss while closing resolves promptly without treating close as confirmed', async () => {
  const provider = fakeProvider({ finalize: false });
  const manager = new SessionManager(provider, { closeTimeoutMs: 100 });
  await manager.create('offer');
  const closing = manager.close('live_1');
  provider.callbacks.onLost();
  assert.equal((await closing).state, 'unconfirmed');
});

test('heartbeat loss requests closure and captures authoritative usage', async () => {
  const manager = new SessionManager(fakeProvider(), { heartbeatMs: 10 });
  await manager.create('offer');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(manager.status().usage, { seconds: 1 });
  assert.equal(manager.state, 'closed');
});

test('shutdown closes a session whose creation completes late', async () => {
  const provider = fakeProvider();
  let release;
  provider.create = () => new Promise((resolve) => { release = resolve; });
  const manager = new SessionManager(provider);
  const creation = manager.create('offer');
  const rejected = assert.rejects(creation);
  const shutdown = manager.shutdown();
  release({ session: { id: 'live_late' }, transport: { type: 'webrtc', sdp: 'answer' } });
  await Promise.all([shutdown, rejected]);
  assert.equal(manager.state, 'closed');
});

test('late callbacks cannot corrupt a newer session', async () => {
  const provider = fakeProvider();
  const manager = new SessionManager(provider);
  await manager.create('offer');
  const oldCallbacks = provider.callbacks;
  await manager.close('live_1');
  await manager.create('offer');
  oldCallbacks.onClosed({ seconds: 999 });
  oldCallbacks.onLost();
  assert.equal(manager.state, 'active');
  assert.equal(manager.usage, undefined);
  await manager.shutdown();
});

test('provider fixes model and disables storage; malformed success remains ambiguous', async () => {
  let request;
  const provider = createLiveProvider({ apiKey: 'test-key', fetchImpl: async (url, init) => { request = init; return new Response('{}', { status: 201 }); } });
  await assert.rejects(provider.create('offer'), (error) => error.definitive === false);
  const body = JSON.parse(request.body);
  assert.equal(body.session.model, 'gpt-live-1');
  assert.equal(body.session.store, false);
  assert.equal(body.session.delegation.type, 'client');
  assert.match(body.session.instructions, /erstellt von Werner/);
  assert.match(body.session.instructions, /serverseitige Erlaubniszustand/);
  assert.equal(request.redirect, 'error');
});

test('billing rejection exposes only an allowlisted code and no upstream message', async () => {
  const provider = createLiveProvider({ apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'SECRET-UPSTREAM-CONTENT' } }), { status: 429 }) });
  const manager = new SessionManager(provider);
  await assert.rejects(manager.create('offer'), (error) => error.message.includes('credit_balance_exhausted') && !error.message.includes('SECRET'));
  assert.equal(manager.state, 'idle');
});

test('duration deadline closes despite continuing heartbeats', async () => {
  const manager = new SessionManager(fakeProvider(), { maxDurationSeconds: 1, heartbeatMs: 500 });
  await manager.create('offer');
  const heartbeat = setInterval(() => { if (manager.state === 'active') manager.heartbeat('live_1'); }, 100);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(manager.state, 'closed');
  } finally {
    clearInterval(heartbeat);
    await manager.shutdown();
  }
});

test('HTTP rejects foreign Host/Origin, missing Origin, and browser configuration injection', async () => {
  const server = createServer({ provider: fakeProvider() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.equal(await request('/api/status'), 403);
    assert.equal(await request('/api/status', { headers: { Host: 'localhost:3000' } }), 200);
    const post = (headers, body = { sdp: 'v=0\r\no=test' }) => request('/api/session', { method: 'POST', headers: { Host: 'localhost:3000', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal(await post({}), 403);
    assert.equal(await post({ Origin: 'https://evil.example' }), 403);
    assert.equal(await post({ Origin: 'http://localhost:3000' }, { sdp: 'v=0\r\no=test', model: 'arbitrary' }), 400);
    assert.equal(await request('/.env', { headers: { Host: 'localhost:3000' } }), 404);
  } finally { await server.shutdown(); }
});

test('HTTP accepts only the configured public HTTPS origin behind the proxy', async () => {
  const server = createServer({ provider: fakeProvider(), publicOrigin: 'https://voice.example:10556' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.equal(await request('/api/status', { headers: { Host: 'voice.example:10556' } }), 200);
    assert.equal(await request('/api/status', { headers: { Host: 'voice.example' } }), 403);
    const post = (headers) => request('/api/session', { method: 'POST', headers: { Host: 'voice.example:10556', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ sdp: 'v=0\r\no=test', model: 'arbitrary' }) });
    assert.equal(await post({ Origin: 'http://voice.example:10556' }), 403);
    assert.equal(await post({ Origin: 'https://voice.example:10556' }), 400);
    assert.equal(await request('/api/status', { headers: { Host: 'localhost:3000' } }), 200);
  } finally { await server.shutdown(); }
});


test('malformed sideband events terminate control and fail closed without crashing', async () => {
  for (const payload of ['null', '{invalid', '12', 'true', '[]', '{}', '{"type":null}']) {
    class MockWebSocket extends EventEmitter {
      static OPEN = 1;
      static instance;
      constructor() { super(); MockWebSocket.instance = this; this.readyState = 1; this.terminated = false; }
      terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
      send(raw) { assert.equal(JSON.parse(raw).type, 'session.instructions.append'); }
    }
    let lost = 0;
    let closed = 0;
    const provider = createLiveProvider({ apiKey: 'test-key', WebSocketImpl: MockWebSocket });
    const control = provider.attach('live_test', { onLost: () => lost++, onClosed: () => closed++ });
    const socket = MockWebSocket.instance;
    socket.emit('open');
    await control.ready;
    assert.doesNotThrow(() => socket.emit('message', Buffer.from(payload)));
    assert.equal(socket.terminated, true);
    assert.equal(lost, 1);
    assert.equal(closed, 0);
    assert.throws(() => control.requestClose(), /unavailable/);
    socket.emit('message', Buffer.from('{"type":"session.closed"}'));
    assert.equal(closed, 0, 'late events on failed connection must not assert finalization');
  }
});

test('final sideband usage remains authoritative after close and late usage updates', async () => {
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static instance;
    constructor() { super(); MockWebSocket.instance = this; this.readyState = 1; }
    send(raw) { assert.equal(JSON.parse(raw).type, 'session.instructions.append'); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.emit('close'); }
  }
  let lost = 0;
  let finalUsage;
  let latestUsage;
  const provider = createLiveProvider({ apiKey: 'test-key', WebSocketImpl: MockWebSocket });
  const control = provider.attach('live_test', {
    onLost: () => lost++,
    onClosed: (usage) => { finalUsage = usage; },
    onUsage: (usage) => { latestUsage = usage; },
  });
  const socket = MockWebSocket.instance;
  socket.emit('open');
  await control.ready;
  socket.emit('message', Buffer.from('{"type":"session.usage.updated","usage":{"seconds":1}}'));
  socket.emit('message', Buffer.from('{"type":"session.closed","usage":{"seconds":2}}'));
  socket.emit('message', Buffer.from('{"type":"session.usage.updated","usage":{"seconds":999}}'));
  assert.deepEqual(finalUsage, { seconds: 2 });
  assert.deepEqual(latestUsage, { seconds: 1 });
  assert.equal(lost, 0);
});
