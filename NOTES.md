# Handoff notes: Meeting Action Extractor

For the next AI agent that picks this up. Read this file first, then `README.md`. Update the **Status** list
whenever a step finishes.

## What this is

A paid AI agent service on Stellar: a meeting transcript goes in, action items come out (task, owner, due date,
priority, evidence quote), plus decisions and a one-line summary. It follows Provider Standard v1 from
https://github.com/AlgoriaLabs/stellar-agent-services (read its `AGENTS.md`). It is built with the Provider Kit
(`defineService` + `createProvider`), like the sibling project `~/Documents/pov-1` (X Strategy Agent), which is the
template this project copies.

## Decisions the user made (2026-11-17)

- **Keep the implementation simple.** JSON in, JSON out. No PDF, no files, no extra storage.
- **Everything free except Stellar fees.** Model: Gemini free tier (OpenAI-compatible endpoint), with Groq and
  OpenRouter as optional fallbacks. Hosting: co-hosted on an existing Oracle VM (the tenancy is past the Always Free
  allowance, so no new VM).
- **Host:** the `pitch-deck-agent` Oracle VM, `ubuntu@92.5.73.99`, SSH key `~/.ssh/pitch-deck`. It already runs
  pitch-deck and X Strategy Agent (pov-1, port 8791). This service uses port **8792**, system user
  `meeting-actions`, systemd unit `meeting-actions`, host `meeting-actions.92-5-73-99.sslip.io` behind Caddy.
- **Keys:** reuse the Gemini key and the OpenZeppelin facilitator key from
  `~/Documents/pitch-deck-service/deploy/terraform/terraform.tfvars` (`gemini_api_key`,
  `facilitator_api_key_mainnet`), copied into this project's `.env` (gitignored). The Gemini free quota is shared.
- **Network:** mainnet (`stellar:pubnet`), real USDC. Price **0.01 USDC** per extraction, charged on success.
- **Wallet:** the kit's local wallet (`provider-kit launch --local-wallet`). Its key lives in the macOS Keychain.
  Never read, print or export it. The user sends the XLM the kit asks for.
- **GitHub:** the repo is https://github.com/atknalkan/meeting-action-extractor (the user's other account). The user pushes with a different GitHub account. Do not `git push`, create repos or set up CI with the
  local `gh` login.

## Rules (from stellar-agent-services AGENTS.md §4)

- No Stellar secret key in the code, `.env`, the server or the logs. The server knows only `PAY_TO`.
- Never charge twice; `charge: "on-success"` means a failed extraction is never settled.
- Never pay on mainnet unless the user asks. Test paid flows offline (`npm test`) or on testnet.
- Never take a return address from account history (address-poisoning was seen on 2026-11-16). Ask the user.

## Steps and status

1. [x] Read the standard and the sibling project pov-1.
2. [x] Project code: `src/`, offline tests (`npm test`, 7 pass).
3. [x] Local run with Gemini: `npm run extract -- test/fixtures/standup.txt`.
4. [x] Local paid flow on testnet: `STELLAR_NETWORK=stellar:testnet`, empty `PAY_TO`, `npm run dev`, then `npm run check`.
5. [x] Mainnet registration (agent 77): `npm run launch -- --url https://meeting-actions.92-5-73-99.sslip.io --local-wallet --no-deploy --no-wait --no-validation --no-open`.
   The kit prints the wallet address and the XLM to send. Give the user both exactly as printed and wait.
6. [x] Deploy to the VM: `npm run deploy` (the user authorized SSH on 2026-11-17).
7. [x] Check: `npm run status -- --url https://meeting-actions.92-5-73-99.sslip.io` and
   `npx verifier check https://meeting-actions.92-5-73-99.sslip.io/.well-known/stellar-agent-services.json`.
8. [ ] `git init` and a first commit locally (no push). Ask the user before committing.

## Log

- 2026-11-17: project started. SSH to the VM was blocked by the permission classifier; the user must allow it (or run
  `npm run deploy` themselves).
- 2026-11-17: `.env` written (mainnet, keys copied from `~/Documents/pov-1/.env`, which holds the same pitch-deck
  keys already cleaned; the tfvars lines carry trailing comments). Live Gemini extraction of the fixture: 3 correct
  items in 2.2 s.
- 2026-11-17: testnet checks from a scratch copy (so `dev` would not write a testnet PAY_TO into the mainnet `.env`):
  `provider-kit check` all passed, `verifier check` C1/C3/C6/C7 passed, `provider-kit try` paid 0.01 test USDC,
  tx 2eac0b8f8a99cf098f67323196e94e7ee7aac067f0dae12154996744fa8514bb (testnet).
