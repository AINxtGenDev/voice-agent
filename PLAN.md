# Voice Agent implementation plan

Prepared 18 September 2026. Status: proposed design; integrations and account access are not yet tested.

## 1. Intended workflow

1. The operator signs in on a phone or desktop.
2. Add or edit a customer: name, mobile number, optional email, selected language, and permission/contact preferences. Store telephone numbers in E.164 format in a private database.
3. Select the customer and one topic, initially HPE Private Cloud AI. Enter a short conversation objective and optional questions.
4. Start a conversation. Direct mobile calling is the provisional interpretation of the request; browser voice is the cheaper alternative awaiting a product decision.
5. The assistant introduces itself as an AI assistant acting for the configured operator, confirms willingness to continue, discusses the chosen topic, and captures needs and next steps. It stops on request.
6. After termination, the backend finalizes the transcript, creates a structured summary, and renders one self-contained, mobile-first HTML report.
7. Email that HTML file as an attachment to the operator's privately configured recipient address. Show report and delivery status in the dashboard. Customer email delivery is not part of the initial scope.

The supplied real example customer and recipient are stored only in ignored local configuration. They must not appear in public examples or Pages assets.

## 2. API access and model choice

Use `gpt-live-1` as requested. It requires a funded OpenAI API project with model access; the trusted server holds the project API key. A ChatGPT subscription does not include API usage. The published free API tier does not support this model. Actual account access remains unverified. [1][2][3]

An OpenRouter key is not an OpenAI credential. OpenRouter documents audio through Chat Completions, which does not establish support for the GPT-Live session protocol. Do not base voice connectivity on it without explicit provider support. It can optionally supply a text model for summaries or client-side delegation through our backend; using OpenAI alone initially reduces integration complexity. The existing unrelated project key is not needed during planning and has not been loaded. Prefer a dedicated project key and budget when implementing. [2][4]

GPT-Live handles speech; a separate backend model handles delegated work. Use a small, paid text model chosen through a short German-language accuracy evaluation. Do not assume free models provide adequate availability or suitable customer-data handling. [2]

## 3. Minimal architecture and hosting

```text
Public GitHub repository → GitHub Pages project overview

Authenticated responsive application → private HTTPS backend
                                         ├─ SQLite customer/call database
Customer browser ← WebRTC → GPT-Live      ├─ OpenAI project credentials
                     OR                  ├─ call/session orchestration
Customer telephone ← carrier ← backend   └─ durable report/email outbox
                                                ↓
                                    structured summary → HTML → email
```

Recommendation: a small TypeScript backend and plain HTML/CSS/TypeScript frontend, one process and SQLite initially, hosted on an existing always-on machine if suitable HTTPS ingress, maintenance, backup, and availability already exist. Otherwise select a small EU-hosted VM after checking current prices. Existing hardware avoids a new server rental but still has electricity, maintenance, and availability costs. Avoid Kubernetes, a vector database, and a managed voice-agent platform for this initial single-operator application.

GitHub Pages serves static files, not the backend. Publish only the project overview/demo there. GitHub restricts Pages hosting for online businesses, commercial transactions, and commercial SaaS; do not assume a live marketing dashboard is an eligible production workload. Host the authenticated application with its backend on a suitable host. Reports remain private attachments or authenticated downloads, never Pages files. [5][6]

### Browser mode: lowest communication cost

Create an expiring, single-use invitation tied to one customer and topic; the operator can share it. Customer joins in a browser, grants microphone access, and starts a WebRTC conversation. The backend performs session creation/signaling; long-lived API credentials never reach JavaScript. No telephone carrier or SMS service is needed if links are shared manually. Browser mode does not dial the supplied mobile number. [2]

### Telephone mode: requested mobile workflow

Use a programmable carrier such as Twilio, with a verified permitted caller identity. Backend creates an outbound call, validates carrier webhooks, and integrates the media with GPT-Live through its documented telephony/SIP or WebSocket path. A short proof of concept must establish outbound routing, codecs, interruption behavior, transcript completeness, and hangup propagation before choosing the final transport. Do not assume inbound SIP examples alone implement outbound calling. [2][7]

No provider subscription, number purchase, paid session, or live customer call is performed during planning.

## 4. Cost envelope

USD estimates, excluding taxes and currency conversion; rates checked 18 September 2026. These are component estimates, not an all-inclusive quote.

| Component | Published or proposed cost |
| --- | --- |
| GPT-Live voice | $0.05 per session minute, billed per second [1] |
| 5-minute browser conversation | $0.25 voice, plus backend text usage [1] |
| 100 × 5-minute conversations | $25 voice, plus backend text usage [1] |
| Austrian mobile example via Twilio | $0.0495/min for the listed EEA or US/CA origin routes; other routes differ [7] |
| Twilio Media Streams, if chosen | Additional $0.0044/min [7] |
| Illustrative 5-minute mobile call | $0.5195 for voice + qualifying mobile route + Media Streams; excludes text usage, rental, other features and taxes |
| Illustrative 100 × 5-minute mobile calls | $51.95 for those same components, before excluded charges |
| Number rental | Twilio lists Austrian local numbers at $1/month; availability and eligibility require verification [7] |
| Email | Use an existing mailbox via OAuth/SMTP if permitted; validate sending limits and attachment support |
| Application hosting | Existing server: incremental operating cost; otherwise obtain an EU VM quote |

