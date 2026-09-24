# Voice Agent

Planning repository for a mobile-first customer conversation assistant using OpenAI `gpt-live-1`.

**Status:** the committed repository contains the implementation plan. Local prototype work remains uncommitted. An outbound Twilio SMS test has been verified; telephone calling and email delivery are not yet operational.

- [Implementation plan](PLAN.md)
- [API key setup and next steps](NEXT_STEPS.md)
- [Public project overview](https://ainxtgendev.github.io/voice-agent/)

GitHub Pages publishes only `docs/`. Never commit customer information, private phone numbers, transcripts, reports, credentials, or private operational configuration. The project Twilio number below is explicitly approved for publication. The production customer application requires an authenticated backend and suitable application hosting.

The proposed assistant is named HPE-Austria-Marketing-Agent. This repository is an independent project and does not establish HPE endorsement or authorization to represent HPE.

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
- **Voice:** the number is voice-enabled; application integration and live calling, two-way audio, and hangup validation remain outstanding.

The successful SMS test used an IE1-specific API key and `api.dublin.ie1.twilio.com`. SDK clients should specify `region: 'ie1'` and `edge: 'dublin'`. This verifies outbound SMS through the API; the Console tryout has not been verified as fixed. See [Twilio's regional messaging documentation](https://www.twilio.com/docs/global-infrastructure/messaging-api-with-twilio-regions) and [error 21663](https://www.twilio.com/docs/api/errors/21663), reviewed on 23 September 2026.

Only the project Twilio number above is approved for publication. Keep recipient numbers, API credentials, message records, and operational configuration private.
