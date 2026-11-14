// Unit tests for public/voice.js: the real browser script, run in a VM with a fake
// SpeechRecognition and a fake clock, replaying the event sequences browsers produce.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../public/voice.js", import.meta.url), "utf8");

function load({ ctor = "webkitSpeechRecognition", secure = true, hidden = false, initial = "" } = {}) {
  const instances = [];
  let clock = 0;
  const timers = [];
  class FakeRec {
    constructor() { instances.push(this); this.started = this.stopped = this.aborted = false; }
    start() { if (FakeRec.failStart) throw new Error("InvalidStateError"); this.started = true; }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    fireStart() { this.onstart?.(); }
    results(list) {
      this.onresult?.({ results: list.map(([t, final]) => Object.assign([{ transcript: t }], { isFinal: final })) });
    }
    error(code) { this.onerror?.({ error: code }); }
    end() { this.onend?.(); }
  }
  const win = { isSecureContext: secure, document: { hidden } };
  if (ctor) win[ctor] = FakeRec;
  const sandbox = {
    window: win,
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { const t = { fn, at: clock + ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
  };
  vm.runInNewContext(src, sandbox);
  const V = win.OfferlensVoice;
  const h = { answer: initial, states: [], instances, win, FakeRec, V };
  h.voice = V.create({ window: win, onAppend: (t) => { h.answer = V.joinText(h.answer, t); }, onState: (s, d) => h.states.push([s, d]) });
  h.state = () => h.voice.state;
  h.lastDetail = () => h.states.at(-1)[1];
  h.rec = () => instances.at(-1);
  h.tick = (ms) => { clock += ms; for (const t of timers) if (!t.done && t.at <= clock) { t.done = true; t.fn(); } };
  h.begin = () => { h.voice.toggle(); h.rec().fireStart(); };
  return h;
}

test("joinText adds exactly one space and never drops existing text", () => {
  const { V } = load();
  assert.equal(V.joinText("", "hello"), "hello");
  assert.equal(V.joinText("I typed this.", " and said this "), "I typed this. and said this");
  assert.equal(V.joinText("Line one\n", "two"), "Line one\ntwo");
  assert.equal(V.joinText("keep me", "   "), "keep me");
});

test("feature detection: standard and prefixed constructors, unsupported and insecure pages", () => {
  assert.equal(load({ ctor: "SpeechRecognition" }).state(), "ready");
  assert.equal(load({ ctor: "webkitSpeechRecognition" }).state(), "ready");
  const none = load({ ctor: null });
  assert.equal(none.state(), "unsupported");
  assert.match(none.lastDetail(), /isn't available in this browser\. You can type/);
  none.voice.toggle();
  assert.equal(none.instances.length, 0);
  const insecure = load({ secure: false });
  assert.equal(insecure.state(), "unsupported");
  assert.match(insecure.lastDetail(), /HTTPS/);
});

test("start configures en-US, continuous and interim results, and shows Processing then Listening", () => {
  const h = load();
  h.voice.toggle();
  assert.equal(h.state(), "processing");
  const r = h.rec();
  assert.equal(r.lang, "en-US");
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(r.started, true);
  r.fireStart();
  assert.equal(h.state(), "listening");
});

test("interim words are previewed, never appended; finals are appended once even if events repeat", () => {
  const h = load({ initial: "I typed this first." });
  h.begin();
  h.rec().results([["we would use", false]]);
  assert.equal(h.answer, "I typed this first.");
  assert.equal(h.lastDetail(), "we would use");
  const finalEvent = [["we would use an idempotency key", true], ["and store", false]];
  h.rec().results(finalEvent);
  h.rec().results(finalEvent); // browsers can resend the same results
  h.rec().results(finalEvent);
  assert.equal(h.answer, "I typed this first. we would use an idempotency key");
  assert.equal(h.lastDetail(), "and store");
});

test("typing during recognition is preserved; only new finals are added after the edit", () => {
  const h = load();
  h.begin();
  h.rec().results([["first part", true]]);
  h.answer = "First part, edited by hand."; // the user edits the field while listening
  h.rec().results([["first part", true], ["second part", true]]);
  assert.equal(h.answer, "First part, edited by hand. second part");
});

test("a browser ending recognition by itself restarts safely and keeps every word once", () => {
  const h = load();
  h.begin();
  h.rec().results([["one two", true], ["three", false]]);
  h.tick(10_000);
  h.rec().end(); // e.g. Safari/Chrome stop after a pause
  assert.equal(h.answer, "one two three", "unfinished words are kept when recognition ends");
  assert.equal(h.instances.length, 2, "restarted with a fresh recognizer");
  assert.equal(h.rec().started, true);
  h.rec().fireStart();
  h.rec().results([["four", true]]); // the new session's list starts at index 0
  assert.equal(h.answer, "one two three four");
});

test("a 70-second answer across several automatic restarts is preserved in order with no repeats", () => {
  const h = load({ initial: "Typed intro." });
  h.begin();
  const words = [];
  for (let s = 0; s < 3; s++) {
    const list = [];
    for (let k = 0; k < 6; k++) {
      const phrase = `s${s}p${k}`;
      words.push(phrase);
      list.push([phrase, true]);
      h.rec().results([...list, ["partial", false]]);
      h.tick(4_000);
    }
    h.rec().results(list); // the trailing interim disappears before the end
    h.rec().end();
    h.rec().fireStart();
  }
  assert.equal(h.answer, "Typed intro. " + words.join(" "));
  h.voice.toggle();
  h.rec().end();
  assert.equal(h.state(), "stopped");
});

test("cumulative final results (some mobile browsers) do not duplicate text", () => {
  const h = load();
  h.begin();
  h.rec().results([["I would", true]]);
  h.rec().results([["I would", true], ["I would use a lock", true]]);
  assert.equal(h.answer, "I would use a lock");
});

test("a final that arrives after an unfinished result waits, so nothing is added twice", () => {
  const h = load();
  h.begin();
  h.rec().results([["alpha", false], ["beta", true]]);
  assert.equal(h.answer, "");
  h.rec().results([["alpha", true], ["beta", true]]);
  assert.equal(h.answer, "alpha beta");
});

test("Stop asks for final words (Processing), then shows Stopped; extra clicks while finishing are ignored", () => {
  const h = load({ initial: "Typed." });
  h.begin();
  h.tick(600);
  h.voice.toggle();
  assert.equal(h.state(), "processing");
  assert.equal(h.rec().stopped, true);
  h.voice.toggle(); h.voice.toggle(); // repeated clicks
  assert.equal(h.instances.length, 1);
  h.rec().results([["last words", true]]);
  h.rec().end();
  assert.equal(h.state(), "stopped");
  assert.equal(h.answer, "Typed. last words");
  assert.equal(h.instances.length, 1, "no restart after a manual stop");
});

test("if a browser never fires end after stop, a timer finishes so the button cannot stick", () => {
  const h = load();
  h.begin();
  h.rec().results([["kept", false]]);
  h.tick(600);
  h.voice.toggle();
  h.tick(4_000);
  assert.equal(h.state(), "stopped");
  assert.equal(h.rec().aborted, true);
  assert.equal(h.answer, "kept");
  h.voice.toggle();
  assert.equal(h.instances.length, 2, "can start again");
});

test("repeated clicks never create duplicate sessions", () => {
  const h = load();
  h.voice.start(); h.voice.start(); h.voice.start();
  assert.equal(h.instances.length, 1);
});

test("cancel (submit, switch question, navigate, start over) ignores late events and keeps text", () => {
  const h = load({ initial: "Answer for Q1." });
  h.begin();
  h.rec().results([["spoken for Q1", true]]);
  const old = h.rec();
  h.voice.cancel();
  assert.equal(old.aborted, true);
  assert.equal(h.state(), "ready");
  old.results([["spoken for Q1", true], ["late words", true]]); // arrives after the switch
  old.end();
  assert.equal(h.answer, "Answer for Q1. spoken for Q1");
  assert.equal(h.instances.length, 1, "no restart after cancel");
});

test("permission denied shows a clear error, keeps the answer and does not restart", () => {
  const h = load({ initial: "Typed answer stays." });
  h.voice.toggle();
  h.rec().error("not-allowed");
  assert.equal(h.state(), "error");
  assert.match(h.lastDetail(), /Microphone access is blocked/);
  h.rec().end();
  assert.equal(h.state(), "error");
  assert.equal(h.answer, "Typed answer stays.");
  assert.equal(h.instances.length, 1);
});

test("each fatal error code has a specific message", () => {
  for (const [code, re] of [["service-not-allowed", /dictation settings/], ["audio-capture", /No microphone/], ["network", /can't be reached/], ["language-not-supported", /English/], ["weird-new-code", /error\. Your text is kept/]]) {
    const h = load();
    h.begin();
    h.rec().error(code);
    h.rec().end();
    assert.equal(h.state(), "error", code);
    assert.match(h.lastDetail(), re, code);
  }
});

test("an error with no following end event still finishes, and the user can retry", () => {
  const h = load();
  h.begin();
  h.rec().error("network");
  h.tick(1_500);
  assert.equal(h.voice.active, false);
  h.voice.toggle();
  assert.equal(h.instances.length, 2);
});

test("silence: listening continues through pauses, then stops after repeated no-speech", () => {
  const h = load();
  h.begin();
  for (let k = 0; k < 3; k++) {
    h.tick(8_000);
    h.rec().error("no-speech");
    h.rec().end();
    if (k < 2) { assert.equal(h.state(), "listening", "restarts quietly, still shown as Listening"); h.rec().fireStart(); }
  }
  assert.equal(h.state(), "stopped");
  assert.match(h.lastDetail(), /No speech detected/);
  assert.equal(h.instances.length, 3);
});

test("recognition that keeps ending instantly stops after 3 tries instead of looping", () => {
  const h = load();
  h.voice.toggle();
  for (let k = 0; k < 5 && h.voice.active; k++) h.rec().end();
  assert.equal(h.instances.length, 3);
  assert.equal(h.state(), "error");
  assert.match(h.lastDetail(), /keeps stopping/);
});

test("start() throwing (busy microphone, invalid state) reports an error without breaking", () => {
  const h = load();
  h.FakeRec.failStart = true;
  h.voice.toggle();
  assert.equal(h.state(), "error");
  assert.equal(h.voice.active, false);
});

test("a hidden tab does not restart recognition (no surprise microphone use)", () => {
  const h = load();
  h.begin();
  h.rec().results([["before hiding", true]]);
  h.win.document.hidden = true;
  h.rec().end();
  assert.equal(h.instances.length, 1);
  assert.equal(h.state(), "stopped");
  assert.match(h.lastDetail(), /paused because the page was hidden/, "distinct from a manual stop");
  assert.equal(h.answer, "before hiding");
});

/* ---------- iPad Safari "stops immediately" diagnosis ---------- */

test("a second tap right after starting (double tap / shifting button) does not stop the session", () => {
  const h = load();
  h.voice.toggle();
  h.tick(120);
  h.voice.toggle(); // ghost or double tap
  assert.equal(h.voice.active, true);
  assert.equal(h.rec().stopped, false);
  h.rec().fireStart();
  assert.equal(h.state(), "listening");
  assert.match(h.voice.log().join("\n"), /toggle ignored \(double tap\)/);
  h.tick(600);
  h.voice.toggle(); // a deliberate later tap still stops
  assert.equal(h.rec().stopped, true);
});

test("a manual stop and a hidden page give different messages, so a screenshot tells them apart", () => {
  const manual = load();
  manual.begin();
  manual.tick(2_000);
  manual.voice.toggle();
  manual.rec().end();
  assert.equal(manual.state(), "stopped");
  assert.equal(manual.lastDetail(), "", "manual stop keeps the plain 'Voice input stopped' text");

  const hidden = load();
  hidden.begin();
  hidden.win.document.hidden = true;
  hidden.rec().end();
  assert.equal(hidden.state(), "stopped");
  assert.notEqual(hidden.lastDetail(), "");
});

test("Safari-like quick end right after start (no error) is retried, not reported as a plain stop", () => {
  const h = load();
  h.voice.toggle();
  h.rec().fireStart();
  h.rec().onaudiostart();
  h.tick(300);
  h.rec().end(); // Safari ends on its own
  assert.equal(h.instances.length, 2, "auto-restart attempted");
  assert.notEqual(h.state(), "stopped");
  const log = h.voice.log().join("\n");
  assert.match(log, /s1 audiostart/);
  assert.match(log, /s1 end ms=300 want=1 hidden=0 speech=0/);
  assert.match(log, /auto-restart/);
});

/* ---------- iPad Safari "aborted" before speech (confirmed by ?voicedebug log) ---------- */

function safariAbortCycle(h, ms = 2_000) {
  h.rec().fireStart();
  h.rec().onaudiostart();
  h.tick(ms);
  h.rec().onerror({ error: "aborted", message: "Recognition request was canceled" });
  h.rec().end();
}

test("iPad: a browser 'aborted' before any speech stops with a clear message instead of restarting", () => {
  const h = load({ initial: "My typed answer." });
  h.voice.toggle();
  safariAbortCycle(h);
  assert.equal(h.instances.length, 1, "no automatic restart into the same failure");
  assert.equal(h.state(), "error");
  assert.match(h.lastDetail(), /stopped speech recognition before it heard anything/);
  assert.equal(h.answer, "My typed answer.");
  assert.equal(h.voice.active, false, "microphone released; user can tap again");
  const log = h.voice.log().join("\n");
  assert.match(log, /error aborted msg="Recognition request was canceled"/);
  assert.doesNotMatch(log, /auto-restart/);
});

test("iPad: tapping again after an abort starts exactly one new session (no loop)", () => {
  const h = load();
  h.voice.toggle();
  safariAbortCycle(h);
  h.tick(1_000);
  h.voice.toggle();
  safariAbortCycle(h);
  assert.equal(h.instances.length, 2);
  assert.equal(h.state(), "error");
});

test("a browser 'aborted' after speech keeps the words and restarts, and later empty aborts stop", () => {
  const h = load();
  h.begin();
  h.rec().results([["first words", false]]);
  h.rec().onerror({ error: "aborted" });
  h.rec().end();
  assert.equal(h.answer, "first words", "unfinished words kept");
  assert.equal(h.instances.length, 2, "one restart after a session that had speech");
  safariAbortCycle(h);
  assert.equal(h.instances.length, 2);
  assert.equal(h.state(), "error");
  assert.equal(h.answer, "first words");
});

test("'aborted' after the user pressed Stop is a normal stop, not an error", () => {
  const h = load();
  h.begin();
  h.tick(600);
  h.voice.toggle();
  h.rec().onerror({ error: "aborted" });
  h.rec().end();
  assert.equal(h.state(), "stopped");
  assert.equal(h.lastDetail(), "");
});

test("sessions that end without speech stop after 3 even when each lasts longer than 1.5 s (no endless restarts)", () => {
  const h = load();
  h.voice.toggle();
  for (let k = 0; k < 6 && h.voice.active; k++) {
    h.rec().fireStart();
    h.tick(3_000);
    h.rec().end(); // ends without speech and without a no-speech error
  }
  assert.equal(h.instances.length, 3);
  assert.equal(h.state(), "error");
  assert.match(h.lastDetail(), /keeps stopping/);
});

test("continuous and interim settings can be turned off (debug experiments) and are logged", () => {
  const h = load();
  const v = h.V.create({ window: h.win, continuous: false, interimResults: false, onAppend() {}, onState() {} });
  v.toggle();
  assert.equal(h.rec().continuous, false);
  assert.equal(h.rec().interimResults, false);
  assert.match(v.log().join("\n"), /continuous=0 interim=0 lang=en-US/);
});

test("diagnostic log records events and error codes but never transcript text", () => {
  const h = load();
  h.begin();
  h.rec().results([["my secret answer words", false]]);
  h.rec().results([["my secret answer words", true]]);
  h.rec().error("network");
  h.rec().end();
  const log = h.voice.log().join("\n");
  assert.match(log, /s1 start/);
  assert.match(log, /result n=1 final=1 chars=22/);
  assert.match(log, /error network/);
  assert.match(log, /state error/);
  assert.doesNotMatch(log, /secret|answer words/);
  assert.doesNotMatch(h.voice.trail(), /secret/);
});
