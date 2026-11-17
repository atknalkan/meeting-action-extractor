# Meeting Action Extractor

A paid AI agent service on Stellar. Send a meeting transcript and get back its action items as JSON: each task with
its owner, due date, priority and the exact quote where it was agreed, plus the decisions and a short summary.
Buyers (people or agents) pay **0.01 USDC** per transcript over x402, and are charged **only if the extraction
succeeds**.

Source: https://github.com/atknalkan/meeting-action-extractor · Live: https://meeting-actions.92-5-73-99.sslip.io (Stellar Mainnet, 8004 agent 77) ·
Mainnet proof: [evidence/README.md](evidence/README.md)

Built on [Stellar Agent Services](https://github.com/AlgoriaLabs/stellar-agent-services) Provider Standard v1 with its
Provider Kit, and registered on Stellar 8004 so agents can find it.

## The service

`POST /services/meeting-actions/jobs`

```json
{ "transcript": "Alice: I'll send the checklist by Friday.\nBob: I'll fix the login bug.", "meetingDate": "2026-11-17", "participants": ["Alice", "Bob"] }
```

Only `transcript` is needed (20 to 100,000 characters). `meetingDate` lets "by Friday" become `2026-11-20`.

```json
{
  "summary": "…",
  "actionItems": [
    { "task": "Send the updated checklist", "owner": "Alice", "dueDate": "2026-11-20", "dueText": "by Friday", "priority": "medium", "evidence": "I'll send the checklist by Friday." }
  ],
  "decisions": ["…"]
}
```

`owner`, `dueDate`, `dueText` and `evidence` are `null` when the transcript doesn't say. `evidence` is kept only if
it really appears in the transcript. The manifest is at `/.well-known/stellar-agent-services.json`, and
`/openapi.json` and `/llms.txt` describe the same service for agents that don't know the standard.

## How it works

```
buyer ─POST─▶ Provider Kit ─402─▶ buyer pays (x402, USDC) ─▶ one model call (Gemini free tier) ─▶ checks ─▶ 200 + JSON
                                                              the payment settles only after a valid result
```

| Piece | Choice | Cost |
| --- | --- | --- |
| Model | Gemini Flash-Lite, then Groq and OpenRouter if their keys are set (free tiers) | $0 |
| Hosting | Co-hosted on an existing Oracle VM: own user, port 8792, Caddy HTTPS via sslip.io | $0 more |
| Jobs | SQLite on the VM (the kit's job store: survives restarts, lets buyers recover results) | $0 |
| Payments | OpenZeppelin facilitator (mainnet), x402.org (testnet); fees sponsored | $0 |
| Stellar | The payout account's reserve and the registration fees | about 2.5 XLM, once |

## Run it

```bash
npm ci
npm test                                   # offline, including a full 402 → pay → result flow
cp .env.example .env                       # set GEMINI_API_KEY
npm run extract -- test/fixtures/standup.txt --date 2026-11-17   # one extraction, no payment, no server
```

For the paid service on testnet: set `STELLAR_NETWORK=stellar:testnet` and an empty `PAY_TO`, then `npm run dev`,
and from another terminal `npm run check`, `npm run verify` and `npm run try`.

| Command | What |
| --- | --- |
| `npm test` | Offline tests |
| `npm run extract -- <file> [--date YYYY-MM-DD]` | One extraction on this computer |
| `npm run dev` | The service at http://localhost:8787 |
| `npm run try` | Pays for one call with test money (testnet only) |
| `npm run check` / `npm run verify` | The kit's self-check, and the external check C1–C7 |
| `npm run launch -- --url https://<host> --local-wallet --no-deploy --no-wait --no-validation` | Payout account and Stellar 8004 registration |
| `npm run deploy` | Builds, uploads and installs on the VM in `deploy/oracle/target.env` |
| `npm run status -- --url https://<host>` | Where it stands |

## Deploy

1. `cp deploy/oracle/target.env.example deploy/oracle/target.env` and name the VM.
2. `npm run launch -- …` (above). With `--local-wallet` the kit makes the owner's account, keeps its key in the OS
   keychain and, on mainnet, names the XLM to send it. It saves `PAY_TO` and `AGENT_ID` in `.env`.
3. `npm run deploy`. The installer adds a system user, a systemd unit (`meeting-actions`, 384 MB, half a CPU) and one
   Caddy site imported from the existing Caddyfile. A failed health check puts the previous release back.

Income arrives as USDC in the payout account: `npx provider-kit wallet` shows it, and
`npx provider-kit wallet withdraw --to <G…> --network mainnet` moves it to an account of yours.

## Keys

Nothing here holds a Stellar secret key: not the server, not the scripts, not `.env`. The server knows only the public
`PAY_TO`. `.env` holds the model key and the facilitator key; it stays out of git, and `npm run deploy` uploads only
the settings the server reads.

## Layout

| Path | What |
| --- | --- |
| `src/config.ts` | Environment → settings |
| `src/service.ts` | The paid service: price, schemas, example |
| `src/extract.ts` | The prompt, and the checks on the model's answer |
| `src/llm.ts` | The chain of OpenAI-compatible free models |
| `src/app.ts`, `src/server.ts` | The provider and the process |
| `src/cli.ts` | `npm run extract` |
| `deploy/oracle/` | `npm run deploy`: uploader, on-VM installer, systemd unit |
| `vendor/` | Provider Kit packages packed from stellar-agent-services at `a6664e9` (ahead of npm 0.1.1) |
| `NOTES.md` | Handoff notes and status, for the next person or agent |

## Limits

- Plain text only (no audio). Up to 100,000 characters.
- Free model tiers can rate-limit and may use prompts for training. Don't send confidential meetings.
