// The CV and vacancy must reach the analysis prompt in full up to MAX_DOC_CHARS (default 30,000); longer documents
// are rejected with a clear message. Real server + real SDK against a local fake Anthropic API (no paid calls).
import http from "node:http";
import { execFileSync } from "node:child_process";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ---------- local stand-in for POST /v1/messages that records each request ---------- */
const q = (i) => ({ kind: i === 3 ? "Fundamental" : "Technical", question: `Question ${i}?`, topic: `Topic ${i}`, why: "Because.", passPoints: ["Point A", "Point B", "Point C"] });
const ANALYSIS = { role: "Engineer", company: "Acme", seniority: "Senior", fitScore: 60, fitSummary: "Ok.", matched: ["Python"], gaps: ["Kafka"], questions: [q(1), q(2), q(3)] };
const calls = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "stub", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(ANALYSIS) }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
process.env.RATE_LIMIT_MAX = "1000";
delete process.env.MOCK_AI;
delete process.env.MAX_DOC_CHARS; // test the default

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
/** A document of exactly `chars` characters whose most important line is the very last one. */
function longDoc(chars, tag) {
  const ending = `\nMUST-HAVE (listed last): PCI DSS Level 1 audit experience and Rust. END-OF-${tag}`;
  const filler = "General responsibilities: build and run reliable payment services with good tests. ";
  const fill = chars - ending.length;
  return filler.repeat(Math.ceil(fill / filler.length) + 1).slice(0, fill) + ending;
}
const fenced = (prompt, tag) => (prompt.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`)) || [])[1];
const analyze = async (cv, jd) => {
  const res = await fetch(base + "/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cv, jd }) });
  return [res.status, await res.json()];
};
const SHORT_CV = "Backend engineer with five years of Python, PostgreSQL and payments experience. Built reconciliation services and on-call tooling. ".repeat(2);
const SHORT_JD = "Senior Backend Engineer. Design fault-tolerant payment services with Kafka and PostgreSQL; mentor engineers; own reliability. ".repeat(2);
const prompt = () => calls[0].messages[0].content;

/* ---------- tests ---------- */

test("the default document limit is 30,000 characters", () => {
  assert.equal(config.maxDocChars, 30_000);
});

test("a 30,000-character vacancy reaches the AI in full, including its last line", async () => {
  const jd = longDoc(30_000, "JD");
  assert.equal(jd.length, 30_000);
  const [status] = await analyze(SHORT_CV, jd);
  assert.equal(status, 200);
  assert.equal(fenced(prompt(), "vacancy"), jd, "the vacancy must not be cut");
  assert.match(prompt(), /MUST-HAVE \(listed last\)[^\n]*END-OF-JD/);
});

test("a 30,000-character CV reaches the AI in full, including its last line", async () => {
  const cv = longDoc(30_000, "CV");
  const [status] = await analyze(cv, SHORT_JD);
  assert.equal(status, 200);
  assert.equal(fenced(prompt(), "cv"), cv);
  assert.ok(prompt().includes("END-OF-CV"));
});

test("documents longer than the old 14,000-character cut are no longer truncated", async () => {
  const cv = longDoc(14_001, "CV"), jd = longDoc(15_449, "JD");
  const [status] = await analyze(cv, jd);
  assert.equal(status, 200);
  assert.equal(fenced(prompt(), "cv"), cv);
  assert.equal(fenced(prompt(), "vacancy"), jd);
});

test("one character over the limit is rejected with a message naming the document and the limit", async () => {
  const [s1, b1] = await analyze(SHORT_CV, longDoc(30_001, "JD"));
  assert.equal(s1, 400);
  assert.equal(b1.error, "The vacancy is too long (30,001 characters; the limit is 30,000). Shorten it and try again.");
  const [s2, b2] = await analyze(longDoc(30_001, "CV"), SHORT_JD);
  assert.equal(s2, 400);
  assert.equal(b2.error, "The CV is too long (30,001 characters; the limit is 30,000). Shorten it and try again.");
  assert.equal(calls.length, 0, "nothing is sent to the model");
});

test("a very large document gets the size-limit message, not 'missing required fields'", async () => {
  const [status, body] = await analyze(longDoc(253_799, "CV"), SHORT_JD); // ~250 KB: under the request limit
  assert.equal(status, 400);
  assert.equal(body.error, "The CV is too long (253,799 characters; the limit is 30,000). Shorten it and try again.");
  assert.equal(calls.length, 0);
});

test("a request over the 400 KB body limit explains the limits instead of a bare 'too large'", async () => {
  const [status, body] = await analyze("x".repeat(500_000), SHORT_JD);
  assert.equal(status, 413);
  assert.equal(body.error, "That text is too large to send. A CV or vacancy can be up to 30,000 characters and each answer up to 20,000. Shorten it and try again.");
});

test("surrounding whitespace does not count toward the limit; the trimmed document is sent in full", async () => {
  const jd = longDoc(30_000, "JD");
  const [status] = await analyze(SHORT_CV, "\n\n  " + jd + "  \n");
  assert.equal(status, 200);
  assert.equal(fenced(prompt(), "vacancy"), jd);
});

test("short documents work exactly as before, and the 150-character minimum is unchanged", async () => {
  const [status, body] = await analyze(SHORT_CV, SHORT_JD);
  assert.equal(status, 200);
  assert.equal(body.analysis.questions.length, 3);
  assert.equal(fenced(prompt(), "cv"), SHORT_CV.trim());
  const [tooShort, err] = await analyze("Too short.", SHORT_JD);
  assert.equal(tooShort, 400);
  assert.equal(err.error, "The CV is too short. Add more text.");
});

test("an explicit MAX_DOC_CHARS (e.g. set in Render) overrides the default and is enforced the same way", () => {
  const script = `
    const { config } = await import(${JSON.stringify(new URL("../server/config.js", import.meta.url).href)});
    const { analyzeBody } = await import(${JSON.stringify(new URL("../server/schema.js", import.meta.url).href)});
    const ok = "a".repeat(200);
    const check = (len) => { const r = analyzeBody.safeParse({ cv: ok, jd: "b".repeat(len) });
      return r.success ? { ok: true, len: r.data.jd.length } : { ok: false, message: r.error.issues[0].message }; };
    console.log(JSON.stringify({ limit: config.maxDocChars, at: check(5000), over: check(5001) }));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, MAX_DOC_CHARS: "5000" }, encoding: "utf8",
  }));
  assert.equal(out.limit, 5_000);
  assert.deepEqual(out.at, { ok: true, len: 5_000 });
  assert.equal(out.over.message, "The vacancy is too long (5,001 characters; the limit is 5,000). Shorten it and try again.");
});
