// The paid service, defined with the Provider Kit (Provider Standard v1).
//
// charge "on-success": the buyer's payment settles only after a valid result exists [S1]. If every model fails, the
// job fails and nobody is charged. expectedDurationSeconds must be at most maxTimeoutSeconds / 2 [S2] (app.ts: 180).

import { defineService, type Service } from "@stellar-agent-services/provider-kit";
import type { LlmProvider } from "./config.js";
import { extractActions, type ExtractRequest } from "./extract.js";

export const SERVICE_NAME = "meeting-actions";
export const MAX_TRANSCRIPT_CHARS = 100_000;

export function meetingActionsService(providers: LlmProvider[], priceUsdc: string): Service {
  return defineService({
    name: SERVICE_NAME,
    title: "Action items from a meeting transcript",
    // Agents choose by this text and search matches it: what it does, when to use it, its limits (spec §3.4).
    description:
      "Reads a meeting transcript and returns its action items as JSON: each task with its owner, due date, priority and the exact quote where it was agreed, " +
      "plus the decisions made and a short summary. Use it after a meeting, call, standup or interview to get the to-do list and follow-ups without reading the whole transcript. " +
      "Works with plain text from Zoom, Google Meet, Teams, Otter or any notes, in any language. Give the meeting date to turn \"next Friday\" into a date. Up to 100,000 characters.",
    price: priceUsdc,
    charge: "on-success",
    expectedDurationSeconds: 20,
    timeoutSeconds: 90,
    tags: ["meeting", "transcript", "action-items", "tasks", "todo", "follow-up", "summary", "notes", "productivity", "extraction"],
    // One model call on a free tier per job: a few at a time is what its rate limit takes.
    capacity: { concurrency: 3, maxQueued: 20, maxQueueWaitSeconds: 60 },
    maxInputBytes: 256 * 1024,
    examples: [
      {
        input: {
          transcript:
            "Alice: Let's confirm the launch stays on December 1st.\nBob: Agreed.\nAlice: I'll send the updated checklist by Friday.\nCarol: Bob, can you take the login timeout bug before launch?\nBob: Yes, I'll fix it.",
          meetingDate: "2026-11-17",
        },
        output: {
          summary: "The team confirmed the 1 December launch and split the remaining work.",
          actionItems: [
            { task: "Send the updated launch checklist", owner: "Alice", dueDate: "2026-11-20", dueText: "by Friday", priority: "high", evidence: "I'll send the updated checklist by Friday" },
            { task: "Fix the login timeout bug", owner: "Bob", dueDate: null, dueText: "before launch", priority: "high", evidence: "Bob, can you take the login timeout bug before launch?" },
          ],
          decisions: ["The launch stays on 1 December."],
        },
      },
    ],
    inputSchema: {
      type: "object",
      required: ["transcript"],
      additionalProperties: false,
      properties: {
        transcript: { type: "string", minLength: 20, maxLength: MAX_TRANSCRIPT_CHARS, description: "The meeting transcript or notes, as plain text. Speaker names help assign owners." },
        meetingDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The meeting's date (YYYY-MM-DD), used to resolve relative deadlines such as \"next Friday\"" },
        participants: { type: "array", maxItems: 50, items: { type: "string", maxLength: 100 }, description: "Names of the people in the meeting, to match owners" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["summary", "actionItems", "decisions"],
      properties: {
        summary: { type: "string", description: "What the meeting was about and its outcome" },
        actionItems: {
          type: "array",
          items: {
            type: "object",
            required: ["task", "owner", "dueDate", "dueText", "priority", "evidence"],
            properties: {
              task: { type: "string", description: "What must be done" },
              owner: { type: ["string", "null"], description: "Who is responsible, or null if nobody took it" },
              dueDate: { type: ["string", "null"], description: "Deadline as YYYY-MM-DD, or null" },
              dueText: { type: ["string", "null"], description: "The deadline as it was said, or null" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: ["string", "null"], description: "An exact quote from the transcript, or null" },
            },
          },
        },
        decisions: { type: "array", items: { type: "string" }, description: "Decisions the meeting made" },
      },
    },
    handler: async (input, { signal }) => (await extractActions(input as unknown as ExtractRequest, providers, signal)) as never,
  });
}
