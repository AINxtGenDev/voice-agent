import { mkdir, writeFile, access } from 'node:fs/promises';
import WebSocket from 'ws';
import { loadCredential } from '../src/credentials.mjs';
import { DEFAULT_PROMPT_DIR, mulawWav, promptFile, requiredPromptTexts } from '../src/voice-prompts.mjs';

// Paid, operator-run: records each carrier sentence with the same Live model and voice as
// the call (gpt-live-1, cedar, 8 kHz μ-law), so caller hears one voice from start to end.
// GPT-Live sends no "audio done" event and keeps streaming silent audio, so a sentence ends
// GRACE_MS after Live's transcript completes the text; silence is trimmed off both ends.
// A recording is kept only if that transcript matches the text word for word.
// Usage: node scripts/render-voice-prompts.mjs [--force]
const GRACE_MS = 1_500;
const PAD = 1_200; // 150 ms of silence kept before and after the voice.
const ATTEMPTS = 3;
const READER = 'Sie sind ein professioneller deutscher Sprecher für Telefonansagen. Sie führen kein Gespräch, stellen keine Fragen und delegieren nichts. Sobald Sie einen Text erhalten, lesen Sie ihn genau einmal wörtlich vor: ruhig, freundlich, natürlich und professionell, in normalem Telefontempo, ohne ein Wort hinzuzufügen, wegzulassen oder zu verändern. Danach schweigen Sie.';
// G.711 μ-law magnitude, enough to tell speech from line silence.
const level = (byte) => { const u = ~byte & 0xff; return (((u & 0x0f) << 3) + 0x84 << ((u & 0x70) >> 4)) - 0x84; };
function trim(audio) {
  let start = 0;
  let end = audio.length;
  while (start < end && level(audio[start]) < 200) start++;
  while (end > start && level(audio[end - 1]) < 200) end--;
  return audio.subarray(Math.max(0, start - PAD), Math.min(audio.length, end + PAD));
}
const words = (text) => text.normalize('NFKC').toLocaleLowerCase('de-AT').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function record(apiKey, text) {
  return new Promise((resolve) => {
    const audio = [];
    let transcript = '';
    let quiet;
    let done = false;
    let silence;
    let closing = false;
    const result = { ok: false, transcript: '', seconds: null, audio: null, error: null };
    const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10_000, maxPayload: 1024 * 1024, followRedirects: false });
    const send = (event) => socket.send(JSON.stringify(event));
    const watchdog = setTimeout(() => { result.error = 'timeout'; socket.terminate(); }, 40_000);
    const close = () => {
      if (closing) return;
      closing = true;
      clearInterval(silence); clearTimeout(quiet);
      if (socket.readyState === WebSocket.OPEN) send({ type: 'session.close' }); else socket.terminate();
    };
    socket.on('open', () => send({ type: 'session.start', session: { model: 'gpt-live-1', store: false, instructions: READER, audio: { format: { type: 'audio/pcmu', rate: 8000 }, output: { voice: 'cedar' } }, delegation: { type: 'client' } } }));
    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw); } catch { result.error = 'invalid message'; close(); return; }
      if (event.type === 'session.started') {
        // Keep the input side alive with μ-law silence (0xFF), as a quiet phone line would.
        silence = setInterval(() => { if (!closing && socket.readyState === WebSocket.OPEN) send({ type: 'session.input_audio.append', audio: Buffer.alloc(160, 0xff).toString('base64') }); }, 20);
        send({ type: 'session.instructions.append', delegation_id: null, content: `Lesen Sie jetzt genau diesen Text wörtlich vor und sagen Sie sonst nichts: ${text}` });
        quiet = setTimeout(() => { result.error = 'incomplete'; close(); }, 30_000);
      } else if (event.type === 'session.output_audio.delta' && !closing) {
        audio.push(Buffer.from(event.delta, 'base64'));
      } else if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
        transcript += event.delta;
        // Normalized character count reached: the transcript covers the whole text.
        if (!done && words(transcript).length >= words(text).length) { done = true; clearTimeout(quiet); quiet = setTimeout(close, GRACE_MS); }
      }
      else if (event.type === 'session.delegation.created') { result.error = 'delegated'; close(); }
      else if (event.type === 'error') { result.error = event.error?.message ?? 'provider error'; close(); }
      else if (event.type === 'session.closed') { result.seconds = event.usage?.seconds ?? null; socket.close(); }
    });
    socket.on('unexpected-response', (_request, response) => { result.error = `HTTP ${response.statusCode}`; response.resume(); socket.terminate(); });
    socket.on('error', (error) => { result.error ??= error.message; });
    socket.on('close', () => {
      clearTimeout(watchdog); clearInterval(silence); clearTimeout(quiet);
      result.transcript = transcript.trim();
      result.audio = trim(Buffer.concat(audio));
      result.ok = !result.error && result.audio.length > 8000 && words(result.transcript) === words(text);
      resolve(result);
    });
  });
}

const force = process.argv.includes('--force');
const apiKey = await loadCredential();
await mkdir(DEFAULT_PROMPT_DIR, { recursive: true });
let failed = 0;
for (const text of requiredPromptTexts()) {
  const target = new URL(promptFile(text), DEFAULT_PROMPT_DIR);
  if (!force && await access(target).then(() => true, () => false)) { console.log(`skip ${promptFile(text)} (exists)`); continue; }
  let saved = false;
  for (let attempt = 1; attempt <= ATTEMPTS && !saved; attempt++) {
    const result = await record(apiKey, text);
    console.log(JSON.stringify({ file: promptFile(text), attempt, ok: result.ok, seconds: result.seconds, audioSeconds: +(result.audio.length / 8000).toFixed(1), error: result.error, ...(result.ok ? {} : { heard: result.transcript }) }));
    if (result.ok) { await writeFile(target, mulawWav(result.audio)); saved = true; }
  }
  if (!saved) failed++;
}
if (failed) { console.error(`${failed} sentence(s) not recorded verbatim.`); process.exitCode = 1; }
