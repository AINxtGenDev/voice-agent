const elements = Object.fromEntries(['start', 'stop', 'status', 'phase', 'elapsed', 'usage', 'audio', 'limit', 'test-permission', 'topic-select'].map(id => [id, document.getElementById(id)]));
let current = null;
let serverState = 'unknown';
let maximumSeconds = 60;
let polling = false;
const terminalStates = new Set(['idle', 'closed']);

function display(phase, message) {
  elements.phase.textContent = phase;
  elements.status.textContent = message;
}
function buttons() {
  elements.start.disabled = Boolean(current) || !terminalStates.has(serverState) || !elements['test-permission'].checked;
  elements.stop.disabled = !current || current.stopping;
  elements['test-permission'].disabled = Boolean(current);
}
async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The local server could not complete the request.');
  return result;
}
function showUsage(usage, confirmed = false) {
  if (typeof usage?.seconds === 'number' && Number.isFinite(usage.seconds)) {
    elements.usage.textContent = `${usage.seconds.toFixed(1)} s${confirmed ? ' · final' : ' · provisional'}`;
  }
}
function stopMicrophone(run) {
  run.microphone?.getTracks().forEach(track => track.stop());
}
function cleanup(run) {
  run.done = true;
  stopMicrophone(run);
  clearTimeout(run.connectTimer);
  clearTimeout(run.closeTimer);
  clearInterval(run.clock);
  clearInterval(run.heartbeat);
  run.events?.close();
  run.peer?.close();
  if (current === run) {
    elements.audio.srcObject = null;
    current = null;
    buttons();
  }
}
async function backendClose(id) {
  try { await request('/api/close', { id }); } catch { /* Polling reports server availability; closure is not assumed. */ }
}
function finish(run, confirmed) {
  if (current !== run || run.done) return;
  cleanup(run);
  display(confirmed ? 'Ended' : 'Finalization unconfirmed', confirmed
    ? 'The server confirmed that the conversation ended. See reported usage below when available.'
    : 'Microphone stopped. Finalization is unconfirmed; checking the server. Do not start another test until it is ready.');
  void poll();
}
function stop(run, message = 'Finishing the conversation…') {
  if (current !== run || run.stopping || run.done) return;
  run.stopping = true;
  stopMicrophone(run);
  clearTimeout(run.connectTimer);
  display('Stopping', message);
  buttons();
  if (run.ready && run.events?.readyState === 'open') {
    try { run.events.send(JSON.stringify({ type: 'session.close' })); } catch { /* The server close path below is independent. */ }
  }
  if (run.id) void backendClose(run.id);
  if (!run.id && !run.creating) {
    cleanup(run);
    display('Stopped', 'Test cancelled. The microphone is off.');
    return;
  }
  run.closeTimer = setTimeout(() => finish(run, false), 15000);
}
function waitForIce(run) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => complete(new Error('ICE gathering timed out.')), 10000);
    function complete(error) {
      clearTimeout(timer);
      run.peer.removeEventListener('icegatheringstatechange', onState);
      error ? reject(error) : resolve();
    }
    function onState() {
      if (run.done || run.stopping) complete(new Error('Cancelled.'));
      else if (run.peer.iceGatheringState === 'complete') complete();
    }
    run.peer.addEventListener('icegatheringstatechange', onState);
    onState();
  });
}
async function heartbeat(run) {
  if (run.beating || run.done || run.stopping || current !== run) return;
  run.beating = true;
  try { await request('/api/heartbeat', { id: run.id }); }
  catch { if (current === run) stop(run, 'Server heartbeat failed. Stopping the test.'); }
  finally { run.beating = false; }
}
async function start() {
  if (current || !terminalStates.has(serverState) || !elements['test-permission'].checked) return;
  const run = { done: false, stopping: false, ready: false, creating: false, topicId: elements['topic-select'].value, startedAt: Date.now() };
  current = run;
  buttons();
  elements.usage.textContent = 'Not available';
  elements.elapsed.textContent = '00:00';
  display('Connecting', 'Allow microphone access to begin the local test.');
  run.connectTimer = setTimeout(() => stop(run, 'Connection timed out. Stopping the test.'), 30000);
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('Use a browser with WebRTC and microphone support on localhost or HTTPS.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (run.done || run.stopping || current !== run) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    run.microphone = stream;
    run.peer = new RTCPeerConnection();
    run.peer.addEventListener('track', event => {
      if (current !== run || run.done || run.stopping) return;
      elements.audio.srcObject = new MediaStream([event.track]);
      elements.audio.play().catch(() => {
        if (current === run && !run.stopping) display('Audio paused', 'Use the audio controls to hear the assistant.');
      });
    });
    run.peer.addEventListener('connectionstatechange', () => {
      if (['failed', 'disconnected'].includes(run.peer.connectionState)) stop(run, 'The media connection was interrupted. Stopping the test.');
    });
    stream.getAudioTracks().forEach(track => run.peer.addTrack(track, stream));
    run.events = run.peer.createDataChannel('oai-events');
    run.events.addEventListener('message', ({ data }) => {
      if (current !== run || run.done) return;
      let event;
      try { event = JSON.parse(data); } catch { stop(run, 'An invalid session event was received. Stopping the test.'); return; }
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
        stop(run, 'An invalid session event was received. Stopping the test.');
        return;
      }
      if (event.type === 'session.started') {
        run.ready = true;
        clearTimeout(run.connectTimer);
        if (run.stopping) {
          run.events.send(JSON.stringify({ type: 'session.close' }));
          return;
        }
        display('Connected', 'Microphone is live. Speak in German when you are ready.');
      } else if (event.type === 'session.closed') {
        showUsage(event.usage);
        stop(run, 'Final session event received. Waiting for server confirmation…');
        if (run.id) void backendClose(run.id);
      } else if (event.type === 'session.usage.updated') {
        showUsage(event.usage);
      } else if (event.type === 'error') {
        stop(run, 'The voice service reported an error. Stopping the test.');
      }
      // Transcript and nested response payloads are deliberately not retained or logged.
    });
    run.events.addEventListener('close', () => {
      if (!run.done) stop(run, 'The event connection closed. Checking finalization with the server.');
    });
    await run.peer.setLocalDescription(await run.peer.createOffer());
    await waitForIce(run);
    if (run.done || run.stopping || current !== run) return;
    run.creating = true;
    serverState = 'creating';
    const result = await request('/api/session', { sdp: run.peer.localDescription.sdp, topicId: run.topicId, permission: true });
    run.creating = false;
    run.id = result.session?.id;
    if (typeof run.id !== 'string') throw new Error('The server returned an invalid session identifier.');
    if (run.done || run.stopping || current !== run) {
      await backendClose(run.id);
      if (current === run) finish(run, false);
      return;
    }
    run.heartbeat = setInterval(() => void heartbeat(run), 3000);
    void heartbeat(run);
    run.startedAt = Date.now();
    run.clock = setInterval(() => {
      const seconds = Math.floor((Date.now() - run.startedAt) / 1000);
      elements.elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= maximumSeconds) stop(run, 'The test duration limit was reached. Finishing the conversation…');
    }, 250);
    await run.peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
  } catch (error) {
    run.creating = false;
    if (current !== run || run.done) return;
    if (run.id) {
      stop(run, 'Connection failed. Stopping the test and checking finalization.');
    } else {
      cleanup(run);
      display('Unable to connect', error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow access in your browser and try again.'
        : error.message || 'Connection failed. Check the local server.');
      void poll();
    }
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  const observed = current;
  try {
    const result = await request('/api/status');
    if (current !== observed) return;
    serverState = result.state;
    if (Number.isFinite(result.maxDurationSeconds)) {
      maximumSeconds = result.maxDurationSeconds;
      elements.limit.textContent = String(maximumSeconds);
    }
    if (!current || result.id === current.id) showUsage(result.usage, result.state === 'closed');
    if (current?.id && result.id === current.id && ['closed', 'unconfirmed'].includes(result.state)) {
      finish(current, result.state === 'closed');
    } else if (!current && result.state === 'closed') {
      display('Ended', 'The server confirmed that the conversation ended.');
    } else if (!current && result.state === 'idle' && ['Checking server', 'Server unavailable', 'Server busy'].includes(elements.phase.textContent)) {
      display('Ready', 'Start when you are ready. Your microphone is currently off.');
    } else if (!current && result.state === 'unconfirmed') {
      display('Finalization unconfirmed', 'Microphone stopped. The server could not confirm finalization. Check its terminal before another test.');
    } else if (!current && !terminalStates.has(result.state)) {
      display('Server busy', 'The server is handling or finalizing a session. Waiting for it to become ready.');
    }
    buttons();
  } catch {
    if (current !== observed) return;
    serverState = 'unknown';
    if (current) stop(current, 'The local server is unavailable. Stopping the test.');
    else display('Server unavailable', 'Start the local server, then keep this page open to reconnect.');
    buttons();
  } finally { polling = false; }
}
elements['test-permission'].addEventListener('change', buttons);
elements.start.addEventListener('click', () => void start());
elements.stop.addEventListener('click', () => current && stop(current));
function leave() {
  if (!current) return;
  const run = current;
  stop(run, 'The page is leaving the foreground. Stopping the test.');
  if (run.id) navigator.sendBeacon('/api/close', new Blob([JSON.stringify({ id: run.id })], { type: 'application/json' }));
}
window.addEventListener('pagehide', leave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
setInterval(() => void poll(), 2500);
void poll();
