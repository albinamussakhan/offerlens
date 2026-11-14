import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { mockAnalysis, mockGrade } from "./mock.js";

let client;
function getClient() {
  if (!config.apiKey) {
    throw new HttpError(503, "The server has no ANTHROPIC_API_KEY configured.");
  }
  client ??= new Anthropic({ apiKey: config.apiKey });
  return client;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Pull the first JSON object out of a model reply. */
export function extractJSON(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("No JSON object in the reply.");
  return JSON.parse(text.slice(a, b + 1));
}

/**
 * Ask the model for one JSON object. Retries once if the reply is not valid JSON.
 * In mock mode returns canned data and never touches the network.
 */
export async function callJSON({ kind, model, prompt, maxTokens, mockData }) {
  if (config.mock) return mockData();

  const anthropic = getClient();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try {
      reply = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err) {
      console.error(`[ai] ${kind} request failed:`, err?.status ?? "", err?.message ?? err);
      if (err?.status === 429) throw new HttpError(429, "The AI service is busy. Wait a minute and try again.");
      throw new HttpError(502, "The AI service is unavailable. Try again.");
    }
    if (reply.stop_reason === "max_tokens") {
      lastError = new Error("Reply was cut off.");
      continue;
    }
    const text = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    try {
      return extractJSON(text);
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`[ai] ${kind} gave unusable output:`, lastError?.message);
  throw new HttpError(502, "The analysis came back incomplete. Try again.");
}

export const mocks = { analysis: mockAnalysis, grade: mockGrade };
