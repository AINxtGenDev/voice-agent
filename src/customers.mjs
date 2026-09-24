import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

export const PRODUCTS = ['HPE Private Cloud AI', 'HPE Storage Alletra MP X10000', 'HPE Networking'];

export class CustomerError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function privatePath(path, directory) {
  const info = lstatSync(path);
  const expectedType = directory ? info.isDirectory() : info.isFile();
  if (!expectedType || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid() || (!directory && info.nlink !== 1)) {
    throw new Error('Customer storage must be private, owned by the current user, and not linked.');
  }
}

function validateCustomer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['name', 'mobile', 'product', 'contactAllowed', 'permissionNote'].includes(key))) throw new CustomerError('Invalid customer fields.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) throw new CustomerError('Name must contain 1–120 characters without control characters.');
  const mobile = typeof input.mobile === 'string' ? input.mobile.replace(/[\s()\-]/gu, '') : '';
  if (!/^\+[1-9][0-9]{7,14}$/u.test(mobile)) throw new CustomerError('Use an international mobile number, such as +436641234567; a country code is required.');
  if (!PRODUCTS.includes(input.product)) throw new CustomerError('Choose one of the listed products.');
  if (typeof input.contactAllowed !== 'boolean') throw new CustomerError('Contact permission must be explicitly true or false.');
  if (input.permissionNote !== undefined && typeof input.permissionNote !== 'string') throw new CustomerError('Permission note must be text.');
  const permissionNote = (input.permissionNote ?? '').trim();
  if (permissionNote.length > 500 || /[\u0000-\u001f\u007f]/u.test(permissionNote)) throw new CustomerError('Permission note must contain at most 500 characters without control characters.');
  return { name, mobile, product: input.product, contactAllowed: input.contactAllowed, permissionNote };
}

function customer(row) {
  return row ? { ...row, contactAllowed: Boolean(row.contactAllowed) } : null;
}

export class CustomerStore {
  constructor(path) {
    const directory = dirname(path);
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    privatePath(directory, true);
    try { closeSync(openSync(path, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    privatePath(path, false);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 3000;
        PRAGMA journal_mode = DELETE;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mobile TEXT NOT NULL UNIQUE,
          product TEXT NOT NULL DEFAULT '',
          contactAllowed INTEGER NOT NULL CHECK (contactAllowed IN (0, 1)),
          permissionNote TEXT NOT NULL,
          recordedAt TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS calls (
          id TEXT PRIMARY KEY,
          finalized INTEGER NOT NULL CHECK (finalized IN (0, 1)),
          snapshot TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS call_requests (
          requestId TEXT PRIMARY KEY,
          customerId TEXT NOT NULL,
          topicId TEXT NOT NULL,
          result TEXT
        ) STRICT;
      `);
      if (!this.db.prepare('PRAGMA table_info(customers)').all().some((column) => column.name === 'product')) {
        this.db.exec("ALTER TABLE customers ADD COLUMN product TEXT NOT NULL DEFAULT ''");
      }
    } catch (error) { this.db.close(); throw error; }
  }

  list() { return this.db.prepare('SELECT * FROM customers ORDER BY recordedAt DESC, id').all().map(customer); }

  get(id) {
    if (typeof id !== 'string' || id.length > 64) throw new CustomerError('A valid customer ID is required.');
    return customer(this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  }

  create(input) {
    const values = validateCustomer(input);
    const result = { id: randomUUID(), ...values, recordedAt: new Date().toISOString() };
    try {
      this.db.prepare('INSERT INTO customers (id, name, mobile, product, contactAllowed, permissionNote, recordedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(result.id, result.name, result.mobile, result.product, Number(result.contactAllowed), result.permissionNote, result.recordedAt);
    } catch (error) {
      if (error.errcode === 2067) throw new CustomerError('A customer with this mobile number already exists.', 409);
      throw error;
    }
    return result;
  }

  delete(id) {
    if (!this.get(id)) throw new CustomerError('Customer not found.', 404);
    this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }

  close() { this.db.close(); }

  suppress(id) {
    if (!this.get(id)) throw new CustomerError('Customer not found.', 404);
    this.db.prepare('UPDATE customers SET contactAllowed = 0 WHERE id = ?').run(id);
  }

  callRequest(requestId) {
    const row = this.db.prepare('SELECT * FROM call_requests WHERE requestId = ?').get(requestId);
    return row ? { ...row, result: row.result ? JSON.parse(row.result) : null } : null;
  }

  reserveCallRequest(requestId, customerId, topicId) {
    this.db.prepare('INSERT INTO call_requests (requestId, customerId, topicId) VALUES (?, ?, ?)').run(requestId, customerId, topicId);
  }

  completeCallRequest(requestId, result) {
    this.db.prepare('UPDATE call_requests SET result = ? WHERE requestId = ?').run(JSON.stringify(result), requestId);
  }

  recordCall(snapshot) {
    if (!snapshot || typeof snapshot.id !== 'string') throw new Error('Invalid call state.');
    this.db.prepare('INSERT INTO calls (id, finalized, snapshot, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET finalized=excluded.finalized, snapshot=excluded.snapshot, updatedAt=excluded.updatedAt').run(snapshot.id, Number(snapshot.finalized === true), JSON.stringify(snapshot), new Date().toISOString());
  }

  hasUnresolvedCalls() {
    return Boolean(this.db.prepare('SELECT id FROM calls WHERE finalized = 0 LIMIT 1').get()
      || this.db.prepare('SELECT requestId FROM call_requests WHERE result IS NULL LIMIT 1').get());
  }
}
