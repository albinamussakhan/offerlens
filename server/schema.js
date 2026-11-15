import { z } from "zod";
import { config } from "./config.js";

const str = (max) => z.string().trim().min(1).max(max);
const strList = (maxItems, maxLen) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

/* ---------- request bodies ---------- */

export const analyzeBody = z.object({
  cv: z.string().trim().min(150, "The CV is too short. Add more text.").max(200_000),
  jd: z.string().trim().min(150, "The vacancy is too short. Add more text.").max(200_000),
});

const questionSchema = z.object({
  id: z.enum(["Q1", "Q2", "Q3"]),
  kind: z.enum(["Technical", "Fundamental"]),
  question: str(600),
  topic: str(80),
  why: str(400),
  passPoints: strList(4, 200).min(1),
});

export const analysisSchema = z.object({
  role: z.string().max(200).default(""),
  company: z.string().max(200).default(""),
  seniority: z.string().max(100).default(""),
  fitScore: z.number().min(0).max(100),
  fitSummary: z.string().max(600).default(""),
  matched: strList(5, 120).default([]),
  gaps: strList(4, 160).default([]),
  questions: z.array(questionSchema).length(3),
});

const fmt = (n) => n.toLocaleString("en-US");

/** One interview answer: at least 30 characters, at most MAX_ANSWER_CHARS (after trimming). */
const answerField = (n) =>
  z.string().trim().min(30).superRefine((s, ctx) => {
    if (s.length > config.maxAnswerChars) {
      ctx.addIssue({
        code: "custom",
        message: `Your answer to question ${n} is too long (${fmt(s.length)} characters; the limit is ${fmt(config.maxAnswerChars)}). Shorten it and try again.`,
      });
    }
  });

export const gradeBody = z.object({
  analysis: analysisSchema,
  answers: z.object({ Q1: answerField(1), Q2: answerField(2), Q3: answerField(3) }),
});

/* ---------- model output, normalized defensively ---------- */

function list(x, max, maxLen) {
  return (Array.isArray(x) ? x : [])
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim().slice(0, maxLen))
    .slice(0, max);
}
const text = (x, maxLen) => (typeof x === "string" ? x.trim().slice(0, maxLen) : "");

/**
 * A 0-100 score from model output, rounded. Accepts a finite number or a plain numeric string ("72").
 * Throws on anything else (missing, null, NaN, Infinity, "high", out of range) so a malformed reply
 * is retried or reported instead of silently becoming 0 and producing a wrong verdict.
 */
export function strictScore(x, field) {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(x) ? Number(x) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${field} must be a number from 0 to 100, got ${JSON.stringify(x) ?? "undefined"}.`);
  }
  return Math.round(n);
}

/** Turn raw model JSON into a safe analysis object, or throw. */
export function normalizeAnalysis(raw) {
  const rawQs = Array.isArray(raw?.questions) ? raw.questions.slice(0, 3) : [];
  if (rawQs.length < 3) throw new Error("The model returned fewer than 3 questions.");
  const candidate = {
    role: text(raw.role, 200),
    company: text(raw.company, 200),
    seniority: text(raw.seniority, 100),
    fitScore: strictScore(raw.fitScore, "fitScore"),
    fitSummary: text(raw.fitSummary, 600),
    matched: list(raw.matched, 5, 120),
    gaps: list(raw.gaps, 4, 160),
    questions: rawQs.map((q, i) => ({
      id: `Q${i + 1}`,
      kind: q?.kind === "Fundamental" ? "Fundamental" : "Technical",
      question: text(q?.question, 600),
      topic: text(q?.topic, 80) || "General",
      why: text(q?.why, 400) || "Interviewers ask this to check core understanding.",
      passPoints: list(q?.passPoints, 4, 200),
    })),
  };
  return analysisSchema.parse(candidate);
}

/** Turn raw grading JSON into a safe result object (without chance/verdict), or throw. */
export function normalizeGrade(raw, analysis) {
  const rawAnswers = Array.isArray(raw?.answers) ? raw.answers.slice(0, 3) : [];
  if (rawAnswers.length < 3) throw new Error("The model graded fewer than 3 answers.");
  const nextSteps = (Array.isArray(raw.nextSteps) ? raw.nextSteps : [])
    .map((s) => ({ action: text(s?.action, 220), why: text(s?.why, 200), when: text(s?.when, 40) }))
    .filter((s) => s.action)
    .slice(0, 4);
  if (!nextSteps.length) throw new Error("The model returned no next steps.");
  return {
    answers: rawAnswers.map((a, i) => ({
      id: analysis.questions[i].id,
      score: strictScore(a?.score, `answers[${i}].score`),
      covered: list(a?.covered, 4, 160),
      missed: list(a?.missed, 4, 160),
      sayItLike: text(a?.sayItLike, 700),
    })),
    summary: text(raw.summary, 600),
    strongest: text(raw.strongest, 300),
    risk: text(raw.risk, 300),
    nextSteps,
  };
}

export const limits = { maxDocChars: config.maxDocChars, maxAnswerChars: config.maxAnswerChars };
