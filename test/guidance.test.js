// "Show what a strong answer covers" must not appear before answers are submitted.
// Runs the real public/app.js (+ voice.js) in a minimal fake DOM against the real server in mock mode.
process.env.MOCK_AI = "1";
process.env.RATE_LIMIT_MAX = "1000";

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const { createApp } = await import("../server/app.js");
const { mockAnalysis } = await import("../server/mock.js");
const PASS_POINTS = mockAnalysis().questions.map((q) => q.passPoints);
const GUIDANCE = "Show what a strong answer covers";

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/* ---------- a tiny DOM: just what app.js touches ---------- */
function makeDom() {
  const els = new Map();
  const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  function el(id) {
    const e = {
      id, value: "", hidden: false, disabled: false, textContent: "", className: "", style: {}, open: false,
      selectionStart: 0, selectionEnd: 0, listeners: {}, attrs: {}, children: [], _html: "",
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
      click() { if (!this.disabled) this.dispatchEvent({ type: "click", target: this }); },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      focus() {}, scrollIntoView() {}, setSelectionRange() {}, closest() { return null; },
      classList: { add() {}, remove() {} },
      get innerHTML() { return this._html; },
      set innerHTML(html) {
        this._html = html;
        // Elements created by this markup replace any old ones with the same id (like a real re-render).
        for (const m of html.matchAll(/id="([^"]+)"/g)) els.delete(m[1]);
        const ta = html.match(/<textarea id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/);
        if (ta) get(ta[1]).value = unescape(ta[2]);
        this.children = (html.match(/<li/g) || []).map(() => ({ className: "" }));
      },
    };
    return e;
  }
  function get(id) { if (!els.has(id)) els.set(id, el(id)); return els.get(id); }
  get("v-upload").children = [{ id: "", hidden: false }, { id: "start", hidden: false }, { id: "", hidden: false }];
  for (const v of ["v-scan", "v-q", "v-out"]) get(v).hidden = true;
  const document = {
    getElementById: get, hidden: false, activeElement: null,
    querySelector: (sel) => (sel === ".brand" ? get("__brand") : null),
    addEventListener() {}, removeEventListener() {},
  };
  return { get, document };
}

async function boot() {
  const { get, document } = makeDom();
  const window = {
    document, location: { search: "", hash: "" }, isSecureContext: true,
    addEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: true }),
  };
  const sandbox = {
    window, document, location: window.location, console,
    fetch: (path, opts) => fetch(base + path, opts),
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    Event: class { constructor(type) { this.type = type; } },
  };
  window.window = window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL("../public/voice.js", import.meta.url), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), sandbox);
  const until = async (fn, what) => {
    for (let k = 0; k < 400; k++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); }
    throw new Error("timed out waiting for " + what);
  };
  const view = () => ["upload", "scan", "q", "out"].find((v) => !get("v-" + v).hidden);
  const answer = (text) => { get("ans").value = text; get("ans").dispatchEvent({ type: "input" }); };
  const nav = (n) => get("steps").dispatchEvent({ type: "click", target: { closest: () => ({ disabled: false, getAttribute: () => String(n) }) } });
  return { get, until, view, answer, nav };
}

const qHtml = (h) => h.get("v-q").innerHTML;
const leaksGuidance = (html, i) => html.includes(GUIDANCE) || PASS_POINTS[i].some((p) => html.includes(p));

test("guidance is hidden before submission, appears after grading, collapsed, per question, without svg text", async () => {
  const h = await boot();
  h.get("heroCta").click();
  h.get("example").click();
  h.get("analyze").click();
  await h.until(() => h.view() === "q", "question 1");

  // Question pages: no control and none of the key points, for every question.
  assert.equal(leaksGuidance(qHtml(h), 0), false, "Q1 page must not reveal guidance");
  assert.match(qHtml(h), /id="mic"/, "voice control still rendered");
  assert.match(qHtml(h), /<textarea id="ans"/, "answer field still rendered");
  h.answer("Use a key per request and store the result with it, returning it on retry.");
  h.get("next").click();
  assert.equal(leaksGuidance(qHtml(h), 1), false, "Q2 page must not reveal guidance");

  // Navigating back to an already answered question still shows no guidance (answers are still editable).
  h.nav(1);
  assert.match(qHtml(h), /Question 1 of 3/);
  assert.equal(leaksGuidance(qHtml(h), 0), false, "answered-but-editable Q1 must not reveal guidance");
  assert.equal(h.get("ans").value, "Use a key per request and store the result with it, returning it on retry.", "answer kept");
  h.nav(2);
  h.answer("Partition the topic by account id and keep consumers idempotent with retries.");
  h.get("next").click();
  assert.equal(leaksGuidance(qHtml(h), 2), false, "Q3 page must not reveal guidance");
  for (let i = 0; i < 3; i++) assert.equal(leaksGuidance(h.get("v-out").innerHTML, i), false, "no results page yet");

  // Submit the last answer: existing grading runs and the results page appears.
  h.answer("Use a transaction with row locks or optimistic versions on the balance row.");
  h.get("next").click();
  await h.until(() => h.view() === "out", "results");
  const out = h.get("v-out").innerHTML;
  assert.match(out, /How each answer did/);
  assert.match(out, /Interview readiness/);
  assert.match(out, /not a verified probability of receiving an offer/, "the number stays labelled as an estimate");

  const cards = out.split('<div class="rcard">').slice(1);
  assert.equal(cards.length, 3);
  cards.forEach((card, i) => {
    assert.equal((card.match(new RegExp(GUIDANCE, "g")) || []).length, 1, `card ${i + 1} has exactly one guidance control`);
    assert.match(card, /<details><summary>Show what a strong answer covers<\/summary>/);
    assert.doesNotMatch(card, /<details[^>]*\bopen\b/, "collapsed by default");
    for (const p of PASS_POINTS[i]) assert.ok(card.includes(p), `card ${i + 1} shows its own key point: ${p}`);
    for (const j of [0, 1, 2].filter((j) => j !== i)) {
      for (const p of PASS_POINTS[j]) assert.ok(!card.includes(p), `card ${i + 1} must not show question ${j + 1}'s key points`);
    }
    // Decorative icons are hidden from assistive tech / text extraction, so no "svg" leaks into the text.
    const guidance = card.slice(card.indexOf("<details>"));
    for (const svg of guidance.match(/<svg[^>]*>/g)) assert.match(svg, /aria-hidden="true"/);
    const text = guidance.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    assert.doesNotMatch(text, /svg/i);
  });

  // Going back to edit answers shows question pages without guidance again.
  h.get("edit").click();
  assert.equal(h.view(), "q");
  assert.equal(leaksGuidance(qHtml(h), 0), false, "Change my answers: Q1 still without guidance");
});
