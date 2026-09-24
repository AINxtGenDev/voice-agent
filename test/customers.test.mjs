import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CustomerStore } from '../src/customers.mjs';
import { createServer } from '../src/server.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'voice-customer-test-'));
  const path = join(root, 'private', 'customers.sqlite');
  return { root, path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const input = { name: 'Test fixture', mobile: '+43 (664) 123-4567', contactAllowed: true, permissionNote: 'Automated test fixture only' };

test('customers persist privately, normalize numbers, reject duplicates, and remain deleted on restart', () => {
  const f = fixture();
  let store;
  try {
    store = new CustomerStore(f.path);
    assert.deepEqual(store.list(), []);
    const created = store.create({ ...input, name: ' Test fixture ' });
    assert.equal(created.name, 'Test fixture');
    assert.equal(created.mobile, '+436641234567');
    assert.equal(created.contactAllowed, true);
    assert.ok(Number.isFinite(Date.parse(created.recordedAt)));
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.root, 'private')).mode & 0o777, 0o700);
    assert.throws(() => store.create({ ...input, mobile: '+436641234567' }), (error) => error.status === 409);
    store.close();
    store = new CustomerStore(f.path);
    assert.deepEqual(store.get(created.id), created);
    store.delete(created.id);
    store.close();
    store = new CustomerStore(f.path);
    assert.deepEqual(store.list(), []);
    assert.throws(() => store.delete(created.id), (error) => error.status === 404);
  } finally { store?.close(); f.cleanup(); }
});

test('customer validation rejects local numbers, malformed fields, and implicit permission', () => {
  const f = fixture();
  const store = new CustomerStore(f.path);
  try {
    for (const invalid of [null, [], { ...input, name: '' }, { ...input, name: 'a'.repeat(121) }, { ...input, mobile: '06641234567' }, { ...input, mobile: '+0123456789' }, { ...input, mobile: '+4366abc4567' }, { ...input, contactAllowed: 'true' }, { ...input, contactAllowed: undefined }, { ...input, permissionNote: 'a'.repeat(501) }, { ...input, provider: 'injected' }]) {
      assert.throws(() => store.create(invalid), (error) => error.status === 400);
    }
    assert.deepEqual(store.list(), []);
    const created = store.create({ ...input, contactAllowed: false });
    assert.equal(store.get(created.id).contactAllowed, false);
    assert.equal(store.get("' OR 1=1 --"), null);
  } finally { store.close(); f.cleanup(); }
});

test('customer store rejects unsafe filesystem permissions and symlinked databases', () => {
  const f = fixture();
  try {
    new CustomerStore(f.path).close();
    chmodSync(f.path, 0o644);
    assert.throws(() => new CustomerStore(f.path), /private/);
    chmodSync(f.path, 0o600);
    chmodSync(join(f.root, 'private'), 0o755);
    assert.throws(() => new CustomerStore(f.path), /private/);
    chmodSync(join(f.root, 'private'), 0o700);
    const linked = join(f.root, 'private', 'linked.sqlite');
    symlinkSync(f.path, linked);
    assert.throws(() => new CustomerStore(linked), /private/);
  } finally { f.cleanup(); }
});

test('customer HTTP routes enforce origin, persist records, and never place unconfigured calls', async () => {
  const f = fixture();
  let voiceCalls = 0;
  const server = createServer({ customerStore: new CustomerStore(f.path), provider: { create() { voiceCalls++; throw new Error('Unexpected voice call'); } } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path, { method = 'GET', origin = 'http://localhost:3000', body, host = 'localhost:3000' } = {}) => new Promise((resolve, reject) => {
    const headers = { Host: host, 'Content-Type': 'application/json' };
    if (origin !== null) headers.Origin = origin;
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    assert.equal((await request('/api/customers', { host: 'evil.example' })).status, 403);
    assert.equal((await request('/api/customers', { method: 'POST', origin: 'https://evil.example', body: input })).status, 403);
    assert.equal((await request('/api/customers', { method: 'POST', origin: null, body: input })).status, 403);
    assert.deepEqual((await request('/api/customers')).body, { customers: [] });
    assert.deepEqual((await request('/api/calling-status')).body, { configured: false, reason: 'Telephone provider is not configured.', provider: null });
    const created = await request('/api/customers', { method: 'POST', body: input });
    assert.equal(created.status, 201);
    const id = created.body.customer.id;
    assert.equal((await request('/api/calls', { method: 'POST', body: { customerId: id } })).status, 503);
    assert.equal((await request('/api/calls', { method: 'POST', body: { customerId: 'missing' } })).status, 404);
    const unpermitted = await request('/api/customers', { method: 'POST', body: { ...input, mobile: '+436641234568', contactAllowed: false } });
    assert.equal((await request('/api/calls', { method: 'POST', body: { customerId: unpermitted.body.customer.id } })).status, 403);
    assert.equal((await request('/api/customers/delete', { method: 'POST', body: { id } })).status, 200);
    assert.equal((await request('/api/customers')).body.customers.length, 1);
    assert.equal((await request('/.private/customers.sqlite')).status, 404);
    assert.equal(voiceCalls, 0);
  } finally { await server.shutdown(); f.cleanup(); }
});
