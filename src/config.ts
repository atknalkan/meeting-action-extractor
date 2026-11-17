// Settings from environment variables. The names are the ones `npm create stellar-service` writes, so the kit's
// `dev`, `launch` and `status` commands find what they save: PAY_TO, AGENT_ID, PUBLIC_ORIGIN, STELLAR_NETWORK.
//
// Only public values and API keys live here, never a Stellar secret key (stellar-agent-services AGENTS.md rule 1).
// Testnet and mainnet never share a job database (rule 6): the file name carries the network.

import type { StellarNetwork } from "@stellar-agent-services/protocol";

export type NetworkName = "testnet" | "mainnet";

export interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Config {
  networkName: NetworkName;
  network: StellarNetwork;
  publicOrigin: string;
  dev: boolean;
  host: string;
  port: number;
  payTo: string;
  agentId: number | undefined;
  facilitatorUrl: string;
  facilitatorHeaders: Record<string, string>;
  rpcUrl: string | undefined;
  priceUsdc: string;
  jobDbPath: string;
  llmProviders: LlmProvider[];
}

const NETWORKS: Record<NetworkName, { network: StellarNetwork; facilitator: string; rpc: string | undefined }> = {
  // x402.org settles testnet with sponsored fees and needs no key. The kit's default testnet RPC is used.
  testnet: { network: "stellar:testnet", facilitator: "https://x402.org/facilitator", rpc: undefined },
  // OpenZeppelin's facilitator settles mainnet and wants a free API key. Mainnet has no default RPC.
  mainnet: { network: "stellar:pubnet", facilitator: "https://channels.openzeppelin.com/x402", rpc: "https://mainnet.sorobanrpc.com" },
};

/** Free model tiers, tried in this order. Each is used only when its key is set. A comma-separated model list is
 * tried model by model on the same key. */
const LLMS = [
  { name: "gemini", keyVar: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite" },
  { name: "groq", keyVar: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  { name: "openrouter", keyVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-120b:free" },
] as const;

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;
  const problems: string[] = [];

  const networkText = (get("STELLAR_NETWORK") ?? "stellar:testnet").toLowerCase();
  const networkName: NetworkName = networkText.includes("pubnet") || networkText === "mainnet" ? "mainnet" : "testnet";
  if (!["stellar:testnet", "testnet", "stellar:pubnet", "pubnet", "mainnet"].includes(networkText)) problems.push(`STELLAR_NETWORK must be stellar:testnet or stellar:pubnet, not "${networkText}"`);
  const defaults = NETWORKS[networkName];

  const port = Number(get("PORT") ?? "8787");
  const publicOrigin = (get("PUBLIC_ORIGIN") ?? `http://localhost:${port}`).replace(/\/+$/, "");
  const dev = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(publicOrigin);
  if (!dev && !publicOrigin.startsWith("https://")) problems.push("PUBLIC_ORIGIN must be https:// (http://localhost only for local development)");

  const payTo = get("PAY_TO");
  if (payTo === undefined) problems.push("PAY_TO is empty: npm run launch sets it (npm run dev makes a throwaway testnet one)");
  else if (!/^G[A-Z2-7]{55}$/.test(payTo)) problems.push("PAY_TO must be a public G... address, never a secret S... key");

  const agentIdText = get("AGENT_ID");
  const agentId = agentIdText === undefined ? undefined : Number(agentIdText);
  if (agentId !== undefined && (!Number.isInteger(agentId) || agentId < 0)) problems.push("AGENT_ID must be a whole number");

  const facilitatorUrl = get("FACILITATOR_URL") ?? defaults.facilitator;
  const facilitatorAuth = get("FACILITATOR_AUTH");
  if (networkName === "mainnet" && facilitatorUrl.includes("openzeppelin.com") && facilitatorAuth === undefined) {
    problems.push('FACILITATOR_AUTH is empty: get a free key at https://channels.openzeppelin.com/gen and set FACILITATOR_AUTH="Bearer <key>"');
  }

  const priceUsdc = get("PRICE_USDC") ?? "0.01";
  if (!/^\d+(\.\d{1,7})?$/.test(priceUsdc) || Number(priceUsdc) <= 0) problems.push("PRICE_USDC must be a positive decimal such as 0.01");

  const llmProviders = llmProvidersFrom(env);
  if (llmProviders.length === 0) problems.push("set GEMINI_API_KEY (or GROQ_API_KEY / OPENROUTER_API_KEY, or LLM_MOCK=1 for canned output)");

  if (problems.length > 0) throw new ConfigError(`configuration for ${networkName}:\n  - ${problems.join("\n  - ")}`);

  return {
    networkName,
    network: defaults.network,
    publicOrigin,
    dev,
    host: get("HOST") ?? "0.0.0.0",
    port,
    payTo: payTo!,
    agentId,
    facilitatorUrl,
    facilitatorHeaders: facilitatorAuth === undefined ? {} : { Authorization: facilitatorAuth },
    rpcUrl: get("SOROBAN_RPC_URL") ?? defaults.rpc,
    priceUsdc,
    jobDbPath: get("JOB_DB_PATH") ?? `${(get("DATA_DIR") ?? "./data").replace(/\/+$/, "")}/jobs-${networkName}.sqlite`,
    llmProviders,
  };
}

/** The model chain the environment asks for, in the order it is tried. */
export function llmProvidersFrom(env: Env = process.env): LlmProvider[] {
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;
  const providers: LlmProvider[] = [];
  for (const llm of LLMS) {
    const apiKey = get(llm.keyVar);
    if (apiKey === undefined) continue;
    const upper = llm.name.toUpperCase();
    const models = (get(`${upper}_MODEL`) ?? llm.model).split(",").map((m) => m.trim()).filter(Boolean);
    for (const model of models) providers.push({ name: llm.name, apiKey, baseUrl: llm.baseUrl, model });
  }
  if (get("LLM_MOCK") === "1") providers.push({ name: "mock", apiKey: "", baseUrl: "", model: "mock" });
  return providers;
}

/** One line per setting for the startup log. Never prints keys. */
export function describeConfig(config: Config): string[] {
  return [
    `network      ${config.networkName} (${config.network})`,
    `origin       ${config.publicOrigin}${config.dev ? "  [dev mode]" : ""}`,
    `payTo        ${config.payTo}`,
    `agentId      ${config.agentId ?? "(not registered yet)"}`,
    `price        ${config.priceUsdc} USDC per transcript, charged on success`,
    `facilitator  ${config.facilitatorUrl}${Object.keys(config.facilitatorHeaders).length > 0 ? " (with API key)" : ""}`,
    `llm chain    ${config.llmProviders.map((p) => `${p.name}:${p.model}`).join(" → ")}`,
    `job db       ${config.jobDbPath}`,
  ];
}
