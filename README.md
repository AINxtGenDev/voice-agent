# Voice Agent

Planning repository for a mobile-first customer conversation assistant using OpenAI `gpt-live-1`.

**Status:** the committed repository contains the implementation plan. Local prototype work remains uncommitted. An outbound Twilio SMS test has been verified; telephone calling and email delivery are not yet operational.

- [Implementation plan](PLAN.md)
- [API key setup and next steps](NEXT_STEPS.md)
- [Public project overview](https://ainxtgendev.github.io/voice-agent/)

GitHub Pages publishes only `docs/`. Never commit customer information, private phone numbers, transcripts, reports, credentials, or private operational configuration. The project Twilio number below is explicitly approved for publication. The production customer application requires an authenticated backend and suitable application hosting.

The proposed assistant is named HPE-Austria-Marketing-Agent. This repository is an independent project and does not establish HPE endorsement or authorization to represent HPE.

## Twilio telephone number and verification

- **Twilio number:** [+43 670 301 59 93](tel:+436703015993).
- **Region:** Ireland (`IE1`) for SMS and voice.
- **SMS:** one outbound test was reported as delivered by Twilio and receipt was confirmed by the recipient on 23 September 2026.
- **Voice:** the number is voice-enabled; application integration and live calling, two-way audio, and hangup validation remain outstanding.

The successful SMS test used an IE1-specific API key and `api.dublin.ie1.twilio.com`. SDK clients should specify `region: 'ie1'` and `edge: 'dublin'`. This verifies outbound SMS through the API; the Console tryout has not been verified as fixed. See [Twilio's regional messaging documentation](https://www.twilio.com/docs/global-infrastructure/messaging-api-with-twilio-regions) and [error 21663](https://www.twilio.com/docs/api/errors/21663), reviewed on 23 September 2026.

Only the project Twilio number above is approved for publication. Keep recipient numbers, API credentials, message records, and operational configuration private.
