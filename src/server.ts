// Meeting Action Extractor: a paid service on Stellar, built with the Provider Kit (Provider Standard v1).
// Settings come from the environment (.env on a laptop). It never needs a Stellar secret key. Paid jobs are kept in
// SQLite, so they survive a restart and a client that lost its response can collect the result without paying again.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { listen } from "@stellar-agent-services/provider-kit";
import { buildProvider } from "./app.js";
import { ConfigError, describeConfig, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

mkdirSync(dirname(config.jobDbPath), { recursive: true });
const provider = buildProvider(config);
// Fails fast if the facilitator can't settle this network, and resumes jobs a restart left behind.
await provider.ready();
const server = await listen(provider, { port: config.port, host: config.host });

for (const line of describeConfig(config)) console.log(line);
console.log(`manifest     ${provider.manifestUrl}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close().then(() => process.exit(0)));
}
