import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { smoke } from '../scripts/smoke-live.mjs';

test('repeated malformed events cannot postpone finalization deadline or restart audio', async () => {
  let socket;
  class FakeSocket extends EventEmitter {
    readyState = 1;
    commands = [];
    constructor() {
      super();
      socket = this;
      queueMicrotask(() => this.emit('open'));
    }
    send(raw) {
      const event = JSON.parse(raw);
      this.commands.push(event.type);
      if (event.type === 'session.start') {
        this.emit('message', Buffer.from('null'));
        this.interval = setInterval(() => {
          this.emit('message', Buffer.from('null'));
          this.emit('message', Buffer.from('{"type":"session.started"}'));
        }, 5);
      }
    }
    terminate() { this.readyState = 3; clearInterval(this.interval); }
    close() { this.terminate(); }
  }
  await assert.rejects(smoke({ apiKey: 'sk-test', WebSocketImpl: FakeSocket, closeTimeoutMs: 30, startupTimeoutMs: 100, reportError() {} }), /Finalization timed out/);
  assert.equal(socket.commands.filter((type) => type === 'session.close').length, 1);
  assert.equal(socket.commands.includes('session.input_audio.append'), false);
  assert.equal(socket.readyState, 3);
});
