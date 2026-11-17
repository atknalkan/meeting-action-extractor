// End to end, offline: a buyer asks for an extraction, gets a 402, pays with a real (offline-signed) x402 payment and
// gets the action items. The facilitator is faked and the model is the mock; the Provider Kit is the production code.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { memoryStore, type Facilitator, type Provider } from "@stellar-agent-services/provider-kit";
import { signTestPayment } from "@stellar-agent-services/provider-kit/testing";
import { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { buildProvider } from "../src/app.js";
import { loadConfig } from "../src/config.js";

let provider: Provider;
let settles = 0;
let transcript: string;

before(async () => {
  transcript = await readFile(new URL("../../test/fixtures/standup.txt", import.meta.url), "utf8");
  const config = loadConfig({ STELLAR_NETWORK: "stellar:testnet", PUBLIC_ORIGIN: "http://localhost:8787", PAY_TO: Keypair.random().publicKey(), LLM_MOCK: "1" });
  const facilitator: Facilitator = {
    verify: async () => ({ isValid: true }),
    settle: async (_payload, requirements) => ({ success: true, transaction: (++settles).toString(16).padStart(64, "0"), network: requirements.network }),
  };
  provider = buildProvider(config, { facilitator, rpc: false, store: memoryStore() });
  await provider.ready();
});

after(async () => {
  await provider.close();
});

const call = (path: string, init?: RequestInit) => provider.fetch(new Request(`http://localhost:8787${path}`, init));
const createJob = (body: unknown, headers: Record<string, string> = {}) =>
  call("/services/meeting-actions/jobs", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("the manifest lists meeting-actions at 0.01 USDC, charged on success", async () => {
  const response = await call("/.well-known/stellar-agent-services.json");
  assert.equal(response.status, 200);
  const manifest = (await response.json()) as { services: { name: string; price: { amount: string }; charge: string }[] };
  assert.equal(manifest.services[0]!.name, "meeting-actions");
  assert.equal(manifest.services[0]!.price.amount, "100000");
  assert.equal(manifest.services[0]!.charge, "on-success");
});

test("bad input is refused before any payment is asked for", async () => {
  for (const body of [{}, { transcript: "too short" }, { transcript, extra: 1 }, { transcript, meetingDate: "tomorrow" }]) {
    assert.equal((await createJob(body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test("pay → action items: 402, paid request, result", async () => {
  const challenge = await createJob({ transcript, meetingDate: "2026-11-17" });
  assert.equal(challenge.status, 402);
  const requirements = decodePaymentRequiredHeader(challenge.headers.get("PAYMENT-REQUIRED")!).accepts[0] as PaymentRequirements;
  assert.equal(requirements.amount, "100000");
  const payment = encodePaymentSignatureHeader(await signTestPayment(requirements, Keypair.random()));
  const response = await createJob({ transcript, meetingDate: "2026-11-17" }, { "PAYMENT-SIGNATURE": payment });
  const view = (await response.json()) as { status: string; charged: boolean; output: { actionItems: { owner: string | null; evidence: string | null }[]; decisions: string[] } };
  assert.equal(response.status, 200, JSON.stringify(view));
  assert.equal(view.status, "succeeded");
  assert.equal(view.charged, true);
  assert.equal(settles, 1);
  assert.equal(view.output.actionItems.length, 3);
  assert.equal(view.output.actionItems[0]!.owner, "Alice");
  // The mock's third quote is not in the transcript, so it is dropped.
  assert.equal(view.output.actionItems[2]!.evidence, null);
  assert.equal(view.output.decisions.length, 1);
});
