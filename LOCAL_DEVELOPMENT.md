# Local Voice Prototype

## Scope and current evidence

As of 24 September 2026, the repository includes a loopback-only Node.js server and a browser WebRTC interface. Authentication and model listing succeeded with the configured project. After funding, a short WebSocket test started and finalized without provider errors (reported duration: 0 seconds). Browser WebRTC with synthetic silence connected successfully and the server confirmed closure with 18.0 seconds of final voice usage. Real microphone conversation quality and backend delegation remain unverified. Manage funding through [OpenAI billing](https://platform.openai.com/settings/organization/billing). See the official [billing error guidance](https://developers.openai.com/api/docs/guides/spend-limits).

This prototype is for synthetic development conversations. Customer names, international mobile numbers, the selected product, and contact permission records are stored privately in `.private/customers.sqlite` (owner-only permissions). The interface supports saving, selecting, and deleting customers. “… start conversation” stays disabled until both a topic and a customer are chosen; the server also rejects call and session requests without a supported topic. Telephone activation remains disabled until a carrier integration is configured. It includes a permission-first telephone adapter (not live-call verified) and a curated HPE lookup connected through client delegation. Login, production hosting, complete HPE manual ingestion, reports, and email remain unimplemented. Do not expose it through a reverse proxy or bind it to the network. The public Pages directory remains `docs/`.

## 1. Install and test

Use Node.js 22.17 or later, then run from the repository root:

```bash
npm ci
npm test
```

The tests use synthetic credentials and mock providers; they do not call OpenAI. The built-in `node:sqlite` module is used for customer storage (experimental in the tested Node 22 runtime). `ws` and `twilio` are the external runtime dependencies, pinned in the lockfile. The prototype uses native JavaScript modules to avoid a build step; TypeScript remains a proposed choice for the full application.

## 2. Configure the external credential

Set the path to your existing file, without copying the secret into this repository:

```bash
export OPENAI_API_KEY_FILE=/absolute/path/to/private/.env
export OPENAI_API_KEY_NAME=voice
```

The loader supports either `voice=...` or a record containing `name: voice` followed by `API-key: ...`. It requires exactly one match and a regular file with owner-only permissions (`0600` or `0400`). It reads the file as text and never executes it. An explicitly set `OPENAI_API_KEY` takes precedence over file configuration; unset a stale value if necessary. All variables belong to the server environment.

## 3. Verify access and session startup

```bash
npm run check:access
npm run test:live
```

The first command checks authentication and model visibility. The second is a **paid** WebSocket protocol test: it opens `gpt-live-1`, sends approximately one second of synthetic silence, requests closure, and requires a final event with usage. It does not use a microphone or verify speech quality, browser WebRTC, or backend delegation. Run it only after billing is ready; do not repeatedly retry billing failures.

## 4. Start the browser interface

```bash
npm start
```

Open `http://127.0.0.1:3000` on the same machine. Select the HPE topic, explicitly check the paid local-test opt-in, then select **Start voice test**, permit microphone access, and answer the German permission question with a short, clear answer before asking a product question. Select **End test** and verify server-confirmed closure and final voice usage. Headphones avoid feedback. The long-lived key remains on the server.

For another computer, use an authenticated SSH tunnel to the loopback service rather than exposing the unauthenticated server. The phone workflow and production authentication remain future work.

## 5. Controls and failure handling

- One session is reserved before contacting OpenAI; concurrent requests are rejected.
- The default duration is 60 seconds, measured from creation start. `MAX_SESSION_SECONDS` accepts 1–300. The server requests closure at the deadline and after 15 seconds without a browser heartbeat.
- Stop, tab hiding, and page exit release microphone input. The server observes finalization through a separate control connection. A transport disconnect alone is not success.
- Ambiguous creation or missing finalization enters `unconfirmed`, blocking new sessions in the current process. **Restarting clears in-memory state and is not evidence of provider closure.** Check the provider's session state and usage before restarting after an uncertain outcome.
- Timers and cleanup are best effort under network/process failures; they are not a guaranteed spending cap. Configure project spending controls. Client delegation uses the bounded local HPE lookup; no separate Responses model is invoked by this implementation.
- No audio or transcripts are persisted by this application. `store:false` disables optional Live session storage; it is not a claim about all provider retention. No raw provider error messages are logged.

## Verification record

Automated checks cover concurrency, ambiguous creation, finalization timeout, heartbeat loss, late callbacks, shutdown, duration enforcement, credential selection, file permissions, Host/Origin restrictions, and sanitized billing errors. Browser checks verified initial readiness, 390px layout without horizontal overflow, microphone denial, and cancellation while permission was pending. A funded browser WebRTC test with synthetic audio subsequently verified session startup and server-confirmed closure (18.0 seconds). Real microphone speech, interruption quality, and backend delegation still require acceptance testing. Additional regressions cover malformed sideband events, preservation of final usage, and a fixed smoke-test finalization deadline.

Implementation references: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [WebSocket](https://developers.openai.com/api/docs/guides/voice-websockets?api=live), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations), and [delegation limits](https://developers.openai.com/api/docs/guides/live-delegation).

## HPE agent integration checkpoint — 24 September 2026

- Shared German instructions identify the assistant as created by Werner, ask permission first, and require friendly, respectful conduct. Curated HPE facts retain their source/version metadata; complete handbooks are not ingested.
- Telephone setup is off by default. To configure it privately, set `ENABLE_TELEPHONY=true`, `TWILIO_CREDENTIAL_FILE`, and `TWILIO_PUBLIC_BASE_URL` to a public HTTPS origin. Regional defaults are `TWILIO_REGION=ie1` and `TWILIO_EDGE=dublin`; the credentials and callback validation token must belong to the intended region. An IE1 API key ID/secret is not interchangeable with the regional account Auth Token expected by this loader.
- The telephone callback gateway listens only on `127.0.0.1:3001`. An independently configured HTTPS proxy must route only `/twilio/status`, `/twilio/permission`, and the `/twilio/media` WebSocket there. Never publish the unauthenticated operator service on port 3000. No proxy, host, or carrier account configuration was changed in this checkpoint.
- Before Live media can connect, Twilio reads the exact German introduction and obtains a final Gather speech result. Only an explicitly recognized affirmative answer enables the stream. Ambiguity or no answer receives at most one clarification. This uses carrier speech recognition and can incur additional carrier charges; real recognition and playback remain unverified.
- New call requests require a persisted idempotency key. Unresolved calls block further spending across restarts. Reconcile provider state before manually changing any unresolved journal; no automatic redial or automatic journal deletion is implemented.
- The browser prototype has a permission response deadline and gates lookup through client delegation. Transcript fragments do not define complete turns, so this is not an assured pre-playback consent filter. Browser voice state also remains in memory; do not restart after uncertain provider closure without reconciliation.
- `npm run test:agent-live` is an explicit paid, bounded 15-second synthetic-silence test. It emits flags and usage only. The run on 24 September started, acknowledged instructions, produced audio, and closed with 14 seconds reported usage and zero provider errors. The transcript-based introduction check did **not** pass; exact spoken wording and conversation behavior remain unverified. The command therefore exited with failure as intended.
- Offline tests and the browser UI check are separate evidence: contact save/select and unchecked opt-in were exercised with a temporary database and paid requests disabled. Desktop keyboard focus and 320px layout passed; no horizontal overflow. The initial cross-site document-navigation rejection was corrected while keeping API origin checks.

Protocol sources reviewed on 24 September 2026: [Twilio Gather](https://www.twilio.com/docs/voice/twiml/gather), [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages), [Live transcripts and lifecycle](https://developers.openai.com/api/docs/guides/live-conversations), [Live client delegation](https://developers.openai.com/api/docs/guides/live-delegation).
