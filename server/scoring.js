// Pure scoring logic, kept separate so it can be unit tested.

export const FIT_WEIGHT = 0.3;
export const ANSWER_WEIGHT = 0.7;

export function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

/** Average of the three answer scores (0-100), rounded. */
export function averageScore(scores) {
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

/**
 * Chance of an offer: 30% CV match, 70% interview answers.
 * Clamped to 5-95 because no estimate from two documents deserves certainty.
 */
export function computeChance(fitScore, answerScores) {
  const avg = answerScores.length ? answerScores.reduce((a, b) => a + b, 0) / answerScores.length : 0;
  return clamp(FIT_WEIGHT * fitScore + ANSWER_WEIGHT * avg, 5, 95);
}

export function verdictOf(chance) {
  if (chance >= 70) return { key: "pass", title: "You would likely pass", tone: "good" };
  if (chance >= 45) return { key: "close", title: "You are close", tone: "warn" };
  return { key: "no", title: "Not ready yet", tone: "bad" };
}
