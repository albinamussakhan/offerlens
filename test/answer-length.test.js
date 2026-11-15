// Long answers must reach the grader in full; answers over MAX_ANSWER_CHARS (default 20,000) are rejected
// with a clear message. Real server + real SDK against a local fake Anthropic API (no paid calls).
import http from "node:http";
import { execFileSync } from "node:child_process";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ---------- local stand-in for POST /v1/messages that records each request ---------- */
const q = (i) => ({ id: `Q${i}`, kind: i === 3 ? "Fundamental" : "Technical", question: `Question ${i}?`, topic: `Topic ${i}`, why: "Because.", passPoints: ["Point A", "Point B", "Point C"] });
const ANALYSIS = { role: "Engineer", company: "Acme", seniority: "Senior", fitScore: 60, fitSummary: "Ok.", matched: ["Python"], gaps: ["Kafka"], questions: [q(1), q(2), q(3)] };
const GRADE = {
  answers: [1, 2, 3].map((i) => ({ id: `Q${i}`, score: 70, covered: ["A"], missed: ["B"], sayItLike: "Say it." })),
  summary: "S.", strongest: "X.", risk: "Y.",
  nextSteps: [1, 2, 3, 4].map((i) => ({ action: `Do ${i}`, why: "W", when: "Today" })),
};
const calls = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "stub", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(GRADE) }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
process.env.RATE_LIMIT_MAX = "1000";
delete process.env.MOCK_AI;
delete process.env.MAX_ANSWER_CHARS; // test the default

const { createApp } = await import("../server/app.js");
const { config } = await import("../server/config.js");

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections(); stub.close(); stub.closeAllConnections(); });
beforeEach(() => { calls.length = 0; });

