import WebSocket from 'ws';
import { buildConversationInstructions } from './conversation-policy.mjs';
import { createLiveConversation } from './live-conversation.mjs';

export class ProviderError extends Error {
  constructor(message, { definitive = false, code = null } = {}) {
    super(message);
    this.definitive = definitive;
    this.code = code;
  }
}

export function createLiveProvider({ apiKey, fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
  if (!apiKey) throw new Error('An API credential is required');
  return {
    async create(sdp) {
      let response;
      try {
        response = await fetchImpl('https://api.openai.com/v1/live/sessions', {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({
            session: {
              model: 'gpt-live-1',
              store: false,
              instructions: buildConversationInstructions(),
              delegation: { type: 'client' },
            },
            transport: { type: 'webrtc', sdp },
          }),
        });
      } catch {
        throw new ProviderError('Session creation outcome is unknown; additional sessions are blocked.');
      }
      if (!response.ok) {
        const allowed = new Set(['credit_balance_exhausted', 'insufficient_quota', 'project_spend_limit_exceeded', 'organization_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'model_not_found', 'invalid_api_key']);
        let code = null;
        try {
          const body = await response.json();
          if (allowed.has(body.error?.code)) code = body.error.code;
        } catch { /* Raw error bodies are never exposed. */ }
        throw new ProviderError('OpenAI rejected session creation.', { definitive: response.status >= 400 && response.status < 500, code });
      }
      let result;
      try { result = await response.json(); } catch {
        throw new ProviderError('Invalid session response; creation outcome is unknown.');
      }
      if (typeof result?.session?.id !== 'string' || !result.session.id || typeof result?.transport?.sdp !== 'string' || !result.transport.sdp || result.transport.type !== 'webrtc') {
        throw new ProviderError('Invalid session response; creation outcome is unknown.');
      }
      return { session: { id: result.session.id }, transport: { type: 'webrtc', sdp: result.transport.sdp } };
    },
    attach(id, { onClosed, onLost, onUsage }) {
      const socket = new WebSocketImpl(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        handshakeTimeout: 10_000,
        maxPayload: 1024 * 1024,
        followRedirects: false,
      });
      let finalized = false;
      let opened = false;
      let unavailable = false;
      let rejectReady;
      const conversation = createLiveConversation({
        send(event) { socket.send(JSON.stringify(event)); },
        close() { socket.send(JSON.stringify({ type: 'session.close' })); },
      });
      const ready = new Promise((resolve, reject) => {
        rejectReady = reject;
        socket.once('open', () => {
          opened = true;
          try { conversation.start(); resolve(); } catch { lost(); }
        });
      });
      const lost = () => {
        if (finalized || unavailable) return;
        unavailable = true;
        conversation.dispose();
        rejectReady(new Error('Session control connection failed.'));
        onLost();
        socket.terminate();
      };
      socket.on('error', lost);
      socket.on('close', lost);
      socket.on('message', (data) => {
        if (finalized || unavailable) return;
        let event;
        try { event = JSON.parse(data.toString()); } catch { lost(); return; }
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || !event.type) {
          lost();
          return;
        }
        if (event.type === 'session.usage.updated') onUsage?.(event.usage ?? null);
        if (event.type === 'session.closed' && !finalized) {
          finalized = true;
          conversation.dispose();
          onClosed(event.usage ?? null);
          socket.close();
        } else { try { conversation.handle(event); } catch { lost(); } }
      });
      return {
        ready,
        requestClose() {
          if (unavailable || !opened || socket.readyState !== WebSocketImpl.OPEN) throw new Error('Control connection is unavailable.');
          socket.send(JSON.stringify({ type: 'session.close' }));
        },
        dispose() { conversation.dispose(); socket.terminate(); },
      };
    },
  };
}
