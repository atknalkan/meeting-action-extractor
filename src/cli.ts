// npm run extract -- <transcript.txt> [--date YYYY-MM-DD]
// Runs the extraction on this computer and prints the JSON. No payment, no server. Reads model keys from .env.

import { readFile } from "node:fs/promises";
import { llmProvidersFrom } from "./config.js";
import { extractActions } from "./extract.js";

const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const meetingDate = dateIndex === -1 ? undefined : args.splice(dateIndex, 2)[1];
const file = args[0];
if (file === undefined) {
  console.error("usage: npm run extract -- <transcript.txt> [--date YYYY-MM-DD]");
  process.exit(2);
}

const providers = llmProvidersFrom();
if (providers.length === 0) {
  console.error("set GEMINI_API_KEY in .env (or LLM_MOCK=1)");
  process.exit(2);
}
const transcript = await readFile(file, "utf8");
const started = Date.now();
const result = await extractActions({ transcript, ...(meetingDate === undefined ? {} : { meetingDate }) }, providers, AbortSignal.timeout(120_000));
console.log(JSON.stringify(result, null, 2));
console.error(`${result.actionItems.length} action item(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
