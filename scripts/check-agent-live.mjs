import WebSocket from 'ws';
import { loadCredential } from '../src/credentials.mjs';
import { buildConversationInstructions } from '../src/conversation-policy.mjs';
import { createLiveConversation } from '../src/live-conversation.mjs';

// Explicit paid protocol check, at most 15 seconds of silence. No microphone,
// telephone call, transcript output, or audio recording. Usage comes from server.
const result = { started: false, instructionAcknowledged: false, outputAudioReceived: false, introductionRecognized: false, finalized: false, seconds: null, providerErrors: 0 };
let inputTimer;
let closeTimer;
let watchdog;
let transcript = '';
let closing = false;
let conversation;
try {
  const apiKey = await loadCredential();
  const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', {
    headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10_000, maxPayload: 1024 * 1024, followRedirects: false,
  });
  const send = event => socket.send(JSON.stringify(event));
  const close = () => {
    if (closing) return;
    closing = true;
    clearInterval(inputTimer);
    clearTimeout(closeTimer);
    conversation?.dispose();
    if (socket.readyState === WebSocket.OPEN) send({ type: 'session.close' });
    else socket.terminate();
  };
  conversation = createLiveConversation({ send, close });
  await new Promise(resolve => {
    watchdog = setTimeout(() => { socket.terminate(); resolve(); }, 35_000);
    socket.on('open', () => send({ type: 'session.start', session: {
      model: 'gpt-live-1', store: false, instructions: buildConversationInstructions(),
      audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' },
    } }));
    socket.on('message', raw => {
      try {
        const event = JSON.parse(raw);
        if (event.type === 'session.started' && !result.started) {
          result.started = true;
          conversation.start();
          inputTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN && !closing) send({ type: 'session.input_audio.append', audio: Buffer.alloc(4800).toString('base64') }); }, 100);
          closeTimer = setTimeout(close, 15_000);
        } else if (event.type === 'session.instructions.appended') result.instructionAcknowledged = true;
        else if (event.type === 'session.output_audio.delta') result.outputAudioReceived = true;
        else if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
          transcript = (transcript + event.delta).slice(-4000);
          result.introductionRecognized = /Werner/iu.test(transcript) && /HPE/iu.test(transcript) && /Darf ich/iu.test(transcript);
        } else if (event.type === 'session.closed') {
          result.finalized = true;
          result.seconds = typeof event.usage?.seconds === 'number' ? event.usage.seconds : null;
          socket.close();
          resolve();
        } else if (event.type === 'error') { result.providerErrors++; close(); }
      } catch { result.providerErrors++; close(); }
    });
    socket.on('unexpected-response', (_request, response) => { response.resume(); result.providerErrors++; socket.terminate(); resolve(); });
    socket.on('error', () => { result.providerErrors++; resolve(); });
    socket.on('close', resolve);
  });
  socket.terminate();
} catch { result.providerErrors++; }
finally {
  clearInterval(inputTimer); clearTimeout(closeTimer); clearTimeout(watchdog);
  conversation?.dispose(); transcript = '';
  console.log(JSON.stringify(result));
  if (!result.started || !result.instructionAcknowledged || !result.outputAudioReceived || !result.introductionRecognized || !result.finalized || result.providerErrors) process.exitCode = 1;
}
