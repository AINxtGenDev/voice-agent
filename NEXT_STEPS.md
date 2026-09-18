# Next Steps: OpenAI API Key and First GPT-Live Conversation

Documentation reviewed: **18 September 2026**. This repository currently contains a plan and public overview; the operational application has not been implemented. No account access or paid API session was tested when preparing this guide.

## 1. Obtain the correct API credential

**Create your key on the [OpenAI API keys page](https://platform.openai.com/api-keys).** There is no separate model-specific “GPT-Live key”: use an OpenAI project API key and select `gpt-live-1` when creating a Live session. The credential must remain on a trusted server. See the [API quickstart](https://developers.openai.com/api/docs/quickstart) and [GPT-Live setup guide](https://developers.openai.com/api/docs/guides/live).

1. Sign in to the [OpenAI API Platform](https://platform.openai.com/), completing account setup if necessary.
2. Select the organization that should own and pay for this application.
3. Create a dedicated development project, for example `voice-agent-dev`, using the project selector. If project creation is unavailable, ask your organization administrator to create it and grant access.
4. Confirm that this project is selected before configuring billing controls or creating a key.

Use a separate production project later to isolate access and expenditure. This follows OpenAI's [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

## 2. Enable API billing and set spending controls

1. Open [API billing settings](https://platform.openai.com/settings/organization/billing).
2. Configure the payment method and funding required by your account. Confirm that the API account has usable quota; possession of a key alone does not establish this.
3. Open the development project's **Settings → Limits**. Under **Spend**, edit the monthly limit and enable **Enforce a hard limit**. Choose a small development allowance appropriate to your budget.
4. Configure alerts below that limit. Alerts only notify; hard limits reject affected requests, and enforcement can lag slightly. Retain application-level duration and concurrency controls. See [spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

The published `gpt-live-1` rate is **USD 0.05 per minute**, billed per second; backend model and tool usage cost extra. Five minutes therefore costs USD 0.25 for the voice session alone, excluding telephony and other components. The free API tier is unsupported. Recheck the [model page](https://developers.openai.com/api/docs/models/gpt-live-1) before testing.

## 3. Create and safeguard the project key

1. Return to [API keys](https://platform.openai.com/api-keys) with `voice-agent-dev` selected.
2. Use the key creation control, typically **Create new secret key**. Give it an identifiable name such as `voice-agent-local-dev`.
3. Apply the minimum permissions needed by the selected Live example and its backend model. Follow your organization's key governance requirements; production credentials should have a dedicated service identity where supported.
4. Set an expiry and record a rotation date. Save the secret immediately in your password manager or secret manager.
5. Never place the key in `docs/`, browser JavaScript, Git commits, screenshots, issue descriptions, or chat messages. Replace an exposed key promptly.

If creation is disabled, ask the administrator to review your permissions and key governance settings. OpenAI documents environment-based secret loading, key expiration, rotation, and creation restrictions in its [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

## 4. Make the key available locally

For an initial Linux/Bash development session, enter the key interactively rather than embedding it in a shell command:

```bash
set +x
read -r -s -p 'OpenAI project API key: ' OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
```

The prompt hides input and avoids putting the literal key in shell history. Start the future backend from this shell so it inherits the variable. Do not print the variable. Once finished, stop the backend and remove the shell variable:

```bash
unset OPENAI_API_KEY
```

OpenAI SDKs read `OPENAI_API_KEY` from the environment; see the [quickstart](https://developers.openai.com/api/docs/quickstart). This repository does not yet provide a backend start command. For persistent deployment, inject the credential through the host's secret management facility. The existing `.gitignore` excludes `.env`, but an ignored file is not a secret manager.

## 5. Verify access through a minimal browser prototype

This is the **next implementation task**, not an existing repository feature.

1. Follow the official [GPT-Live WebRTC quickstart](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) to implement its browser and trusted-server components. Use `gpt-live-1` for speech and an accessible supported backend model for delegation.
2. Serve the prototype on localhost, or authenticated HTTPS for a remote device. Keep the project key exclusively on the server.
3. Use synthetic information and your own microphone for the first brief, paid test.
4. Confirm `session.started`, bidirectional audio, interruption handling, and a successful backend result.
5. Explicitly close the Live session and inspect final usage. Verify that session cleanup also works after browser disconnection.

A saved key or successful session creation alone does not prove the complete workflow. Record the test outcome without secrets. The official [getting-started guide](https://developers.openai.com/api/docs/guides/live) explains the separate startup, audio, backend, and closure checks.

## 6. Resolve access or billing failures

- **Authentication failure:** check the selected project's credential, expiry, and whether the backend received the environment variable.
- **Permission or model-access failure:** have the administrator check project restrictions and eligibility. Do not assume every funded account has access to every feature.
- **Spending failure:** inspect the returned error code. `project_spend_limit_exceeded`, `organization_spend_limit_exceeded`, and `credit_balance_exhausted` require different remedies; repeated retries do not restore funding.

Use the [spend-limit troubleshooting instructions](https://developers.openai.com/api/docs/guides/spend-limits) for billing-related errors. Record only redacted diagnostics when requesting assistance.

## 7. Implement the remaining application in order

After the browser proof succeeds, follow [PLAN.md, section 8](PLAN.md#8-implementation-sequence-and-acceptance-criteria):

1. **Confirm the delivery mode:** browser voice for the initial technical proof; add a carrier integration if outbound mobile calls remain required. An OpenAI key alone does not provision a telephone service.
2. **Build the private application:** authentication, customer records, topic selection, and durable call state. Keep the public `docs/` overview separate.
3. **Implement conversation controls:** approved product sources, language selection, stop handling, a five-minute initial cap, and one concurrent call.
4. **Build reports:** finalize transcripts, validate structured summaries, escape content in deterministic HTML templates, and mark incomplete calls.
5. **Add email delivery:** privately configure the operator's recipient and sender authorization; implement a durable outbox and bounded retries.
6. **Complete operational acceptance:** test unauthorized access, disconnections, duplicate jobs, budget enforcement, backup restoration, and deletion. Complete the deployment reviews specified in the plan before using real customer data.

**Immediate milestone:** a dedicated funded project, a securely stored key, and one verified browser voice conversation with explicit session closure and observed usage.
