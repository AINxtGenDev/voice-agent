import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarizeDialogue, renderReport, writeReport, createCallReporter, SUMMARY_MODEL } from '../src/call-report.mjs';

const customer = { id: 'c1', name: 'Test Fixture', mobile: '+436641234567', product: 'HPE Networking' };
const call = { callId: '12345678-aaaa-4bbb-8ccc-123456789012', customerId: 'c1', topicId: 'hpe-private-cloud-ai', permission: 'granted', outcome: 'completed',
  startedAt: '2026-09-24T13:04:00.000Z', answeredAt: '2026-09-24T13:04:10.000Z', endedAt: '2026-09-24T13:07:17.000Z', durationSeconds: 187, durationSource: 'carrier',
  summaryAllowed: true, dialogue: [{ speaker: 'agent', text: 'Guten Tag!' }, { speaker: 'customer', text: 'Ja, gerne. Dienstag vormittags passt, online.' }] };
const summary = { summary: 'Interesse an Inferenz im eigenen Rechenzentrum.\n# Keine Überschrift', customerInterest: 'Inferenz | RAG', meetingAgreed: 'ja', preferredTimes: 'Dienstag vormittags', meetingFormat: 'online', email: 'test@example.com', nextSteps: 'Einladung senden.' };
function fakeFetch(reply) {
  const requests = [];
  const impl = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return reply(); };
  return { impl, requests };
}
const ok = (value) => ({ ok: true, status: 200, json: async () => ({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });

test('summary request uses the configured model, no storage, and a strict schema', async () => {
  const f = fakeFetch(() => ok(summary));
  assert.deepEqual(await summarizeDialogue({ apiKey: 'k', dialogue: call.dialogue, topicId: call.topicId, fetchImpl: f.impl }), summary);
  const { url, body } = f.requests[0];
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(body.model, SUMMARY_MODEL);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.match(body.input[1].content, /Kunde: Ja, gerne/);
  await assert.rejects(summarizeDialogue({ apiKey: 'k', dialogue: call.dialogue, topicId: call.topicId, fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
});

test('report shows Vienna date, time, duration and meeting details on single lines', () => {
  const text = renderReport({ call, customer, summary });
  assert.match(text, /\| Datum \| 2026-09-24 \|/);
  assert.match(text, /\| Uhrzeit \| 15:04 \(Europe\/Vienna\) \|/);
  assert.match(text, /\| Dauer \| 3 min 07 s \(laut Twilio\) \|/);
  assert.match(text, /Termin gewünscht: ja/);
  assert.match(text, /Hauptinteresse: Inferenz \/ RAG/);
  assert.doesNotMatch(text, /\n# Keine/);
  const refused = renderReport({ call: { ...call, summaryAllowed: false, dialogue: [] }, customer });
  assert.match(refused, /widersprochen/);
  assert.doesNotMatch(refused, /Folgetermin/);
});

test('reporter writes a private file, and skips the model when content is not allowed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'voice-report-'));
  try {
    const directory = join(root, 'reports');
    const store = { get: () => customer };
    const f = fakeFetch(() => ok(summary));
    const path = await createCallReporter({ apiKey: 'k', customerStore: store, directory, fetchImpl: f.impl, log() {} })(call);
    assert.match(path, /2026-09-24_1504_test-fixture_12345678\.md$/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.match(readFileSync(path, 'utf8'), /Dienstag vormittags/);
    assert.throws(() => writeReport(directory, { call, customer }, 'again'), /EEXIST/);
    const blocked = fakeFetch(() => ok(summary));
    const second = await createCallReporter({ apiKey: 'k', customerStore: store, directory, fetchImpl: blocked.impl, log() {} })({ ...call, callId: 'abcdefab-0000', summaryAllowed: false, dialogue: [] });
    assert.equal(blocked.requests.length, 0);
    assert.match(readFileSync(second, 'utf8'), /widersprochen/);
    const failing = await createCallReporter({ apiKey: 'k', customerStore: store, directory, fetchImpl: async () => { throw new Error('offline'); }, log() {} })({ ...call, callId: 'fedcbafe-0000' });
    assert.match(readFileSync(failing, 'utf8'), /fehlgeschlagen \(offline\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
