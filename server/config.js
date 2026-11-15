import "dotenv/config";

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  // Set MOCK_AI=1 (or pass --mock) to run without an API key (canned responses, for demos and tests).
  mock: process.env.MOCK_AI === "1" || process.argv.includes("--mock"),
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  // Question generation is small and latency-sensitive, so it defaults to the fast model.
  analyzeModel: process.env.ANALYZE_MODEL || "claude-haiku-5-5",
  // Grading is a judgment call, so it defaults to the stronger model.
  gradeModel: process.env.GRADE_MODEL || "claude-sonnet-5-5",
  // Per-request limit for one Anthropic call; the SDK retries at most once.
  aiTimeoutMs: int(process.env.AI_TIMEOUT_MS, 120_000),
  // Longest accepted CV or vacancy, in characters (after trimming). Longer documents are rejected
  // with a clear message; accepted documents are always analyzed in full, never cut.
  maxDocChars: int(process.env.MAX_DOC_CHARS, 30_000),
  // Longest accepted interview answer, in characters (after trimming). Longer answers are rejected
  // with a clear message; accepted answers are always graded in full, never cut.
  maxAnswerChars: int(process.env.MAX_ANSWER_CHARS, 20_000),
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 20),
  trustProxy: process.env.TRUST_PROXY === "1",
};