- 2026-11-17: launch started. Local wallet (owner and payTo): `GDZ2Z5TMBSI3EBBMMYXAXXNVHN4THI6VTIEVBHMBAJ7TPJGTRACQZFW6`,
  key in the macOS Keychain (service `stellar-agent-services.provider-kit.local-wallet`). Asked the user for 2.5 XLM.
  `--no-validation`: a mainnet validation request can cost 17+ XLM and there is no default mainnet verifier.
  If launch timed out before the XLM arrived, run the same command again: it reuses the account.
- Deploy scripts written (`deploy/oracle/`), not run yet: SSH needs the user's permission. Caddy: install.sh appends
  `import /etc/caddy/meeting-actions.caddy` to the VM's Caddyfile (backup kept, restored if validation fails).
- 2026-11-17: user sent 2.5 XLM. Launch done: USDC trustline tx 1104ff8969ad75e2db2b358673edcdf42e0a2a2f07ccd9788a34ad61ef36d1a1,
  8004 registration **agent 77** tx 38e44819d7d7fbb7837acd4c75b22a1790d6e74a14b2a8e80fda85f5fbcf9e58 (mainnet).
  `.env` now has PAY_TO and AGENT_ID=77. The service is NOT deployed yet: next is `npm run deploy` (step 6).
  The user should back up the wallet key themselves with `npx provider-kit wallet export` (agents must never run it).
- 2026-11-17: deployed. LIVE at https://meeting-actions.92-5-73-99.sslip.io (systemd `meeting-actions`, port 8792,
  data `/var/lib/meeting-actions/jobs-mainnet.sqlite`, release under `/opt/meeting-actions/current`). First deploy
  failed: `dist/` was packed mode 700 and macOS added `._*` files, and the rollback pointed `current` at itself.
  Fixed in deploy.sh (COPYFILE_DISABLE, --no-xattrs) and install.sh (chmod, `._*` cleanup, a real rollback, stop the
  service when no previous release exists). Caddy got a Let's Encrypt cert at once.
  `provider-kit status`: payTo ✓, registered ✓ (agent 77, its registration lists the live manifest), live ✓, paid ✗ (no
  buyer yet), verified ✗ (no validation requested). `verifier check` on the public URL: C1, C2, C3, C6, C7 pass; C4/C5
  need a paying test payer. The neighbours caddy and x-strategy-agent are still active.

## Open items
- Optional: a mainnet validation request (`npm run launch -- … --validator <G…>`). Can cost 17+ XLM in rent. Ask first.
- Optional: one real paid mainnet call (0.01 USDC) to show a `paid` ✓. Only if the user asks; it needs a payer wallet
  holding USDC (see `~/Documents/pov-1/scripts/payer.mjs`).
- The user should back up the wallet key: `npx provider-kit wallet export` in their own terminal.
- `git init` + first commit: ask the user. Never push (different GitHub account).
- 2026-11-17: user asked for a real paid mainnet call as proof. `scripts/payer.mjs` (ported from pov-1) made a payer
  wallet `GBMC37IPXEPO36DXH6TVNSFVNUAR5CGW5J2JWNFCBJVZHOEJWYPSG3IY` (key in macOS Keychain, service
  `meeting-actions.payer`). Asked the user for 1.7 XLM. Next: `node scripts/payer.mjs prepare 0.01`, then
  `node scripts/payer.mjs pay https://meeting-actions.92-5-73-99.sslip.io/.well-known/stellar-agent-services.json meeting-actions @evidence/input-standup.json --max 0.01`.
  The record lands in `evidence/payment-<jobId>.json`. Afterwards `close <G...>` returns the XLM to an address the
  user names (never one taken from account history).
- 2026-11-17: PROOF DONE. User sent 1.7 XLM to the payer. Buyer prepare tx c08f9621…; paid call job
  cecb7bf4-814b-46b6-8eff-22557d404d81 succeeded, 0.01 USDC settled on mainnet, tx
  a3bddc48cf8ef9b18dae8a77b1f84559488ed12d47454dd2c52290609f3e58f9. `provider-kit status`: paid ✓. Everything is in
  `evidence/README.md`. The payer still holds about 1.63 XLM (1.5 is reserve): `node scripts/payer.mjs close <G…>`
  returns it to an address the user types in (a poisoning look-alike `GBPXEJR2…JNOFF2AQ` sent dust; the real funder
  is `GBPXY5FX…CY7F2AQ`).
