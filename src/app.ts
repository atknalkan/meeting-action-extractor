// Builds the provider from a Config. server.ts runs it; tests build it with a fake facilitator and no chain reads.
// The Provider Kit serves every route of the standard: the manifest, create-job, check-status, get-result, plus
// /openapi.json and /llms.txt made from the manifest.

import { createProvider, httpFacilitator, sqliteStore, type Facilitator, type JobStore, type Provider } from "@stellar-agent-services/provider-kit";
import type { Config } from "./config.js";
import { meetingActionsService } from "./service.js";

export interface Overrides {
  facilitator?: Facilitator;
  store?: JobStore;
  rpc?: false;
}

export function buildProvider(config: Config, overrides: Overrides = {}): Provider {
  const rpc = overrides.rpc ?? config.rpcUrl;
  return createProvider({
    baseUrl: config.publicOrigin,
    dev: config.dev,
    network: config.network,
    payTo: config.payTo,
    facilitator: overrides.facilitator ?? httpFacilitator(config.facilitatorUrl, { dev: config.dev, headers: config.facilitatorHeaders }),
    provider: {
      name: "Meeting Action Extractor",
      // On mainnet, search reads only this name and description: the words buyers type go here.
      description:
        "AI agent that turns a meeting transcript into action items: tasks, owners, due dates, priorities, decisions and a summary, as JSON. " +
        "For meeting notes, calls, standups and interviews from Zoom, Google Meet, Teams or Otter: to-do list and follow-up extraction for productivity. " +
        "Paid per transcript in USDC over x402.",
      // Transcripts are kept only inside the job record until it expires, to let a buyer recover a lost response.
      dataUse: { storesInputs: false },
      ...(config.agentId === undefined ? {} : { agentId: config.agentId }),
    },
    services: [meetingActionsService(config.llmProviders, config.priceUsdc)],
    store: overrides.store ?? sqliteStore(config.jobDbPath),
    maxTimeoutSeconds: 180,
    ...(rpc === undefined ? {} : { rpc }),
    // Behind Caddy, the client's address arrives in X-Forwarded-For.
    rateLimit: { requests: 30, windowSeconds: 60, key: (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() },
  });
}
