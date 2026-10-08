import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import WebSocket, { WebSocketServer } from 'ws';
import { openingForTopic, GOODBYE, buildConversationInstructions, buildBackendInstructions, objectsToSummary, BACKEND_MODEL, KNOWLEDGE_TOOL, ConversationGate } from './conversation-policy.mjs';
import { createLiveConversation } from './live-conversation.mjs';
import { loadVoicePrompts, requiredPromptTexts } from './voice-prompts.mjs';

const terminal = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
const phone = /^\+[1-9][0-9]{7,14}$/u;
const ANSWER_PAUSE_SECONDS = 2; // Silence after pickup before the opening.
const DIALOGUE_LIMIT = 40_000;
const WRAP_UP_MS = 120_000;
const NUDGE = 'Die Person hat auf die Frage noch nicht geantwortet. Fragen Sie kurz und freundlich nach, ob Sie gut zu hören sind, und wiederholen Sie die Frage sinngemäß in einem Satz.';
const WRAP_UP = 'Die verfügbare Gesprächszeit endet in etwa zwei Minuten. Brechen Sie nichts abrupt ab: Gehen Sie noch auf das zuletzt Gesagte ein, bieten Sie dann, falls noch nicht geschehen, einen Folgetermin mit HPE-Expertinnen und -Experten an, fassen Sie Vereinbartes kurz zusammen und verabschieden Sie sich innerhalb der nächsten Minute freundlich.';


// Operational event log: identifiers, states and provider event types only — never audio, transcripts or phone numbers.
const log = (call, event, details = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), call: call?.id?.slice(0, 8) ?? null, event, ...details }));

