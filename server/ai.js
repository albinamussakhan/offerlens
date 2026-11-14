import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { mockAnalysis, mockGrade } from "./mock.js";

let client;
function getClient() {
  if (!config.apiKey) {
    console.error("[ai] ANTHROPIC_API_KEY is not set; refusing AI request.");
    throw new HttpError(503, "The analysis service is not configured. Try again later.");
  }
  // Bounded waits: one request may take up to aiTimeoutMs, and the SDK retries
  // 408/409/429/5xx and connection errors at most once (its default is 10 minutes x 3 tries).
  client ??= new Anthropic({ apiKey: config.apiKey, timeout: config.aiTimeoutMs, maxRetries: 1 });
  return client;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The balanced {...} span starting at `start`, string- and escape-aware, or null. */
function spanFrom(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Balanced {...} spans starting at each "{" (so a stray brace in prose cannot hide the real object). */
function objectSpans(text) {
  const spans = [];
  for (let i = text.indexOf("{"), n = 0; i >= 0 && n < 200; i = text.indexOf("{", i + 1), n++) {
    const s = spanFrom(text, i);
    if (s) spans.push(s);
  }
  return spans;
}

function tryParse(s) {
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Candidate JSON objects in a model reply, most likely answer first:
 * fenced ```json blocks, then other fenced blocks, then the whole reply,
 * then bare top-level objects (largest first, so a small inline example loses to the real answer).
 */
export function jsonCandidates(text) {
  const fenced = [...String(text).matchAll(/```[ \t]*([a-zA-Z]*)[ \t]*\r?\n([\s\S]*?)```/g)];
  const ordered = [
    ...fenced.filter((m) => m[1].toLowerCase() === "json").map((m) => m[2]),
    ...fenced.filter((m) => m[1].toLowerCase() !== "json").map((m) => m[2]),
    String(text),
    ...objectSpans(String(text)).sort((a, b) => b.length - a.length),
  ];
  const out = [];
  const seen = new Set();
  for (const s of ordered) {
    const v = tryParse(s);
    if (v === undefined) continue;
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** The most likely JSON object in a model reply. Throws if there is none. */
export function extractJSON(text) {
  const [first] = jsonCandidates(text);
  if (first === undefined) throw new Error("No JSON object in the reply.");
  return first;
}

/**
 * Ask the model for one JSON object and return `normalize(object)`.
 * Tries each JSON candidate in the reply until one passes `normalize`; if none does,
 * asks once more. A reply cut off at max_tokens fails immediately, because the same
 * request would be cut off again. In mock mode returns canned data and never touches the network.
 */
export async function callJSON({
  kind,
  model,
  prompt,
  maxTokens,
  mockData,
  normalize = (x) => x,
  failMessage = "The analysis came back incomplete. Try again.",
}) {
  if (config.mock) return normalize(mockData());

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
      console.error(`[ai] ${kind} reply hit max_tokens (${maxTokens}); not retrying the same request.`);
      throw new HttpError(502, "The AI reply was too long and got cut off. Try again.");
    }
    const text = (reply.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const candidates = jsonCandidates(text);
    if (!candidates.length) lastError = new Error(`no JSON object (stop_reason: ${reply.stop_reason})`);
    let attemptError;
    for (const candidate of candidates) {
      try {
        return normalize(candidate);
      } catch (err) {
        attemptError ??= err; // log why the most likely candidate failed, not a nested fragment
      }
    }
    lastError = attemptError ?? lastError;
  }
  console.error(`[ai] ${kind} gave unusable output:`, lastError?.message);
  throw new HttpError(502, failMessage);
}

export const mocks = { analysis: mockAnalysis, grade: mockGrade };
