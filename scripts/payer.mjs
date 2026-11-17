// A payer wallet for paying this service (or any Provider Standard v1 service) once, on Stellar Mainnet, the way any
// client does: quote, check the 402 against the manifest and a spending limit, sign once, confirm on chain.
// It uses the standard's own payment client (@stellar-agent-services/payment-client), not hand-written payment code.
//
//   node scripts/payer.mjs create                          makes the payer account's key and says how much XLM it needs
//   node scripts/payer.mjs status                          its address and what it holds
//   node scripts/payer.mjs prepare <usdc>                  adds the USDC trustline and buys <usdc> on the Stellar DEX
//   node scripts/payer.mjs pay <manifest> <service> <json or @file.json> pays for one job, saves a record under evidence/
//   node scripts/payer.mjs close <G...>                    removes the trustline and sends all XLM to an account of yours
//
// The key is made here and kept in the macOS Keychain. It is never printed, logged or written to a file: it is read
// into this process only to sign. This is a buyer's wallet. It has nothing to do with the provider, which holds no key.
// Real money: every command says what it will send before it sends it, and `pay` refuses anything above --max (0.10).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Journal, localKeySigner, PaymentClient, defaultPolicy, x402ExactStellar } from "@stellar-agent-services/payment-client";
import { fileJournalStorage, fileSecretStore } from "@stellar-agent-services/payment-client/node";
import { USDC_ISSUER } from "@stellar-agent-services/protocol";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const NETWORK = "stellar:pubnet";
const HORIZON = "https://horizon.stellar.org";
const RPC = process.env.SOROBAN_RPC_URL || "https://mainnet.sorobanrpc.com";
const KEYCHAIN = { service: "meeting-actions.payer", account: "mainnet" };
const HOME = "data/payer";
const USDC = new Asset("USDC", USDC_ISSUER[NETWORK]);
const explorer = (hash) => `https://stellar.expert/explorer/public/tx/${hash}`;
const horizon = new Horizon.Server(HORIZON);

function readSecret() {
  const found = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN.service, "-a", KEYCHAIN.account, "-w"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

/** Through `security -i`, so the key is on stdin and never among a process's arguments. */
function storeSecret(secret) {
  execFileSync("security", ["-i"], { input: `add-generic-password -s "${KEYCHAIN.service}" -a "${KEYCHAIN.account}" -l "Meeting Action Extractor payer (Stellar Mainnet)" -w "${secret}"\n`, stdio: ["pipe", "ignore", "inherit"] });
}

function keypair() {
  const secret = readSecret();
  if (secret === undefined) throw new Error("no payer wallet yet: run `node scripts/payer.mjs create`");
  return Keypair.fromSecret(secret);
}

async function balances(address) {
  try {
    const account = await horizon.loadAccount(address);
    const xlm = account.balances.find((balance) => balance.asset_type === "native")?.balance ?? "0";
    const usdc = account.balances.find((balance) => balance.asset_code === "USDC" && balance.asset_issuer === USDC.issuer);
    return { exists: true, xlm, usdc: usdc?.balance, trustline: usdc !== undefined, account };
  } catch (error) {
    if (error?.response?.status === 404) return { exists: false, xlm: "0", usdc: undefined, trustline: false, account: undefined };
    throw error;
  }
}

/** What `amount` USDC costs in XLM on the DEX right now. */
async function xlmFor(amount) {
  const paths = await horizon.strictReceivePaths([Asset.native()], USDC, amount).call();
  const best = paths.records.map((record) => Number(record.source_amount)).sort((a, b) => a - b)[0];
  if (best === undefined) throw new Error("the DEX has no path from XLM to USDC right now");
  return best;
}

async function submit(pair, account, operations) {
  const builder = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: Networks.PUBLIC });
  for (const operation of operations) builder.addOperation(operation);
  const transaction = builder.setTimeout(120).build();
  transaction.sign(pair);
  const result = await horizon.submitTransaction(transaction);
  return result.hash;
}

const [command, ...args] = process.argv.slice(2);

