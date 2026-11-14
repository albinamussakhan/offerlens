import { Router } from "express";
import { config } from "./config.js";
import { callJSON, HttpError, mocks } from "./ai.js";
import { analyzePrompt, gradePrompt } from "./prompts.js";
import { analyzeBody, gradeBody, normalizeAnalysis, normalizeGrade } from "./schema.js";
import { averageScore, computeChance, verdictOf } from "./scoring.js";

export const api = Router();

function parse(schema, body) {
  const out = schema.safeParse(body);
  if (out.success) return out.data;
  // Only the messages written in schema.js are meant for people; anything else gets a generic line.
  const friendly = out.error.issues.find((i) => i.message.endsWith("Add more text."));
  throw new HttpError(400, friendly ? friendly.message : "The request is missing required fields.");
}

api.get("/health", (_req, res) => {
  res.json({ ok: true, mock: config.mock });
});

api.post("/analyze", async (req, res, next) => {
  try {
    const body = parse(analyzeBody, req.body);
    const cv = body.cv.slice(0, config.maxDocChars);
    const jd = body.jd.slice(0, config.maxDocChars);
    const raw = await callJSON({
      kind: "analyze",
      model: config.analyzeModel,
      prompt: analyzePrompt({ cv, jd }),
      maxTokens: 2000,
      mockData: mocks.analysis,
    });
    let analysis;
    try {
      analysis = normalizeAnalysis(raw);
    } catch (err) {
      console.error("[analyze] invalid model output:", err.message);
      throw new HttpError(502, "Could not prepare 3 questions. Try again.");
    }
    res.json({ analysis });
  } catch (err) {
    next(err);
  }
});

api.post("/grade", async (req, res, next) => {
  try {
    const { analysis, answers } = parse(gradeBody, req.body);
    const clipped = Object.fromEntries(
      Object.entries(answers).map(([id, text]) => [id, text.slice(0, config.maxAnswerChars)]),
    );
    const raw = await callJSON({
      kind: "grade",
      model: config.gradeModel,
      prompt: gradePrompt({ analysis, answers: clipped }),
      maxTokens: 2500,
      mockData: () => mocks.grade(clipped),
    });
    let result;
    try {
      result = normalizeGrade(raw, analysis);
    } catch (err) {
      console.error("[grade] invalid model output:", err.message);
      throw new HttpError(502, "Could not grade all 3 answers. Try again.");
    }
    const scores = result.answers.map((a) => a.score);
    const chance = computeChance(analysis.fitScore, scores);
    res.json({
      result: { ...result, avg: averageScore(scores), chance, verdict: verdictOf(chance) },
    });
  } catch (err) {
    next(err);
  }
});
