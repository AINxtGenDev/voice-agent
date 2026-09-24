import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveConversation } from '../src/live-conversation.mjs';

function fixture(options = {}) {
  const events = [];
  let closed = 0;
  let suppressed = 0;
  const conversation = createLiveConversation({ send: e => events.push(e), close: () => closed++, onSuppression: () => suppressed++, ...options });
  let sequence = 0;
  const text = delta => conversation.handle({ type: 'session.input_transcript.delta', delta, event_id: `t${sequence++}` });
  const delegate = () => conversation.handle({ type: 'session.delegation.created', delegation: { id: `d${sequence++}`, target: 'client' } });
  return { conversation, events, text, delegate, closed: () => closed, suppressed: () => suppressed };
}

test('browser fragments do not grant consent or disclose facts before a delegation check', () => {
  const f = fixture();
  f.conversation.start();
  assert.match(f.events[0].content, /erstellt von Werner/);
  f.text('Ja');
  assert.equal(f.events.length, 1);
  f.text(', aber nicht jetzt');
  assert.equal(f.closed(), 1);
  f.delegate();
  assert.equal(f.events.length, 1);
});

test('unconsented product questions never retrieve facts, while clear opt-in enables cited lookup', () => {
  const f = fixture();
  f.text('Was ist HPE Private Cloud AI?'); f.delegate();
  assert.equal(f.events.some(e => e.type === 'session.thinking.append'), false);
  f.text('Ja, gerne.'); f.delegate();
  f.text('Was ist HPE Private Cloud AI?'); f.delegate();
  assert.ok(f.events.some(e => e.type === 'session.thinking.append' && e.content.includes('HPE-QS')));
});

test('phone consent is supplied by trusted Gather and unsupported prices are not invented', () => {
  const f = fixture({ consentGranted: true });
  f.conversation.start();
  f.text('Was kostet die Lösung?'); f.delegate();
  assert.equal(f.events.some(e => e.type === 'session.thinking.append'), false);
  assert.match(f.events.at(-1).content, /kein belastbarer/);
});

test('withdrawal closes immediately, suppresses contact once, and late events do nothing', () => {
  const f = fixture({ consentGranted: true });
  f.text('Rufen Sie mich nicht mehr an.');
  assert.equal(f.suppressed(), 1);
  assert.equal(f.closed(), 1);
  f.text('RAG'); f.delegate();
  assert.deepEqual(f.events, []);
});

test('shutdown still occurs if durable suppression fails', () => {
  const f = fixture({ consentGranted: true, onSuppression() { throw new Error('disk full'); } });
  assert.throws(() => f.text('Bitte nicht mehr anrufen'));
  assert.equal(f.closed(), 1);
});

test('duplicate transcript and delegation events do not repeat work', () => {
  const f = fixture({ consentGranted: true });
  const event = { type: 'session.input_transcript.delta', event_id: 'same', delta: 'Was ist HPE Private Cloud AI?' };
  f.conversation.handle(event); f.conversation.handle(event);
  const delegation = { type: 'session.delegation.created', delegation: { id: 'one', target: 'client' } };
  f.conversation.handle(delegation);
  const count = f.events.length;
  f.conversation.handle(delegation);
  assert.equal(f.events.length, count);
});

test('unanswered browser permission receives one deadline reminder and then closes', async () => {
  const f = fixture({ permissionTimeoutMs: 10 });
  f.conversation.start();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(f.events.length, 2);
  assert.match(f.events[1].content, /Zustimmung/);
  assert.equal(f.closed(), 1);
});
