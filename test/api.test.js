// API tests run against the real Express app in mock-AI mode (no network, no API key).
process.env.MOCK_AI = "1";
process.env.RATE_LIMIT_MAX = "1000";

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../server/app.js");

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const longText = "Backend engineer with Python and PostgreSQL experience. ".repeat(6);
const answer = (n) => "I would use an idempotency key and store the result atomically. ".repeat(n);

test("health", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("analyze returns exactly 3 questions: 2 technical, 1 fundamental", async () => {
  const res = await post("/api/analyze", { cv: longText, jd: longText });
  assert.equal(res.status, 200);
  const { analysis } = await res.json();
  assert.equal(analysis.questions.length, 3);
  assert.deepEqual(analysis.questions.map((q) => q.id), ["Q1", "Q2", "Q3"]);
  assert.deepEqual(analysis.questions.map((q) => q.kind), ["Technical", "Technical", "Fundamental"]);
  assert.ok(analysis.questions.every((q) => q.passPoints.length >= 1));
});

test("analyze rejects short documents", async () => {
  const res = await post("/api/analyze", { cv: "too short", jd: longText });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /CV is too short/);
});

test("analyze rejects a missing body", async () => {
  const res = await post("/api/analyze", {});
  assert.equal(res.status, 400);
});

test("grade returns verdict, chance and per-answer results", async () => {
  const { analysis } = await (await post("/api/analyze", { cv: longText, jd: longText })).json();
  const res = await post("/api/grade", { analysis, answers: { Q1: answer(4), Q2: answer(4), Q3: answer(4) } });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.answers.length, 3);
  assert.ok(result.chance >= 5 && result.chance <= 95);
  assert.ok(["pass", "close", "no"].includes(result.verdict.key));
  assert.ok(result.nextSteps.length >= 1);
});

test("better answers give a higher chance than weak ones", async () => {
  const { analysis } = await (await post("/api/analyze", { cv: longText, jd: longText })).json();
  const weak = await (await post("/api/grade", { analysis, answers: { Q1: answer(1), Q2: answer(1), Q3: answer(1) } })).json();
  const strong = await (await post("/api/grade", { analysis, answers: { Q1: answer(6), Q2: answer(6), Q3: answer(6) } })).json();
  assert.ok(strong.result.chance > weak.result.chance);
});

test("grade rejects a missing answer", async () => {
  const { analysis } = await (await post("/api/analyze", { cv: longText, jd: longText })).json();
  const res = await post("/api/grade", { analysis, answers: { Q1: answer(2), Q2: answer(2) } });
  assert.equal(res.status, 400);
});

test("unknown API route returns JSON 404", async () => {
  const res = await fetch(base + "/api/nope");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Not found.");
});

test("security headers are set and static files are served", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-security-policy").includes("script-src 'self'"));
  assert.match(await res.text(), /Offerlens/);
});
