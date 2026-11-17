// Asks a chain of OpenAI-compatible models (Gemini, Groq, OpenRouter free tiers) for one JSON answer.
// A model whose answer doesn't parse gets one repair turn with the problem named; a model that errors or is
// rate-limited hands over to the next one. The "mock" provider returns canned output for tests and offline runs.

import type { LlmProvider } from "./config.js";

export class LlmError extends Error {
  override name = "LlmError";
}

/** Thrown by a parser to say what is wrong with the model's answer, so the model can fix it. */
export class AnswerError extends Error {
  override name = "AnswerError";
}

export interface Ask<T> {
  system: string;
  user: string;
  parse(raw: string): T;
  mock(): string;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

const CALL_TIMEOUT_MS = 60_000;

export async function askJson<T>(providers: LlmProvider[], ask: Ask<T>, signal: AbortSignal, log: Pick<Console, "warn"> = console): Promise<{ value: T; model: string }> {
  const failures: string[] = [];
  for (const provider of providers) {
    if (signal.aborted) break;
    if (provider.name === "mock") return { value: ask.parse(ask.mock()), model: "mock" };
    const who = `${provider.name}:${provider.model}`;
    const messages: Message[] = [
      { role: "system", content: ask.system },
      { role: "user", content: ask.user },
    ];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let raw: string;
      try {
        raw = await chat(provider, messages, signal);
      } catch (error) {
        failures.push(`${who}: ${(error as Error).message}`);
        log.warn(`[llm] ${who} failed: ${(error as Error).message}`);
        break;
      }
      try {
        return { value: ask.parse(raw), model: who };
      } catch (error) {
        if (!(error instanceof AnswerError)) throw error;
        failures.push(`${who}#${attempt}: ${error.message}`);
        log.warn(`[llm] ${who} attempt ${attempt}: ${error.message}`);
        messages.push({ role: "assistant", content: raw.slice(0, 30_000) });
        messages.push({ role: "user", content: `That answer has a problem: ${error.message}. Return the whole corrected JSON object and nothing else.` });
      }
    }
  }
  throw new LlmError(`no model gave a usable answer (${failures.join(" | ").slice(0, 1000) || "no providers"})`);
}

async function chat(provider: LlmProvider, messages: Message[], signal: AbortSignal): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: provider.model, messages, temperature: 0.2, max_tokens: 8192, response_format: { type: "json_object" } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  });
  const text = await response.text();
  if (!response.ok) throw new LlmError(`HTTP ${response.status} ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  let content: unknown;
  try {
    content = (JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  } catch {
    throw new LlmError("the response is not JSON");
  }
  if (typeof content !== "string" || content.trim() === "") throw new LlmError("empty completion");
  return content;
}
