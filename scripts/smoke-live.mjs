import WebSocket from 'ws';
import { loadCredential } from '../src/credentials.mjs';
import { pathToFileURL } from 'node:url';

// A paid, voice-only protocol check: no microphone, transcript, or backend tools.
// Never prints raw provider events, headers, or error messages.
export async function smoke({ apiKey, WebSocketImpl = WebSocket, audioDurationMs = 1000, startupTimeoutMs = 15_000, closeTimeoutMs = 15_000, reportError = console.error } = {}) {
  apiKey ??= await loadCredential();
  const socket = new WebSocketImpl('wss://api.openai.com/v1/live/sessions', {
    headers: { Authorization: `Bearer ${apiKey}` },
    handshakeTimeout: 10_000,
    maxPayload: 1024 * 1024,
  });
  const result = { started: false, finalized: false, audioSent: false, finalSeconds: null, providerErrors: 0 };
  await new Promise((resolve, reject) => {
    let timer;
    let audioTimer;
    let closeTimer;
    let settled = false;
    let closing = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeTimer);
      clearInterval(audioTimer);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      if (error) reject(error);
      else resolve();
    };
    const close = () => {
      if (closing || settled) return;
      closing = true;
      clearInterval(audioTimer);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
      clearTimeout(timer);
      timer = setTimeout(() => {
        socket.terminate();
        finish(new Error('Finalization timed out; final usage unconfirmed.'));
      }, closeTimeoutMs);
    };
    timer = setTimeout(() => { socket.terminate(); finish(new Error('Startup timed out.')); }, startupTimeoutMs);
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'session.start',
      session: {
        model: 'gpt-live-1', store: false,
        instructions: 'This is a brief technical connection test. Do not delegate tasks. Remain silent unless spoken to.',
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } },
        delegation: { type: 'client' },
      },
    })));
    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw); } catch { result.providerErrors++; close(); return; }
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
        result.providerErrors++;
        close();
        return;
      }
      if (event.type === 'session.started' && !result.started && !closing && !settled) {
        result.started = true;
        clearTimeout(timer);
        audioTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'session.input_audio.append', audio: Buffer.alloc(4800).toString('base64') }));
          result.audioSent = true;
        }, 100);
        closeTimer = setTimeout(close, audioDurationMs);
      } else if (event.type === 'session.closed') {
        result.finalized = true;
        result.finalSeconds = typeof event.usage?.seconds === 'number' ? event.usage.seconds : null;
        finish();
      } else if (event.type === 'error') {
        result.providerErrors++;
        const safe = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null;
        reportError(JSON.stringify({ providerErrorCode: safe(event.error?.code), parameter: safe(event.error?.param) }));
        // Do not echo a message that may contain request content or identifiers.
        if (result.started) close();
        else finish(new Error('Provider rejected Live startup; see the redacted error code above.'));
      }
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error(`Live handshake rejected (HTTP ${response.statusCode}).`));
    });
    socket.on('error', () => finish(new Error('Live transport failed; final usage unconfirmed.')));
    socket.on('close', () => {
      if (!result.finalized) finish(new Error('Transport closed without session.closed.'));
    });
  });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smoke().then((result) => {
    console.log(JSON.stringify(result));
    if (!result.started || !result.finalized || result.finalSeconds === null || result.providerErrors) process.exitCode = 1;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
