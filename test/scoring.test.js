import test from "node:test";
import assert from "node:assert/strict";
import { averageScore, clamp, computeChance, verdictOf } from "../server/scoring.js";
import { extractJSON } from "../server/ai.js";

test("clamp rounds, bounds and survives bad input", () => {
  assert.equal(clamp(49.6, 0, 100), 50);
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp("abc", 5, 95), 5);
  assert.equal(clamp(undefined, 0, 10), 0);
});

test("averageScore", () => {
  assert.equal(averageScore([100, 50, 0]), 50);
  assert.equal(averageScore([]), 0);
});

test("computeChance weighs CV fit 30% and answers 70%", () => {
  // 0.3 * 60 + 0.7 * 80 = 74
  assert.equal(computeChance(60, [80, 80, 80]), 74);
});

test("computeChance never reaches certainty", () => {
  assert.equal(computeChance(100, [100, 100, 100]), 95);
  assert.equal(computeChance(0, [0, 0, 0]), 5);
});

test("verdict thresholds", () => {
  assert.equal(verdictOf(70).key, "pass");
  assert.equal(verdictOf(69).key, "close");
  assert.equal(verdictOf(45).key, "close");
  assert.equal(verdictOf(44).key, "no");
});

test("extractJSON finds the object inside surrounding text", () => {
  assert.deepEqual(extractJSON('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => extractJSON("no json here"));
});
