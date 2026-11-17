# Mainnet evidence

Meeting Action Extractor, Stellar Mainnet (`stellar:pubnet`), Stellar 8004 **agent 77**.
Source: https://github.com/atknalkan/meeting-action-extractor
Live at https://meeting-actions.92-5-73-99.sslip.io/.well-known/stellar-agent-services.json

## Provider setup (2026-11-17)

| Step | Account | Transaction |
| --- | --- | --- |
| USDC trustline on the payout account | `GDZ2Z5TMBSI3EBBMMYXAXXNVHN4THI6VTIEVBHMBAJ7TPJGTRACQZFW6` | [1104ff89…](https://stellar.expert/explorer/public/tx/1104ff8969ad75e2db2b358673edcdf42e0a2a2f07ccd9788a34ad61ef36d1a1) |
| Stellar 8004 registration, agent 77 | same (owner, wallet and `payTo`) | [38e44819…](https://stellar.expert/explorer/public/tx/38e44819d7d7fbb7837acd4c75b22a1790d6e74a14b2a8e80fda85f5fbcf9e58) |

## First paid call, from a separate buyer wallet (2026-11-17)

The buyer is `GBMC37IPXEPO36DXH6TVNSFVNUAR5CGW5J2JWNFCBJVZHOEJWYPSG3IY`, made by `scripts/payer.mjs`, which pays with the
standard's own payment client (`@stellar-agent-services/payment-client`): quote, check the 402 against the manifest
and a 0.01 USDC spending limit, sign once, confirm on chain.

| Step | Transaction |
| --- | --- |
| Buyer: USDC trustline and 0.01 USDC bought on the Stellar DEX | [c08f9621…](https://stellar.expert/explorer/public/tx/c08f9621532f9e10fe59ad5a8b74608280cf99ae3a87dacfa51a4cb5dcf429b4) |
| x402 payment: 0.01 USDC to agent 77's `payTo`, settled by the OpenZeppelin facilitator | [a3bddc48…](https://stellar.expert/explorer/public/tx/a3bddc48cf8ef9b18dae8a77b1f84559488ed12d47454dd2c52290609f3e58f9) |

- Job `cecb7bf4-814b-46b6-8eff-22557d404d81`: `succeeded`, `charged: true`, confirmed on chain.
- Input: [input-standup.json](input-standup.json) (the test fixture, meeting date 2026-11-17).
- Full record, with the terms and the delivered output: [payment-cecb7bf4-814b-46b6-8eff-22557d404d81.json](payment-cecb7bf4-814b-46b6-8eff-22557d404d81.json).
- Delivered: 3 action items (Bob: fix the mobile login bug, this week; Alice: send the checklist, 2026-11-20; Carol:
  run the regression suite, 2026-11-23), 3 decisions and a summary.
- After the call, `provider-kit status` shows `paid ✓: payTo holds 0.0100000 USDC`.

## Note

15 s after the buyer account was funded by `GBPXY5FX…CY7F2AQ`, a look-alike account `GBPXEJR2…JNOFF2AQ` sent it
0.0001 XLM (tx ef9c55af…): address poisoning. Never copy a return address from account history.
