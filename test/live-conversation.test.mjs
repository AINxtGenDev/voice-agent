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

test('responses delegation executes only the knowledge tool and continues the backend response', () => {
  assert.throws(() => createLiveConversation({ send() {}, close() {}, delegationMode: 'responses' }), /consent/);
  const f = fixture({ consentGranted: true, delegationMode: 'responses' });
  f.conversation.start();
  f.conversation.handle({ type: 'session.delegation.created', delegation: { id: 'r1', target: 'responses' } });
  const call = (call_id, name, args) => f.conversation.handle({ type: 'response.event', delegation_id: 'r1', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id, name, arguments: args } } });
  call('call_1', 'search_hpe_knowledge', JSON.stringify({ query: 'Welche Betriebsvarianten gibt es, air-gapped?' }));
  const [result, resume] = f.events.slice(-2);
  assert.equal(result.type, 'response.item.create');
  assert.equal(result.item.call_id, 'call_1');
  assert.match(JSON.parse(result.item.output).facts[0].sources[0], /HPE-SERVICE/);
  assert.deepEqual(resume, { type: 'response.create' });
  call('call_1', 'search_hpe_knowledge', JSON.stringify({ query: 'Duplikat' }));
  assert.equal(f.events.length, 3);
  call('call_2', 'send_email', JSON.stringify({ query: 'x' }));
  assert.equal(JSON.parse(f.events.at(-2).item.output).status, 'error');
  for (let i = 0; i < 40; i++) f.text('Das klingt interessant, erzählen Sie mehr über die Architektur. ');
  assert.equal(f.closed(), 0);
  f.conversation.handle({ type: 'session.delegation.created', delegation: { id: 'c1', target: 'client' } });
  assert.equal(f.closed(), 1);
});

test('after consent, ordinary sentences with stop words continue; short or explicit requests end', async () => {
  const f = fixture({ consentGranted: true, delegationMode: 'responses', turnEndMs: 10 });
  const reply = () => f.conversation.handle({ type: 'session.output_transcript.delta', delta: 'Verstehe.' });
  for (const sentence of ['Das brauchen wir jetzt nicht, aber RAG interessiert uns sehr.', 'Wir wollen das alte Projekt beenden und migrieren.', 'Wir kontaktieren den alten Anbieter nicht mehr.', 'Kein Interesse an Public Cloud, aber an Private Cloud schon.']) {
    for (const word of sentence.split(' ')) f.text(`${word} `);
    reply();
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.closed(), 0);
  assert.equal(f.suppressed(), 0);
  f.text('Keine '); f.text('Zeit, ');
  assert.equal(f.closed(), 0); // The customer may still be speaking.
  f.text('das ist heute schwierig, aber erzählen Sie weiter.');
  reply();
  assert.equal(f.closed(), 0);
  f.text('Keine Zeit.');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.closed(), 1);
  const g = fixture({ consentGranted: true, delegationMode: 'responses' });
  g.text('Also gut, legen Sie bitte ');
  g.text('auf, danke.');
  assert.equal(g.closed(), 1);
});