if (command === "create") {
  let pair;
  if (readSecret() === undefined) {
    pair = Keypair.random();
    storeSecret(pair.secret());
    if (readSecret() !== pair.secret()) throw new Error("the key did not reach the Keychain: nothing to fund");
    console.log(`Made a payer wallet: ${pair.publicKey()}`);
    console.log(`  Its key is kept in the macOS Keychain (service "${KEYCHAIN.service}"). It is never printed or written to a file.`);
  } else {
    pair = keypair();
    console.log(`The payer wallet is ${pair.publicKey()}`);
  }
  const usdc = args[0] ?? "0.10";
  const cost = await xlmFor(usdc);
  // 1 XLM for the account, 0.5 for the USDC trustline, the USDC itself with room for the price to move, and fees.
  const ask = Math.ceil((1.5 + cost * 1.2 + 0.05) * 10) / 10;
  console.log(`\nSend ${ask} XLM to it on Stellar Mainnet. No memo is needed.`);
  console.log(`  1.5 XLM is the reserve Stellar locks (the account, and its USDC trustline); ${usdc} USDC costs about ${cost.toFixed(4)} XLM today.`);
  console.log("  What isn't spent stays in the account, and `close` sends it back to an account of yours.");
} else if (command === "status") {
  const pair = keypair();
  const held = await balances(pair.publicKey());
  console.log(JSON.stringify({ address: pair.publicKey(), network: NETWORK, funded: held.exists, xlm: held.xlm, usdc: held.usdc ?? null, trustline: held.trustline }, null, 2));
} else if (command === "prepare") {
  const usdc = args[0] ?? "0.10";
  const pair = keypair();
  const held = await balances(pair.publicKey());
  if (!held.exists) throw new Error(`${pair.publicKey()} is not funded yet`);
  const missing = Math.max(0, Number(usdc) - Number(held.usdc ?? "0"));
  if (held.trustline && missing === 0) {
    console.log(`Already holds ${held.usdc} USDC: nothing to do.`);
  } else {
    const operations = [];
    if (!held.trustline) operations.push(Operation.changeTrust({ asset: USDC }));
    let sendMax;
    if (missing > 0) {
      const amount = missing.toFixed(7);
      sendMax = ((await xlmFor(amount)) * 1.15).toFixed(7);
      // Buys exactly the USDC needed, for at most sendMax XLM; the rest of the XLM stays.
      operations.push(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax, destination: pair.publicKey(), destAsset: USDC, destAmount: amount }));
      console.log(`Buying ${amount} USDC for at most ${sendMax} XLM${held.trustline ? "" : ", and adding the USDC trustline"}`);
    }
    const hash = await submit(pair, held.account, operations);
    const after = await balances(pair.publicKey());
    console.log(`✓ ${explorer(hash)}`);
    console.log(JSON.stringify({ step: "prepare", transaction: hash, xlm: after.xlm, usdc: after.usdc }, null, 2));
  }
} else if (command === "pay") {
  const maxIndex = args.indexOf("--max");
  const max = maxIndex === -1 ? "0.10" : args.splice(maxIndex, 2)[1];
  const [manifestUrl, service, inputArg] = args;
  const inputJson = inputArg?.startsWith("@") ? await readFile(inputArg.slice(1), "utf8") : inputArg;
  if (!manifestUrl || !service || !inputJson) throw new Error("usage: pay <manifest url> <service> '<input json>' [--max 0.10]");
  const pair = keypair();
  await mkdir(HOME, { recursive: true });
  const policy = defaultPolicy(pair.publicKey(), NETWORK);
  const maxUnits = String(Math.round(Number(max) * 1e7));
  // One payment, at most `max`, and never without the explicit approval given on the command line below.
  Object.assign(policy, { maxValuePerTx: maxUnits, maxValuePerDay: maxUnits });
  const client = new PaymentClient({
    signer: localKeySigner(pair.secret(), NETWORK),
    methods: [x402ExactStellar({ rpcUrl: RPC })],
    policy,
    journal: await Journal.open(fileJournalStorage(`${HOME}/journal.jsonl`)),
    secrets: fileSecretStore(`${HOME}/tokens.json`),
    rpcUrl: RPC,
    followSeconds: 280,
  });
  const quote = await client.quote(manifestUrl, service, JSON.parse(inputJson));
  const terms = { provider: quote.manifest.provider.name, agentId: quote.manifest.provider.agentId, service: quote.service.name, charge: quote.service.charge, amountBaseUnits: quote.requirements.amount, asset: quote.requirements.asset, payTo: quote.requirements.payTo, network: quote.requirements.network, jobId: quote.jobId };
  console.log("Quote:", JSON.stringify(terms, null, 2));
  if (!client.payable(quote)) {
    console.error("✗ not payable:", JSON.stringify({ challenge: quote.challengeViolations, policy: quote.policyViolations }, null, 2));
    process.exit(1);
  }
  const startedAt = new Date().toISOString();
  const result = await client.pay(quote, { approved: true });
  const record = { paidAt: startedAt, finishedAt: new Date().toISOString(), payer: pair.publicKey(), manifestUrl, input: JSON.parse(inputJson), terms, confirmedOnChain: result.confirmed, unconfirmedReason: result.unconfirmedReason ?? null, job: result.job };
  await mkdir("evidence", { recursive: true });
  const file = `evidence/payment-${quote.jobId}.json`;
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n${result.job.status === "succeeded" ? "✓" : "✗"} job ${result.job.status}, charged: ${result.job.charged}, confirmed on chain: ${result.confirmed}`);
  if (result.job.payment?.transaction) console.log(`  ${explorer(result.job.payment.transaction)}`);
  console.log(`  record: ${file}`);
  if (result.job.output) console.log(JSON.stringify(result.job.output, null, 2));
} else if (command === "close") {
  const to = args[0];
  if (!/^G[A-Z2-7]{55}$/.test(to ?? "")) throw new Error("usage: close <G... account that receives the XLM>");
  const pair = keypair();
  const held = await balances(pair.publicKey());
  if (!held.exists) throw new Error("the payer account does not exist on chain");
  if (Number(held.usdc ?? "0") > 0) throw new Error(`it still holds ${held.usdc} USDC: spend or send that first`);
  const operations = [];
  if (held.trustline) operations.push(Operation.changeTrust({ asset: USDC, limit: "0" }));
  operations.push(Operation.accountMerge({ destination: to }));
  console.log(`Closing ${pair.publicKey()}: its ${held.xlm} XLM, less the fee, goes to ${to}`);
  const hash = await submit(pair, held.account, operations);
  console.log(`✓ ${explorer(hash)}`);
} else {
  console.error("usage: node scripts/payer.mjs create | status | prepare <usdc> | pay <manifest url> <service> '<input json>' | close <G...>");
  process.exit(2);
}
