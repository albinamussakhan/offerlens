// Missing configuration: no API key and mock mode off. Runs in its own process (node --test isolates files).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY = ""; // set (so a local .env cannot fill it in) but empty
delete process.env.MOCK_AI;

const { createApp } = await import("../server/app.js");

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("health answers 503 with ai: missing, so the page shows its existing notice", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, mock: false, ai: "missing" });
});

test("analyze fails with a generic message that does not name server configuration", async () => {
  const res = await fetch(base + "/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cv: "Backend engineer with Python. ".repeat(8), jd: "Senior backend role with Kafka. ".repeat(8) }),
  });
  assert.equal(res.status, 503);
  const { error } = await res.json();
  assert.equal(error, "The analysis service is not configured. Try again later.");
  assert.doesNotMatch(error, /ANTHROPIC|API_KEY|\.env/);
});
