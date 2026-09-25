# Voice Agent

Prototype and implementation plan for a mobile-first customer conversation assistant using OpenAI `gpt-live-1`.

**Status:** the prototype runs in Docker on a private home server behind a password-protected HTTPS endpoint (see [Docker deployment](#docker-deployment)). One real outbound Twilio IE1 call with spoken consent and an automatic call report was verified on 24 September 2026 through a temporary tunnel; a call through the Docker deployment has not yet been made. Private customer storage is implemented. Email delivery and production-grade authentication are not implemented.

- [Implementation plan](PLAN.md)
- [Deutscher HPE-Sprachagent: Ablauf und Gesprächsregeln](HPE_AGENT_PLAN.md)
- [HPE Private Cloud AI: Quellen und Wissensstand](HPE_PRIVATE_CLOUD_AI.md)
- [API key setup and next steps](NEXT_STEPS.md)
- [Local prototype: commands, verification, and recovery](LOCAL_DEVELOPMENT.md)
- [Telephone provider cost comparison](TELEPHONY_COSTS.md)
- [Session status](session.md)

GitHub Pages was disabled on 25 September 2026; `docs/` is kept only as the former planning overview. Never commit customer information, private phone numbers, transcripts, reports, credentials, or private operational configuration. The project Twilio number below is explicitly approved for publication. The production customer application requires an authenticated backend and suitable application hosting.

The proposed assistant is named HPE-Austria-Marketing-Agent. This repository is an independent project and does not establish HPE endorsement or authorization to represent HPE.

Use Node.js 22.17 or later. Run `npm ci` and `npm test`, then configure `OPENAI_API_KEY_FILE` (an external private file) or `OPENAI_API_KEY` before `npm start`. Open `http://127.0.0.1:3000` on the same machine. By default the server binds only to loopback. `public/` contains the prototype UI.

Maintain public progress notes in `session.md` after significant work. This file is tracked; keep private handoff details, credentials, and conversation content outside the repository.

## Docker deployment

The agent runs as two containers defined in [deploy/docker-compose.yml](deploy/docker-compose.yml): the Node.js app (built from the [Dockerfile](Dockerfile)) and Caddy as HTTPS reverse proxy ([deploy/Caddyfile](deploy/Caddyfile)).

- **Address:** `https://voicehpe.duckdns.org:10556`. The certificate comes from Let's Encrypt through the DuckDNS DNS-01 challenge; a cron job keeps the DuckDNS record current.
- **Access:** the operator UI requires a password (Caddy basic auth). Only `/twilio/*` is public, and the app rejects requests without a valid Twilio signature. The app container publishes no host port.
- **Configuration:** copy [deploy/.env.example](deploy/.env.example) to `deploy/.env` (mode `0600`, Git-ignored). Credentials, the contact database, and call reports are mounted from private host directories outside the checkout. The app reads `PUBLIC_UI_ORIGIN` (the one accepted HTTPS origin) and `LISTEN_HOST`.
- **Update:** `git pull && docker compose up -d --build` in `deploy/`. Stop with `docker compose down`.
- **Verified 25 September 2026:** certificate issued; login refused without or with a wrong password and accepted with the correct one, including from a phone over mobile data; unsigned Twilio requests rejected. **Unverified:** whether Twilio accepts port 10556 for callbacks and the Media Streams WebSocket — its [documentation](https://www.twilio.com/docs/global-infrastructure/firewall-configurations/media-streams-configuration) names only port 443. If it does not, forward external port 443 instead.

## Voice API cost comparison

Reviewed on **24 September 2026**. USD paid-tier prices; telephone charges, hosting, and taxes are excluded. Gemini is a proposed alternative and has not been integrated or tested in this project.

| Session duration | GPT-Live-1 voice session | Gemini 3.8 Live: illustrative new-audio subtotal* |
| --- | ---: | ---: |
| 1 minute | $0.05 | approximately $0.014 (1.4 cents) |
| 3 minutes | $0.15 | approximately $0.042 (4.2 cents) |
| 5 minutes | $0.25 | approximately $0.070 (7 cents) |

**GPT-Live-1:** $0.05 per session minute, billed per second without rounding up to a whole minute. Calculation: session minutes × $0.05. Backend model and tool usage is additional. [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

**Gemini 3.8 Live (`gemini-3.8-live`):** Google lists audio input at $3 per million tokens (approximately $0.005 per audio minute) and audio output at $12 per million tokens ($0.018 per audio minute). Text input is $0.75 and text output, including thinking, is $4.50 per million tokens. [Google API pricing](https://ai.google.dev/gemini-api/docs/pricing).

*Gemini example: the model listens throughout the session and speaks for half its duration. Using Google's displayed per-minute equivalents, the new-audio subtotal is `minutes × ($0.005 + 0.5 × $0.018) = minutes × $0.014`. The input-minute equivalent is rounded, so these figures are approximate. If output audio also lasts the full session duration, the corresponding subtotals are $0.023, $0.069, and $0.115.

**These Gemini subtotals are not total conversation prices or spending caps.** Proactive audio is permanently enabled for Gemini 3.8 Live, and listening incurs input charges. Google also bills retained conversation context again on each turn, including previous audio at the audio input rate. Text/thinking, enabled transcriptions, and tools can add costs. Therefore duration alone cannot determine the final Gemini bill; measure actual token usage and control retained context. [Google Live API billing guidance](https://ai.google.dev/gemini-api/docs/live-api/best-practices#pricing-and-billing).

## Twilio telephone number and verification

- **Twilio number:** [+43 670 301 59 93](tel:+436703015993).
- **Region:** Ireland (`IE1`) for SMS and voice.
- **SMS:** one outbound test was reported as delivered by Twilio and receipt was confirmed by the recipient on 23 September 2026.
- **Voice:** one outbound test call with spoken consent, a live conversation, clean closure, and an automatic report was verified on 24 September 2026. Calls through the Docker deployment are not yet verified.

The successful SMS test used an IE1-specific API key and `api.dublin.ie1.twilio.com`. SDK clients should specify `region: 'ie1'` and `edge: 'dublin'`. This verifies outbound SMS through the API; the Console tryout has not been verified as fixed. See [Twilio's regional messaging documentation](https://www.twilio.com/docs/global-infrastructure/messaging-api-with-twilio-regions) and [error 21663](https://www.twilio.com/docs/api/errors/21663), reviewed on 23 September 2026.

Only the project Twilio number above is approved for publication. Keep recipient numbers, API credentials, message records, and operational configuration private.