/* ---------- helpers ---------- */
/** A Markdown answer of exactly `chars` characters whose essential content and conclusion are at the very end. */
function longAnswer(chars, tag) {
  const ending =
    `\n\n## Conclusion (${tag})\n` +
    "- Exactly-once processing: Kafka transactions around consume-transform-produce, read_committed consumers.\n" +
    "- Deduplicate side effects in PostgreSQL with a unique idempotency key in the same transaction.\n" +
    `- Trade-off: extra coordination and latency, so use it only on the money path. END-OF-ANSWER-${tag}`;
  const section = "## Delivery semantics\n- At-most-once may lose a payment event; at-least-once may duplicate it, so consumers must be idempotent.\n\n";
  const fill = chars - ending.length;
  return section.repeat(Math.ceil(fill / section.length) + 1).slice(0, fill) + ending;
}
/** The text of one answer exactly as it appears inside its <answer> fence in the grading prompt. */
function answerInPrompt(prompt, id) {
  const block = prompt.split(`=== ${id} (`)[1];
  return block ? block.split("<answer>\n")[1].split("\n</answer>")[0] : null;
}
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const grade = async (answers) => {
  const res = await fetch(base + "/api/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis: ANALYSIS, answers }) });
  return [res.status, await res.json()];
};
const short = (n) => `Answer ${n}: use an idempotency key and store the result atomically with it.`;
const prompt = () => calls[0].messages[0].content;

/* ---------- tests ---------- */

test("the default answer limit is 20,000 characters", () => {
  assert.equal(config.maxAnswerChars, 20_000);
});

test("an answer of exactly 20,000 characters reaches the grading prompt in full, conclusion included", async () => {
  const q3 = longAnswer(20_000, "Q3");
  assert.equal(q3.length, 20_000);
  const [status] = await grade({ Q1: short(1), Q2: short(2), Q3: q3 });
  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  const sent = answerInPrompt(prompt(), "Q3");
  assert.equal(sent, q3, "the grader must see the whole answer, character for character");
  assert.match(sent, /## Conclusion \(Q3\)[\s\S]*Trade-off: extra coordination[\s\S]*END-OF-ANSWER-Q3$/);
});

test("three long answers at or just under the limit are all graded in full", async () => {
  const answers = { Q1: longAnswer(19_999, "Q1"), Q2: longAnswer(19_500, "Q2"), Q3: longAnswer(20_000, "Q3") };
  const [status] = await grade(answers);
  assert.equal(status, 200);
  for (const id of ["Q1", "Q2", "Q3"]) {
    assert.equal(answerInPrompt(prompt(), id), answers[id], `${id} complete`);
    assert.ok(prompt().includes(`END-OF-ANSWER-${id}`), `${id} ending present`);
  }
});

test("answers longer than the old 3,000-character cut are no longer silently truncated", async () => {
  const answers = { Q1: longAnswer(3_001, "Q1"), Q2: longAnswer(12_751, "Q2"), Q3: longAnswer(3_000, "Q3") };
  const [status] = await grade(answers);
  assert.equal(status, 200);
  for (const id of ["Q1", "Q2", "Q3"]) assert.equal(answerInPrompt(prompt(), id), answers[id], id);
});

test("one character over the limit is rejected with a message naming the question and the limit", async () => {
  const [status, body] = await grade({ Q1: short(1), Q2: longAnswer(20_001, "Q2"), Q3: short(3) });
  assert.equal(status, 400);
  assert.equal(body.error, "Your answer to question 2 is too long (20,001 characters; the limit is 20,000). Shorten it and try again.");
  assert.equal(calls.length, 0, "nothing is sent to the model");
});

test("a ~5,000-word answer is rejected clearly instead of being cut or failing with a generic error", async () => {
  const q3 = longAnswer(32_000, "Q3");
  assert.ok(words(q3) >= 4_000 && words(q3) <= 6_000, `about 5,000 words (got ${words(q3)})`);
  const [status, body] = await grade({ Q1: short(1), Q2: short(2), Q3: q3 });
  assert.equal(status, 400);
  assert.equal(body.error, "Your answer to question 3 is too long (32,000 characters; the limit is 20,000). Shorten it and try again.");
  assert.equal(calls.length, 0);
});

test("surrounding whitespace does not count toward the limit; the trimmed answer is graded in full", async () => {
  const q1 = longAnswer(20_000, "Q1");
  const [status] = await grade({ Q1: "\n\n   " + q1 + "   \n", Q2: short(2), Q3: short(3) });
  assert.equal(status, 200);
  assert.equal(answerInPrompt(prompt(), "Q1"), q1);
});

test("short answers are graded exactly as before", async () => {
  const answers = { Q1: short(1), Q2: short(2), Q3: short(3) };
  const [status, body] = await grade(answers);
  assert.equal(status, 200);
  for (const id of ["Q1", "Q2", "Q3"]) assert.equal(answerInPrompt(prompt(), id), answers[id]);
  assert.equal(body.result.avg, 70);
  assert.ok(body.result.chance >= 5 && body.result.chance <= 95);
});

test("the 30-character minimum is unchanged", async () => {
  const [tooShort] = await grade({ Q1: "x".repeat(29), Q2: short(2), Q3: short(3) });
  assert.equal(tooShort, 400);
  const [enough] = await grade({ Q1: "x".repeat(30), Q2: short(2), Q3: short(3) });
  assert.equal(enough, 200);
});

test("an explicit MAX_ANSWER_CHARS (e.g. set in Render) overrides the default and is enforced the same way", () => {
  // A fresh process, because configuration is read once at startup.
  const script = `
    const { config } = await import(${JSON.stringify(new URL("../server/config.js", import.meta.url).href)});
    const { gradeBody } = await import(${JSON.stringify(new URL("../server/schema.js", import.meta.url).href)});
    const analysis = ${JSON.stringify(ANALYSIS)};
    const ok = "a".repeat(30);
    const check = (len) => { const r = gradeBody.safeParse({ analysis, answers: { Q1: ok, Q2: ok, Q3: "b".repeat(len) } });
      return r.success ? { ok: true, len: r.data.answers.Q3.length } : { ok: false, message: r.error.issues[0].message }; };
    console.log(JSON.stringify({ limit: config.maxAnswerChars, at: check(5000), over: check(5001) }));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, MAX_ANSWER_CHARS: "5000" }, encoding: "utf8",
  }));
  assert.equal(out.limit, 5_000);
  assert.deepEqual(out.at, { ok: true, len: 5_000 });
  assert.equal(out.over.message, "Your answer to question 3 is too long (5,001 characters; the limit is 5,000). Shorten it and try again.");
});
