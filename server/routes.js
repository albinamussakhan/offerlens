import { Router } from "express";
import { config } from "./config.js";
import { callJSON, HttpError, mocks } from "./ai.js";
import { analyzePrompt, gradePrompt } from "./prompts.js";
import { analyzeBody, gradeBody, normalizeAnalysis, normalizeGrade } from "./schema.js";
import { averageScore, computeChance, verdictOf } from "./scoring.js";

export const api = Router();

// Output-token ceilings. The default models think before answering (adaptive thinking is on
// when `thinking` is omitted), and thinking tokens count toward max_tokens. The visible JSON is
// about 1k tokens for analyze and about 1.5-2k for grade, so these leave room for thinking.
// They are ceilings, not targets: billing is for tokens actually generated. They stay well
// under the SDK's non-streaming limit (~21k) and fit inside config.aiTimeoutMs.
export const ANALYZE_MAX_TOKENS = 8000;
export const GRADE_MAX_TOKENS = 12000;

function parse(schema, body) {
  const out = schema.safeParse(body);
  if (out.success) return out.data;
  // Only the messages written in schema.js are meant for people; anything else gets a generic line.
  const friendly = out.error.issues.find((i) => /(Add more text|Shorten it and try again)\.$/.test(i.message));
  throw new HttpError(400, friendly ? friendly.message : "The request is missing required fields.");
}

api.get("/health", (_req, res) => {
  // "ai" says whether analysis can work, without exposing any secret. 503 when it cannot,
  // so the page shows its existing "service is not reachable" notice.
  const ai = config.mock ? "mock" : config.apiKey ? "configured" : "missing";
  res.status(ai === "missing" ? 503 : 200).json({ ok: ai !== "missing", mock: config.mock, ai });
});

api.post("/analyze", async (req, res, next) => {
  try {
    // The CV and vacancy are validated against MAX_DOC_CHARS above and are analyzed in full: never cut here.
    const { cv, jd } = parse(analyzeBody, req.body);
    const analysis = await callJSON({
      kind: "analyze",
      model: config.analyzeModel,
      prompt: analyzePrompt({ cv, jd }),
      maxTokens: ANALYZE_MAX_TOKENS,
      mockData: mocks.analysis,
      normalize: normalizeAnalysis,
      failMessage: "Could not prepare 3 questions. Try again.",
    });
    res.json({ analysis });
  } catch (err) {
    next(err);
  }
});

api.post("/grade", async (req, res, next) => {
  try {
    // Answers are validated against MAX_ANSWER_CHARS above and are graded in full: never cut here.
    const { analysis, answers } = parse(gradeBody, req.body);
    const result = await callJSON({
      kind: "grade",
      model: config.gradeModel,
      prompt: gradePrompt({ analysis, answers }),
      maxTokens: GRADE_MAX_TOKENS,
      mockData: () => mocks.grade(answers),
      normalize: (raw) => normalizeGrade(raw, analysis),
      failMessage: "Could not grade all 3 answers. Try again.",
    });
    const scores = result.answers.map((a) => a.score);
    const chance = computeChance(analysis.fitScore, scores);
    res.json({
      result: { ...result, avg: averageScore(scores), chance, verdict: verdictOf(chance) },
    });
  } catch (err) {
    next(err);
  }
});