export class TelephonyError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export function createTelephony({ accountSid, authToken, fromNumber, publicBaseUrl, apiKey, region = 'ie1', edge = 'dublin', client = twilio(accountSid, authToken, { region, edge, autoRetry: false, timeout: 10_000 }), WebSocketImpl = WebSocket, maxDurationSeconds = 900, closeTimeoutMs = 10_000, startupTimeoutMs = 20_000, nudgeMs = 7_000, idleMs = 45_000, reportWaitMs = 20_000, prompts = loadVoicePrompts(), onState = () => {}, onSuppression = () => {}, onFinished = () => {} } = {}) {
  const base = new URL(publicBaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Public telephony URL must be an HTTPS origin.');
  if (!/^AC[a-fA-F0-9]{32}$/u.test(accountSid) || !authToken || !apiKey || !phone.test(fromNumber)) throw new Error('Invalid telephony configuration.');
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 1800) throw new Error('Invalid call duration.');
  const statusUrl = `${base.origin}/twilio/status`;
  const mediaUrl = `${base.origin.replace(/^https:/u, 'wss:')}/twilio/media`;
  if (!requiredPromptTexts().every((text) => prompts.has(text))) throw new Error('Missing voice recordings for carrier prompts.');
  const recordings = new Map([...prompts.values()].map((prompt) => [`/twilio/audio/${prompt.file}`, { data: prompt.data, etag: `"${createHash('sha256').update(prompt.data).digest('hex').slice(0, 16)}"` }]));
  // Carrier-side sentences are recordings of the Live voice; an unrecorded text is a bug, not a reason for a second voice.
  const play = (xml, text) => {
    const prompt = prompts.get(text);
    if (!prompt) throw new Error('No recording for carrier prompt.');
    xml.play(`${base.origin}/twilio/audio/${prompt.file}`);
  };
  let current = null;
  let shuttingDown = false;
  const snapshot = (call) => call ? { id: call.id, customerId: call.customerId, topicId: call.topicId, permission: call.permission, ...(call.callSid ? { callSid: call.callSid } : {}), state: call.state, liveState: call.liveState, finalized: call.phoneEnded && ['not-started', 'closed'].includes(call.liveState), startedAt: call.startedAt, ...(call.usage ? { usage: call.usage } : {}), ...(call.liveDropped ? { liveDropped: true } : {}) } : null;
  const publish = (call) => onState(snapshot(call));
  const status = () => ({ configured: true, provider: 'twilio', reason: null, call: snapshot(current) });
  // Dialogue is kept in memory only until the report is handed off.
  const remember = (call, speaker, text) => {
    if (typeof text !== 'string' || !text || call.dialogueLength + text.length > DIALOGUE_LIMIT) return;
    call.dialogueLength += text.length;
    const last = call.dialogue.at(-1);
    if (last?.speaker === speaker) last.text += text; else call.dialogue.push({ speaker, text });
    if (speaker === 'customer' && objectsToSummary(call.dialogue.at(-1).text)) call.summaryAllowed = false;
  };
  const report = (call) => {
    if (call.reported) return;
    call.reported = true;
    clearTimeout(call.reportTimer);
    const endedAt = call.endedAt ?? new Date().toISOString();
    const carrier = call.carrierDuration !== undefined;
    const summaryAllowed = call.summaryAllowed && call.permission === 'granted';
    const data = { callId: call.id, customerId: call.customerId, topicId: call.topicId, permission: call.permission, outcome: call.state, startedAt: call.startedAt, answeredAt: call.answeredAt ?? null, endedAt,
      durationSeconds: carrier ? call.carrierDuration : (call.answeredAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(call.answeredAt)) / 1000)) : 0),
      durationSource: carrier ? 'carrier' : 'local', liveDropped: Boolean(call.liveDropped), summaryAllowed, dialogue: summaryAllowed ? call.dialogue : [] };
    call.dialogue = [];
    Promise.resolve().then(() => onFinished(data)).catch(() => {});
  };
  const finish = (call) => {
    if (call.phoneEnded && ['not-started', 'closed'].includes(call.liveState)) {
      call.endedAt ??= new Date().toISOString();
      clearTimeout(call.wrapUpTimer);
      clearTimeout(call.nudgeTimer);
      clearTimeout(call.idleTimer);
      clearTimeout(call.deadline);
      clearTimeout(call.startupTimer);
      clearTimeout(call.closeTimer);
      call.state = call.phoneStatus ?? 'completed';
      call.conversation?.dispose();
      call.media?.terminate();
      publish(call);
      // Report after the final state is set; wait briefly for the carrier's duration.
      if (call.carrierDuration !== undefined) report(call);
      else if (!call.reported && !call.reportTimer) { call.reportTimer = setTimeout(() => report(call), reportWaitMs); call.reportTimer.unref?.(); }
    }
  };
  const send = (socket, data) => {
    if (socket?.readyState !== WebSocketImpl.OPEN || socket.bufferedAmount > 256 * 1024) throw new Error('Media transport unavailable.');
    socket.send(JSON.stringify(data));
  };
  const stop = async () => {
    const call = current;
    if (!call || terminal.has(call.state)) return status();
    if (call.stopping) { await call.stopping; return status(); }
    log(call, 'stop.begin', { state: call.state, liveState: call.liveState, phoneEnded: call.phoneEnded });
    call.state = 'closing';
    try { publish(call); } catch { /* Cleanup must proceed even if local journaling fails. */ }
    call.stopping = (async () => {
      await call.creation?.catch(() => {});
      clearTimeout(call.startupTimer);
      call.media?.terminate();
      const liveClose = new Promise((resolve) => {
        if (['not-started', 'closed'].includes(call.liveState)) return resolve();
        // No session exists before the socket opens, so there is nothing to close gracefully.
        if (call.liveState === 'connecting') { call.liveState = 'closed'; call.live?.terminate(); return resolve(); }
        call.resolveLiveClose = resolve;
        call.closeTimer = setTimeout(() => { log(call, 'live.close_timeout'); call.liveState = 'unconfirmed'; call.live?.terminate(); resolve(); }, closeTimeoutMs);
        try { send(call.live, { type: 'session.close' }); log(call, 'live.close_sent'); } catch (error) { log(call, 'live.close_send_failed', { error: error.message, readyState: call.live?.readyState }); call.liveState = 'unconfirmed'; clearTimeout(call.closeTimer); call.live?.terminate(); resolve(); }
      });
      if (call.callSid && !call.phoneEnded) {
        try {
          const result = await client.calls(call.callSid).update({ status: 'completed' });
          if (terminal.has(result.status)) { call.phoneEnded = true; call.phoneStatus = result.status; }
        } catch { /* An unsuccessful cancellation never proves the call ended. */ }
      }
      await liveClose;
      if (!call.phoneEnded || !['not-started', 'closed'].includes(call.liveState)) call.state = 'unconfirmed';
      log(call, 'stop.end', { state: call.state, liveState: call.liveState, phoneEnded: call.phoneEnded });
      finish(call);
      publish(call);
    })();
    await call.stopping;
    return status();
  };
  const abort = (call = current) => {
    if (!call || call !== current || terminal.has(call.state)) return;
    void stop().catch(() => { if (call === current) call.state = 'unconfirmed'; });
  };

  async function start({ customerId, mobile, topicId = 'hpe-private-cloud-ai' }) {
    if (shuttingDown || (current && !terminal.has(current.state))) throw new TelephonyError('A call is already reserved or its closure is unconfirmed.');
    if (typeof customerId !== 'string' || !customerId || typeof mobile !== 'string' || !phone.test(mobile) || mobile === fromNumber) throw new TelephonyError('Invalid customer destination.', 400);
    openingForTopic(topicId); // Validate the server-approved topic before any paid operation.
    const call = { id: randomUUID(), customerId, topicId, permission: 'pending', permissionAttempt: 0, permissionGate: new ConversationGate(topicId), state: 'dialing', liveState: 'not-started', startedAt: new Date().toISOString(), nonce: randomBytes(32).toString('hex'), phoneEnded: false, dialogue: [], dialogueLength: 0, summaryAllowed: true };
    const xml = permissionPrompt(call, openingForTopic(topicId), ANSWER_PAUSE_SECONDS);
    current = call;
    publish(call); // Durable reservation must succeed before the paid request.
    remember(call, 'agent', openingForTopic(topicId));
    call.creation = (async () => {
      try {
        const result = await client.calls.create({ to: mobile, from: fromNumber, twiml: xml.toString(), timeLimit: maxDurationSeconds, timeout: 20, statusCallback: statusUrl, statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'] });
        if (!/^CA[a-fA-F0-9]{32}$/u.test(result.sid)) throw new Error('Invalid provider response');
        call.callSid = result.sid;
        publish(call);
        call.deadline = setTimeout(() => abort(call), (maxDurationSeconds + 60) * 1000); // Covers ringing (timeout 20 s) plus margin.
      } catch (error) {
        const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
        call.state = rejected ? 'failed' : 'unconfirmed';
        call.phoneEnded = rejected;
        call.phoneStatus = rejected ? 'failed' : undefined;
        publish(call);
        throw new TelephonyError('Telephone provider could not confirm call creation. Check call status before retrying.', 502);
      }
    })();
    await call.creation;
    if (shuttingDown) await stop();
    return snapshot(call);
  }

  function permissionPrompt(call, message, pauseSeconds = 0) {
    const xml = new twilio.twiml.VoiceResponse();
    if (pauseSeconds) xml.pause({ length: pauseSeconds });
    play(xml, message);
    xml.gather({ input: 'speech', language: 'de-DE', speechTimeout: 'auto', timeout: 7, actionOnEmptyResult: true, method: 'POST', action: `${base.origin}/twilio/permission?attempt=${call.permissionAttempt}` });
    xml.hangup();
    return xml;
  }

  const gateway = http.createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    const respond = (code) => { response.writeHead(code, { 'Cache-Control': 'no-store' }); response.end(); };
    // Public, fixed recordings of the opening sentences; Twilio does not sign <Play> fetches.
    const recording = recordings.get(request.url);
    // Per the <Play> docs, an ETag lets Twilio cache; no-cache makes it revalidate after a re-recording.
    if (recording && ['GET', 'HEAD'].includes(request.method)) {
      if (request.headers['if-none-match'] === recording.etag) { response.writeHead(304, { ETag: recording.etag, 'Cache-Control': 'no-cache' }); return response.end(); }
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': recording.data.length, ETag: recording.etag, 'Cache-Control': 'no-cache' });
      return response.end(request.method === 'HEAD' ? undefined : recording.data);
    }
    const permissionRequest = /^\/twilio\/permission\?attempt=[01]$/u.test(request.url ?? '');
    if (request.method !== 'POST' || (request.url !== '/twilio/status' && !permissionRequest)) return respond(404);
    if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return respond(415);
    try {
      let body = '';
      for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 16384) return respond(413); }
      const pairs = new URLSearchParams(body);
      const params = Object.fromEntries(pairs);
      if (Array.from(pairs.keys()).length !== Object.keys(params).length) return respond(400);
      if (!twilio.validateRequest(authToken, request.headers['x-twilio-signature'] ?? '', permissionRequest ? `${base.origin}${request.url}` : statusUrl, params)) return respond(403);
      const call = current;
      await call?.creation?.catch(() => {});
      if (!call || params.AccountSid !== accountSid || params.CallSid !== call.callSid) return respond(403);
      if (permissionRequest) {
        const attempt = Number(new URL(request.url, base).searchParams.get('attempt'));
        if (call.permission !== 'pending' || attempt !== call.permissionAttempt || ['closing', 'unconfirmed'].includes(call.state) || terminal.has(call.state)) return respond(409);
        const speech = typeof params.SpeechResult === 'string' ? params.SpeechResult.trim() : '';
        call.answeredAt ??= new Date().toISOString();
        if (speech) remember(call, 'customer', speech.slice(0, 1000));
        const result = speech ? call.permissionGate.handleTranscript(speech) : call.permissionGate.handleSilence();
        log(call, 'permission.result', { attempt, action: result.action, rule: result.rule ?? null, heardSpeech: Boolean(speech), confidence: params.Confidence ?? null });
        let xml;
        if (result.action === 'consent_granted' && result.mayDiscussProduct) {
          call.permission = 'granted';
          xml = new twilio.twiml.VoiceResponse();
          // Answer the consent at once with the recorded Live voice; Live connects while this plays.
          play(xml, result.message);
          remember(call, 'agent', result.message);
          const stream = xml.connect().stream({ url: mediaUrl });
          stream.parameter({ name: 'reservation', value: call.nonce });
          xml.hangup();
        } else if (result.action !== 'end' && attempt === 0) {
          call.permissionAttempt = 1;
          xml = permissionPrompt(call, result.message);
        } else {
          call.permission = 'denied';
          if (result.suppressContact) onSuppression(call.customerId);
          xml = new twilio.twiml.VoiceResponse();
          play(xml, GOODBYE);
          xml.hangup();
        }
        publish(call);
        response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(xml.toString());
        if (call.permission === 'granted') {
          // Live connects while Twilio speaks the answer; the stream must follow within the startup limit.
          call.startupTimer = setTimeout(() => abort(call), startupTimeoutMs);
          try { openLive(call); } catch (error) { log(call, 'live.open_failed', { error: error.message }); abort(call); }
        }
        return;
      }
      log(call, 'twilio.status', { status: params.CallStatus, duration: params.CallDuration ?? null });
      if (terminal.has(params.CallStatus) && /^[0-9]{1,6}$/u.test(params.CallDuration ?? '')) call.carrierDuration = Number(params.CallDuration);
      if (params.CallStatus === 'in-progress') call.answeredAt ??= new Date().toISOString();
      if (!terminal.has(call.state)) {
        if (terminal.has(params.CallStatus)) {
          call.phoneEnded = true;
          call.phoneStatus = params.CallStatus;
          finish(call);
          abort(call);
        } else if (['queued', 'initiated', 'ringing', 'in-progress'].includes(params.CallStatus) && !['closing', 'unconfirmed'].includes(call.state)) {
          const rank = { dialing: 0, queued: 0, initiated: 1, ringing: 2, 'in-progress': 3 };
          if ((rank[params.CallStatus] ?? 0) >= (rank[call.state] ?? 0)) call.state = params.CallStatus;
          publish(call);
        }
      }
      if (terminal.has(call.state) && call.carrierDuration !== undefined) report(call);
      respond(204);
    } catch { respond(400); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  gateway.on('upgrade', (request, socket, head) => {
    const valid = request.url === '/twilio/media' && twilio.validateRequest(authToken, request.headers['x-twilio-signature'] ?? '', mediaUrl, {});
    if (!valid || !current || current.permission !== 'granted' || terminal.has(current.state) || current.media || ['closing', 'unconfirmed'].includes(current.state)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, (media) => attachMedia(media, current));
  });

  function attachMedia(media, call) {
    call.media = media;
    log(call, 'media.open');
    media.on('error', (error) => { log(call, 'media.error', { error: error.message }); abort(call); });
    media.on('close', (code) => {
      log(call, 'media.close', { code, state: call.state }); if (!terminal.has(call.state) && call.state !== 'closing') abort(call); });
    media.on('message', async (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== 'object' || typeof event.event !== 'string') throw new Error('Invalid envelope');
        if (event.event !== 'media') log(call, `media.${event.event}`);
        if (event.event === 'connected') return;
        if (event.event === 'start') {
          if (call.streamSid || call.startReceived) throw new Error('Duplicate stream');
          call.startReceived = true;
          await call.creation;
          const startEvent = event.start;
          const nonce = startEvent?.customParameters?.reservation;
          if (call !== current || call.state === 'closing' || call.state === 'unconfirmed' || startEvent?.accountSid !== accountSid || startEvent?.callSid !== call.callSid || typeof nonce !== 'string' || nonce.length !== call.nonce.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(call.nonce)) || !/^MZ[a-fA-F0-9]{32}$/u.test(startEvent?.streamSid) || startEvent?.mediaFormat?.encoding !== 'audio/x-mulaw' || startEvent.mediaFormat.sampleRate !== 8000 || startEvent.mediaFormat.channels !== 1) throw new Error('Unauthorized media stream');
          call.streamSid = startEvent.streamSid;
          if (call.liveState === 'active') ready(call);
        } else if (event.event === 'media') {
          // Twilio sends audio right behind start; drop it while start is still being validated.
          if (call.startReceived && !call.streamSid) return;
          if (event.streamSid !== call.streamSid || typeof event.media?.payload !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(event.media.payload) || event.media.payload.length > 8192) throw new Error('Invalid audio');
          if (call.liveState === 'active' && call.state !== 'closing') send(call.live, { type: 'session.input_audio.append', audio: event.media.payload });
        } else if (event.event === 'stop') abort(call);
      } catch (error) { log(call, 'media.rejected', { error: error.message }); abort(call); }
    });
  }

  // Both legs are up: the caller has heard the question, so silence from here on is real.
  function ready(call) {
    clearTimeout(call.startupTimer);
    call.nudgeTimer = setTimeout(() => {
      if (call.callerHeard) return;
      log(call, 'live.silence_nudge');
      try { send(call.live, { type: 'session.instructions.append', delegation_id: null, content: NUDGE }); } catch { /* The idle limit still ends the call. */ }
    }, nudgeMs);
    keepAlive(call);
  }
  // Ends calls in which neither side has spoken for idleMs, so a silent line does not run until the call limit.
  function keepAlive(call) {
    clearTimeout(call.idleTimer);
    call.idleTimer = setTimeout(() => { log(call, 'idle_hangup'); abort(call); }, idleMs);
  }

  function openLive(call) {
    call.liveState = 'connecting';
    publish(call);
    const live = new WebSocketImpl('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'local-voice-agent/0.1' }, handshakeTimeout: 10_000, maxPayload: 1024 * 1024, followRedirects: false });
    call.live = live;
    live.on('open', () => {
      log(call, 'live.open');
      try {
        if (call.state === 'closing' || call.state === 'unconfirmed' || call.liveState === 'closed') { call.liveState = 'closed'; live.terminate(); return; }
        call.liveState = 'starting';
        send(live, { type: 'session.start', session: { model: 'gpt-live-1', store: false, instructions: buildConversationInstructions(call.topicId, { phoneConsentAnswered: true }), audio: { format: { type: 'audio/pcmu', rate: 8000 }, output: { voice: 'cedar' } }, delegation: { type: 'responses', responses: { model: BACKEND_MODEL, instructions: buildBackendInstructions(call.topicId), reasoning: { effort: 'medium' }, tools: [KNOWLEDGE_TOOL], tool_choice: 'auto', parallel_tool_calls: false } } } });
      } catch { abort(call); }
    });
    live.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new Error('Invalid envelope');
        call.liveLastMessageAt = Date.now();
        const inner = event.type === 'response.event' ? event.event?.type : null;
        if (!(inner ?? event.type).endsWith('.delta')) log(call, `live.${event.type}`, { ...(inner ? { inner } : {}), ...(event.type === 'error' ? { error: event.error ?? null } : {}) });
        if (call.liveState === 'closed') return;
        if (event.type === 'session.started') {
          if (['closing', 'unconfirmed'].includes(call.state)) { send(live, { type: 'session.close' }); return; }
          call.liveState = 'active';
          call.state = 'in-progress';
          publish(call);
          call.conversation = createLiveConversation({ send: (event) => send(live, event), close: () => { try { send(call.media, { event: 'clear', streamSid: call.streamSid }); } catch { /* Stop still closes both legs. */ } abort(call); }, onSuppression: () => onSuppression(call.customerId), topicId: call.topicId, consentGranted: true, delegationMode: 'responses' });
          call.conversation.start();
          if (call.streamSid) ready(call);
          const remaining = maxDurationSeconds * 1000 - (Date.now() - Date.parse(call.answeredAt ?? call.startedAt));
          if (maxDurationSeconds > 180) call.wrapUpTimer = setTimeout(() => { try { send(live, { type: 'session.instructions.append', delegation_id: null, content: WRAP_UP }); } catch { /* The carrier limit still ends the call. */ } }, Math.max(0, remaining - WRAP_UP_MS));
        } else if (event.type === 'session.output_audio.delta' && call.state === 'in-progress') {
          if (typeof event.delta !== 'string') throw new Error('Invalid audio');
          if (!call.firstAudioLogged) { call.firstAudioLogged = true; log(call, 'live.first_audio'); }
          // The caller cannot hear anything before the stream starts; replaying it later would talk over their answer.
          if (!call.streamSid) { if (!call.earlyAudioLogged) { call.earlyAudioLogged = true; log(call, 'live.audio_before_stream_dropped'); } return; }
          send(call.media, { event: 'media', streamSid: call.streamSid, media: { payload: event.delta } });
        } else if (event.type === 'session.closed') {
          clearTimeout(call.closeTimer);
          call.liveState = 'closed';
          call.usage = event.usage ?? null;
          call.resolveLiveClose?.();
          live.close();
          if (!call.phoneEnded) abort(call);
          finish(call);
        } else if (event.type === 'error') abort(call);
        else {
          if (event.type === 'session.input_transcript.delta' && event.delta?.trim()) {
            call.callerHeard = true;
            if (call.streamSid) send(call.media, { event: 'clear', streamSid: call.streamSid });
          }
          if (event.type === 'session.input_transcript.delta') remember(call, 'customer', event.delta);
          if (event.type === 'session.output_transcript.delta') remember(call, 'agent', event.delta);
          if (['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type) && event.delta?.trim()) keepAlive(call);
          call.conversation?.handle(event);
        }
      } catch (error) { log(call, 'live.handler_failed', { error: error.message }); abort(call); }
    });
    live.on('error', (error) => { log(call, 'live.socket_error', { error: error.message }); abort(call); });
    live.on('close', (code, reason) => {
      log(call, 'live.socket_close', { code, reason: reason?.toString().slice(0, 200), liveState: call.liveState, sinceLastMessageMs: call.liveLastMessageAt ? Date.now() - call.liveLastMessageAt : null });
      if (call.liveState === 'closed') return;
      // The socket is gone, so nothing more can be sent on it. As in OpenAI's WebSocket example,
      // record the missing final usage (liveDropped) instead of blocking every later call.
      call.liveState = 'closed';
      call.liveDropped = true;
      call.resolveLiveClose?.();
      abort(call);
      finish(call);
    });
  }

  async function shutdown() {
    shuttingDown = true;
    await stop();
    if (current && terminal.has(current.state)) report(current);
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    if (gateway.listening) await new Promise((resolve) => { gateway.close(resolve); gateway.closeAllConnections(); });
  }
  return { gateway, status, start, stop, shutdown };
}