Cost controls: one concurrent call, five-minute initial maximum enforced server-side, bounded delegation and summary tokens, no audio recording by default, no duplicate transcription service unless needed, no automatic redial, and a configurable application budget reservation before each call. Close idle/disconnected Live sessions explicitly. Provider spending alerts alone must not be treated as guaranteed hard limits. Measure actual usage in the pilot.

## 5. Conversation design

Assistant name: **HPE-Austria-Marketing-Agent**. Role: calm, friendly voice assistant discussing HPE Private Cloud AI. Default proposed language is German, selectable before calling; do not infer language from a name. Use concise questions and allow interruptions. Do not imply HPE employment or authorization unless the operator has established it.

Keep the voice instructions short. Use the OpenAI guide's Backchannel policy, Interruption policy, and Delegation policy structure. Put business rules and detailed product information in the backend. Only list capabilities actually implemented. [8]

Initial discussion: the customer's AI use case, current infrastructure, relevant data constraints, planned scale, timeline, and desired next step. Product answers use reviewed information from the supplied HPE page with source URL and review date. It describes a platform co-engineered with NVIDIA; discuss capabilities without inventing prices, benchmarks, deployment commitments, or compliance guarantees. [9]

Do not let spoken requests change the report recipient, access other customers, run arbitrary tools, or start another call. End the conversation on refusal; do not turn a refusal into a sales objection.

## 6. Report and email design

One UTF-8 HTML attachment with embedded CSS, system fonts, no JavaScript, external assets, trackers, or remote dependencies. Use a restrained green accent, accessible contrast, readable type, and a single-column layout from 320px upward; add a two-column layout only where useful on larger displays.

Sections: customer and topic; date/time and duration; executive summary; stated needs; questions and answers; objections or constraints; agreed actions with owners and dates; unresolved issues; source references. Distinguish customer statements from assistant claims and mark unknown facts explicitly. An incomplete call must produce a clearly marked partial report rather than a fabricated conclusion.

Generate schema-validated structured data from the finalized transcript, then render a deterministic template with HTML escaping. Never execute model-generated HTML. Give each report a unique call identifier and version. The plain-text email contains a short overview and the HTML attachment; recipients may need to download it before opening.

Create a durable outbox with a unique job key per call/report. Retry transient failures with bounded backoff, retain provider message identifiers, and handle ambiguous send outcomes without blindly resending. Distinguish queued, accepted by provider, delivered if a delivery signal exists, and failed. Keep the private report available if email fails.

## 7. Data and operational requirements

- Private database tables: customers, contact permissions, topics, calls, transcript events, reports, email jobs. Private configuration holds operator identity and report recipient.
- Authenticate every customer/read/write/call/report API; authorize the single operator server-side. CORS is not authentication. Use secure session handling and CSRF protection where cookie authentication is used.
- Signed and replay-protected webhooks, request limits, destination restrictions, call idempotency, and server-side budget enforcement.
- Keep secrets outside Git and static assets; redact logs. Encrypt disks/backups and restrict filesystem permissions. Define deletion/retention periods before real data enters the application.
- Store contact permission evidence and enforce withdrawal/do-not-call status. Review applicable marketing, AI disclosure, processing agreements, retention, and international transfer requirements before production use. This is a deployment task, not a claim that a checkbox establishes legal compliance.
- Capture transcript events durably with event IDs and ordering, reconcile completion events, and handle browser closure, connection loss, voicemail, busy/no-answer, and backend restarts.
- Monitor failed calls, unclosed sessions, summary failures, email failures, spend, and backup restoration. No raw audio retention by default.

## 8. Implementation sequence and acceptance criteria

1. **Integration proof:** verify funded OpenAI project access; prove one browser conversation and transcript finalization. For telephone mode, verify a single authorized test call and all hangup paths. Pass only when audio, transcript, and final usage are observed.
2. **Private application:** implement authentication, customer CRUD, topic selection, responsive UI, and durable call state. Verify access from a second device and deny unauthenticated requests.
3. **Conversation orchestration:** implement grounded HPE answers, selected-language behavior, interruption handling, stop handling, time limits, budget reservation, and reconnect/failure behavior.
4. **Report pipeline:** test transcript-to-summary factual accuracy, malicious transcript text escaping, partial calls, mobile report layout, and attachment generation.
5. **Email delivery:** configure a sender account privately, deliver to the configured operator, verify attachment readability, and test retries and ambiguous delivery outcomes.
6. **Pilot and operations:** use authorized test participants; measure per-call costs, latency, German pronunciation, report accuracy, and spend enforcement. Test backup restore and retention deletion before customer rollout.

Production credentials needed later: OpenAI API key; carrier credentials/caller identity for phone mode; email sender authorization; host/domain or equivalent secure ingress. A browser-only pilot needs no carrier account. The sender identity is distinct from the report recipient and remains to be configured.

## Sources

1. https://developers.openai.com/api/docs/models/gpt-live-1
2. https://developers.openai.com/api/docs/guides/live
3. https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
4. https://openrouter.ai/docs/guides/overview/multimodal/audio
5. https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
6. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
7. https://www.twilio.com/en-us/voice/pricing/at
8. https://developers.openai.com/api/docs/guides/live-prompting
9. https://www.hpe.com/emea_middle_east/en/products/private-cloud-ai.html
