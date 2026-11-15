(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  // prev (last result, for "before / now"), practice (question being practised) and done (checklist ticks)
  // live in memory only: nothing is written to browser storage.
  var state = { cv: "", jd: "", analysis: null, qs: [], answers: {}, result: null, busy: false, step: 0, view: "upload", prev: null, practice: null, done: {} };
  var MIN_ANSWER = 30, SCAN_MS = 3000;
  var CHECK = '<svg width="18" height="18"><use href="#i-check"/></svg>';

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(n, a, b) { n = Number(n); if (isNaN(n)) n = a; return Math.max(a, Math.min(b, Math.round(n))); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  async function api(path, body) {
    var res;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { throw new Error("Could not reach the server. Check your connection and try again."); }
    var data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Try again.");
    return data;
  }

  /* ---------- views ---------- */
  var VIEWS = ["upload", "scan", "q", "out"];
  var STEP_NAMES = ["Resume and vacancy", "Question 1", "Question 2", "Question 3"];
  function answered(i) { var q = state.qs[i]; return !!q && (state.answers[q.id] || "").trim().length >= MIN_ANSWER; }
  function reachable(n) {
    if (n === 0) return true;
    if (!state.analysis) return false;
    for (var i = 0; i < n - 1; i++) if (!answered(i)) return false;
    return true;
  }
  // The upload view has two screens: the landing page (intro sections) and step 01 (only the #start form).
  var landing = true;
  function layoutUpload() {
    var secs = $("v-upload").children;
    for (var i = 0; i < secs.length; i++) secs[i].hidden = landing ? secs[i].id === "start" : secs[i].id !== "start";
  }
  function renderSteps() {
    var onLanding = landing && state.view === "upload";
    $("steps").innerHTML = [0, 1, 2, 3].map(function (n) {
      var cur = state.step === n && !onLanding, ok = !cur && state.view !== "scan" && reachable(n);
      var title = ok || cur ? STEP_NAMES[n] : (n === 1 ? "Add your documents first" : "Answer the previous question first");
      return '<button type="button" data-s="' + n + '" class="' + (cur ? "cur" : ok ? "ok" : "") + '"' + (cur ? ' aria-current="step"' : "") + (!cur && !ok ? " disabled" : "") + ' title="' + title + '" aria-label="Step ' + (n + 1) + ": " + STEP_NAMES[n] + '">0' + (n + 1) + "</button>";
    }).join("");
  }
  // Optional voice input for the current answer (public/voice.js). Any view change ends it.
  var voice = null;
  // Diagnostics for devices without a console (e.g. iPad): open the site with ?voicedebug to show the
  // recent voice events after the status. Event names and error codes only, never transcript text.
  var VOICE_DEBUG = /voicedebug/.test(location.search + location.hash);
  window.__voiceLog = function () { return voice ? voice.log() : []; };
  function stopVoice() { if (voice) voice.cancel(); }
  window.addEventListener("pagehide", stopVoice);
  function show(v) {
    stopVoice();
    state.view = v;
    VIEWS.forEach(function (k) { $("v-" + k).hidden = k !== v; });
    layoutUpload();
    renderSteps();
    window.scrollTo(0, 0);
  }
  function goStep(n) {
    if (!reachable(n)) return;
    if (n === 0) { state.step = 0; show("upload"); goStart(); } else renderQuestion(n - 1);
  }
  $("steps").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-s]");
    if (!b || b.disabled) return;
    goStep(Number(b.getAttribute("data-s")));
  });
  function resetAll() {
    state.analysis = null; state.qs = []; state.answers = {}; state.result = null; state.step = 0;
    state.prev = null; state.practice = null; state.done = {};
    landing = true; show("upload");
  }
  $("resetBtn").addEventListener("click", function () { if (!state.busy) resetAll(); });
  // Logo returns to the landing page without clearing inputs or interview progress.
  var brand = document.querySelector(".brand");
  function goLanding() { if (state.busy) return; landing = true; show("upload"); }
  brand.setAttribute("role", "link"); brand.setAttribute("tabindex", "0"); brand.setAttribute("aria-label", "Offerlens home"); brand.style.cursor = "pointer";
  brand.addEventListener("click", goLanding);
  brand.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); goLanding(); } });

  /* ---------- 3 second scan ---------- */
  // laterTitle replaces the title, and the bar switches to an indeterminate shimmer, if the AI is still working
  // after the first SCAN_MS, so the progress bar is never left visibly frozen.
  function runScan(title, labels, docNames, work, laterTitle) {
    return new Promise(function (resolve, reject) {
      $("scanTitle").textContent = title;
      $("pbar").classList.remove("wait");
      $("d1").textContent = docNames[0]; $("d2").textContent = docNames[1];
      $("ssteps").innerHTML = labels.map(function (l) {
        return '<li><span class="ic"><svg width="11" height="11" viewBox="0 0 24 24" style="color:#fff"><use href="#i-check"/></svg></span><span>' + esc(l) + "</span></li>";
      }).join("");
      var lis = $("ssteps").children, n = lis.length, step = SCAN_MS / n;
      var fill = $("pfill"); fill.style.transition = "none"; fill.style.width = "0";
      lis[0].className = "now";
      show("scan");
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.transition = "width " + SCAN_MS + "ms linear"; fill.style.width = "92%"; }); });
      var timers = [];
      for (var i = 0; i < n - 1; i++) (function (i) {
        timers.push(setTimeout(function () { lis[i].className = "done"; lis[i + 1].className = "now"; }, (i + 1) * step));
      })(i);
      var workDone = false, minDone = false, out, err;
      function finish() {
        if (err) { timers.forEach(clearTimeout); return reject(err); }
        if (!(workDone && minDone)) return;
        $("pbar").classList.remove("wait");
        for (var k = 0; k < n; k++) lis[k].className = "done";
        fill.style.transition = "width .2s"; fill.style.width = "100%";
        setTimeout(function () { resolve(out); }, 250);
      }
      work.then(function (r) { out = r; workDone = true; finish(); }, function (e) { err = e; workDone = true; finish(); });
      setTimeout(function () {
        minDone = true;
        if (!workDone) { if (laterTitle) $("scanTitle").textContent = laterTitle; $("pbar").classList.add("wait"); }
        finish();
      }, SCAN_MS);
    });
  }

  /* ---------- upload ---------- */
  var MIN_DOC = 150, lastReady = null;
  /** Marks a field complete (green border + check) and returns how many characters it still needs. */
  function fieldNeed(prefix, value) {
    var n = value.trim().length, ok = n >= MIN_DOC;
    if (ok) $(prefix + "-text").classList.add("ok"); else $(prefix + "-text").classList.remove("ok");
    $(prefix + "-ok").hidden = !ok;
    return ok ? 0 : MIN_DOC - n;
  }
  function checkReady() {
    state.cv = $("cv-text").value; state.jd = $("jd-text").value;
    $("cv-count").textContent = state.cv.trim().length.toLocaleString() + " characters";
    $("jd-count").textContent = state.jd.trim().length.toLocaleString() + " characters";
    var needCv = fieldNeed("cv", state.cv), needJd = fieldNeed("jd", state.jd), ready = !needCv && !needJd;
    $("analyze").disabled = state.busy || !ready;
    // Explain why the button is disabled. The visible line updates as you type; the live region speaks only
    // when readiness changes, so screen readers are not interrupted on every keystroke.
    var parts = [];
    if (needCv) parts.push(needCv === MIN_DOC ? "add your CV" : "add " + needCv + " more characters to your CV");
    if (needJd) parts.push(needJd === MIN_DOC ? "add the job post" : "add " + needJd + " more characters to the job post");
    var msg = ready ? "Both look good. You're ready to get your 3 questions." : parts.join(" and ").replace(/^a/, "A") + " to continue.";
    $("ready-msg").textContent = msg;
    $("ready-msg").className = "ready-msg" + (ready ? " ok" : "");
    if (ready !== lastReady) { $("ready-live").textContent = msg; lastReady = ready; }
  }
  async function extract(file) {
    var name = file.name.toLowerCase();
    if (/\.(txt|md)$/.test(name)) return file.text();
    // Library errors (e.g. "Invalid PDF structure", JSZip's "end of central directory") are replaced with plain words.
    var unreadable = function (kind) { return new Error("Could not read " + file.name + ". The " + kind + " may be damaged or not a real " + kind + " file. Save it again as PDF or DOCX, or paste the text instead."); };
    if (/\.docx$/.test(name)) {
      if (!window.mammoth) throw new Error("The DOCX reader did not load. Paste the text instead.");
      var r;
      try { r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() }); }
      catch (e) { throw unreadable("DOCX"); }
      return r.value;
    }
    if (/\.pdf$/.test(name)) {
      var pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      var pdf;
      try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
      catch (e) {
        if (e && e.name === "PasswordException") throw new Error(file.name + " is password-protected. Remove the password or paste the text instead.");
        throw unreadable("PDF");
      }
      var out = [];
      try {
        for (var p = 1; p <= pdf.numPages; p++) {
          var tc = await (await pdf.getPage(p)).getTextContent();
          var line = [], lastY = null;
          tc.items.forEach(function (it) {
            var y = it.transform[5];
            if (lastY !== null && Math.abs(y - lastY) > 3) { out.push(line.join(" ")); line = []; }
            line.push(it.str); lastY = y;
          });
          out.push(line.join(" "));
        }
      } catch (e) { throw unreadable("PDF"); }
      return out.join("\n");
    }
    throw new Error("Use a PDF, DOCX or TXT file.");
  }
  function wireInput(prefix) {
    var drop = $(prefix + "-drop"), input = $(prefix + "-file"), status = $(prefix + "-status"), area = $(prefix + "-text");
    var idle = status.innerHTML;
    async function handle(file) {
      if (!file) return;
      $("up-err").hidden = true; status.textContent = "Reading " + file.name + "...";
      try {
        var text = (await extract(file)).replace(/\u0000/g, "").trim();
        if (text.length < 50) throw new Error("No readable text found in " + file.name + ". If it is a scan, paste the text instead.");
        area.value = text;
        status.innerHTML = '<span class="name">' + esc(file.name) + "</span> loaded. Edit the text below if needed.";
        drop.classList.add("loaded");
      } catch (e) {
        drop.classList.remove("loaded");
        status.innerHTML = idle; $("up-err").textContent = e.message || "Could not read that file."; $("up-err").hidden = false;
      }
      checkReady();
    }
    input.addEventListener("change", function () { handle(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { handle(e.dataTransfer && e.dataTransfer.files[0]); });
    area.addEventListener("input", checkReady);
  }
  wireInput("cv"); wireInput("jd");
  function goStart() { landing = false; state.step = 0; show("upload"); }
  $("heroCta").addEventListener("click", goStart);
  $("ctaBtn").addEventListener("click", goStart);

  var EX_CV = "Aigerim Sadykova\nBackend Engineer, Almaty\n\nSUMMARY\nBackend engineer with 3 years of experience building REST APIs and data pipelines in Python. Comfortable with PostgreSQL, Docker and AWS basics.\n\nEXPERIENCE\nBackend Engineer, Nomad Pay (2023 - present)\n- Built and maintained payment reconciliation services in Python (FastAPI) handling about 40k transactions per day.\n- Reduced slow PostgreSQL queries by 60% through indexing and query rewrites.\n- Wrote Celery workers for nightly settlement jobs; added retries and idempotency keys.\n- Containerized services with Docker; deployed to AWS ECS with GitHub Actions.\n\nJunior Developer, Steppe Labs (2022 - 2023)\n- Developed Django features for an internal CRM; wrote unit tests with pytest.\n- Integrated third-party APIs (SMS, email).\n\nEDUCATION\nBSc Computer Science, Satbayev University, 2022\n\nSKILLS\nPython, FastAPI, Django, PostgreSQL, Redis, Celery, Docker, AWS (ECS, S3), Git, pytest";
  var EX_JD = "Senior Backend Engineer, Payments Platform\nAltyn Fintech\n\nAbout the role\nWe are looking for a Senior Backend Engineer to design and run the services behind our card and wallet payments. You will own critical services end to end and mentor mid-level engineers.\n\nResponsibilities\n- Design and build high-throughput, fault-tolerant payment services.\n- Own service reliability: SLOs, on-call, incident reviews.\n- Design event-driven integrations using Kafka.\n- Improve data modeling and performance in PostgreSQL.\n- Review code and mentor teammates.\n\nRequirements\n- 5+ years of backend experience, with Python or Go.\n- Strong knowledge of distributed systems: consistency, idempotency, retries, queues.\n- Production experience with PostgreSQL and Kafka or similar.\n- Experience with Kubernetes and observability (Prometheus, Grafana).\n- Understanding of payment domain concepts (ledgers, reconciliation, PCI DSS) is a plus.\n- Clear written and spoken English.";
  function fillSample() { $("cv-text").value = EX_CV; $("jd-text").value = EX_JD; checkReady(); }
  $("example").addEventListener("click", fillSample);
  // "Try a sample first": open step 01 with the sample filled in, ready to go.
  $("sampleCta").addEventListener("click", function () { goStart(); fillSample(); $("analyze").focus(); });

  /* ---------- analysis (3 questions) ---------- */
  $("analyze").addEventListener("click", async function () {
    if (state.busy) return;
    state.busy = true; checkReady(); $("up-err").hidden = true; state.step = 0;
    try {
      var a = await runScan("Reading your CV against the role",
        ["Reading your CV", "Reading the vacancy", "Matching requirements to your experience", "Choosing your 3 questions"],
        ["CV", "Vacancy"], api("/api/analyze", { cv: state.cv, jd: state.jd }), "Almost there: picking your 3 questions");
      a = a.analysis;
      var qs = a.questions;
      state.analysis = a; state.qs = qs; state.answers = {}; state.result = null; state.prev = null; state.practice = null;
      renderQuestion(0);
    } catch (e) {
      show("upload"); $("up-err").textContent = e.message; $("up-err").hidden = false; goStart();
    } finally { state.busy = false; checkReady(); }
  });

  /* ---------- question pages (steps 02 to 04) ---------- */
  function renderQuestion(i) {
    stopVoice(); voice = null;
    var a = state.analysis, q = state.qs[i], last = i === 2;
    // Practice mode: opened from a results card. Submitting re-grades all three answers once, on an explicit click.
    var practice = state.practice === i && !!state.result;
    state.step = i + 1;
    var snap = i === 0 ?
      '<div class="snap"><div><p class="eyebrow muted">CV match</p><div class="num">' + a.fitScore + "<small>/100</small></div></div><div><p><b>" + esc(a.role || "Target role") + (a.company ? " at " + esc(a.company) : "") + ".</b> " + esc(a.fitSummary) + "</p>" +
      '<div class="chips">' + arr(a.matched).map(function (m) { return '<span class="chip g">' + esc(m) + "</span>"; }).join("") + arr(a.gaps).map(function (g) { return '<span class="chip r">Gap: ' + esc(g) + "</span>"; }).join("") + "</div></div></div>" : "";
    $("v-q").innerHTML =
      '<div class="narrow pagehead qp"><div class="crumb"><b>0' + (i + 2) + "</b><i></i><span>Question " + (i + 1) + " of 3 &middot; " + q.kind + " &middot; " + esc(q.topic) + "</span></div>" +
      (practice ? '<p class="practice-note">Practising question ' + (i + 1) + ". Edit your answer, then get updated feedback. This grades all three answers again; your other answers stay as they are.</p>" : snap) +
      '<h1 class="qh">' + esc(q.question) + '</h1><p class="lead">' + esc(q.why) + "</p>" +
      '<label class="sr-only" for="ans">Your answer</label><textarea id="ans" placeholder="Write your answer the way you would say it in the interview. Name tools, trade-offs and real numbers where you can.">' + esc(state.answers[q.id] || "") + "</textarea>" +
      '<div class="meta"><span class="hint" id="cnt"></span><span style="display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:baseline;gap:4px 12px;text-align:right"><span class="hint" id="vstat" role="status" aria-live="polite"></span>' +
      '<button class="linkbtn" id="mic" type="button" aria-pressed="false" hidden title="Uses your browser\'s speech recognition. Offerlens does not record or store audio; your browser may send it to its own speech service.">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:5px"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span id="micTx">Speak your answer</span></button></span></div>' +
      '<div class="submitrow"><button class="btn line" id="back" type="button">' + (practice ? "Back to results" : "Back") + '</button><button class="btn" id="next" disabled>' + (practice ? "Get updated feedback" : last ? "Get my result" : "Next question") + '</button><span class="hint" id="subhint"></span></div></div>';
    var ta = $("ans");
    function upd() {
      var n = ta.value.trim().length, ok = n >= MIN_ANSWER;
      $("next").disabled = state.busy || !ok;
      // Short-answer prompts: say how much is missing, then nudge toward specifics.
      $("cnt").textContent = !n ? "" : !ok ? "Add " + (MIN_ANSWER - n) + " more characters" : n < 200 ? "Ready. Tip: name a tool, a trade-off or a real number." : "Ready";
      $("subhint").textContent = ok ? "" : (practice || last ? "Answer to see " + (practice ? "updated feedback." : "your result.") : "Answer this to unlock question " + (i + 2) + ".");
    }
    ta.addEventListener("input", function () { state.answers[q.id] = ta.value; upd(); renderSteps(); });
    $("back").addEventListener("click", function () {
      if (practice) { state.practice = null; state.step = -1; renderResult(); show("out"); }
      else if (i === 0) { state.step = 0; show("upload"); goStart(); } else renderQuestion(i - 1);
    });
    $("next").addEventListener("click", function () { stopVoice(); state.answers[q.id] = ta.value; if (last || practice) grade(); else renderQuestion(i + 1); });
    if (window.OfferlensVoice) {
      var tail = function (s) { return s.length > 60 ? "…" + s.slice(-60) : s; };
      voice = window.OfferlensVoice.create({
        window: window,
        lang: "en-US",
        // Debug-only experiments for Safari (no effect without ?voicedebug): &nocontinuous, &nointerim
        continuous: !(VOICE_DEBUG && /nocontinuous/.test(location.search + location.hash)),
        interimResults: !(VOICE_DEBUG && /nointerim/.test(location.search + location.hash)),
        onAppend: function (t) {
          if ($("ans") !== ta) return; // this question is no longer on screen
          var s = ta.selectionStart, e = ta.selectionEnd;
          var editing = document.activeElement === ta && e < ta.value.length;
          ta.value = window.OfferlensVoice.joinText(ta.value, t);
          if (editing) ta.setSelectionRange(s, e); // keep the caret where the user is editing mid-text
          ta.dispatchEvent(new Event("input")); // same path as typing: saves the answer and updates Next
        },
        onState: function (s, detail) {
          var b = $("mic"), st = $("vstat");
          if (!b || !st || $("ans") !== ta) return;
          var on = s === "listening" || s === "processing";
          b.hidden = s === "unsupported";
          b.setAttribute("aria-pressed", on ? "true" : "false");
          $("micTx").textContent = on ? "Stop speaking" : "Speak your answer";
          st.textContent =
            s === "listening" ? (detail ? "Listening… “" + tail(detail) + "”" : "Listening…") :
            s === "processing" ? (detail || "Processing…") :
            s === "stopped" ? (detail || "Voice input stopped. Your text is kept.") :
            s === "error" || s === "unsupported" ? detail :
            "Voice input ready";
          if (VOICE_DEBUG && voice) st.textContent += " [" + voice.trail(12) + "]";
        },
      });
      $("mic").addEventListener("click", function () { if (!state.busy && voice) voice.toggle(); });
    }
    upd();
    show("q");
    ta.focus({ preventScroll: true });
  }

  /* ---------- grading ---------- */
  async function grade() {
    if (state.busy) return;
    state.busy = true;
    try {
      var g = await runScan("Scoring your answers",
        ["Reading your answers", "Checking each key point", "Weighing answers against your CV match", "Writing your feedback"],
        ["Answers", "Key points"], api("/api/grade", { analysis: state.analysis, answers: state.answers }), "Almost there: writing your feedback");
      g = g.result;
      state.prev = state.result; // kept in memory only, to show "before / now" after re-grading
      state.result = g; state.practice = null; state.done = {};
      state.step = -1; renderResult(); show("out");
    } catch (e) {
      state.busy = false; renderQuestion(state.practice != null ? state.practice : 2);
      var h = $("subhint"); if (h) h.textContent = e.message;
    } finally { state.busy = false; }
  }

  /* ---------- result ---------- */
  function statusOf(s) { return s >= 70 ? ["Strong", "good"] : s >= 40 ? ["Partly there", "warn"] : ["Missed", "miss"]; }
  /** Copies text and reports success or failure in the given status element. */
  function copyText(text, msgId, okMsg) {
    var fail = function () { $(msgId).textContent = "Copy was blocked. Select the text on the page instead."; };
    try { navigator.clipboard.writeText(text).then(function () { $(msgId).textContent = okMsg; }, fail); } catch (e) { fail(); }
  }
  var RING_C = 2 * Math.PI * 52; // circumference of the readiness ring (r = 52)
  function renderResult() {
    var g = state.result, a = state.analysis, v = g.verdict, prev = state.prev, done = state.done || (state.done = {});
    var steps = arr(g.nextSteps), tone = v.key === "pass" ? "pass" : v.key === "close" ? "close" : "no";
    var delta = prev ? g.chance - prev.chance : 0;
    $("v-out").innerHTML =
      '<div class="narrow pagehead"><p class="eyebrow">Your result</p><h1>' + esc(a.role || "Target role") + (a.company ? " at " + esc(a.company) : "") + "</h1>" +
      '<div class="verdict"><p class="eyebrow muted">Verdict</p><div class="big">' + v.title + "</div>" +
      // Readiness ring: the same chance value as before, labelled as an estimate.
      '<div class="ring ' + tone + '" role="img" aria-label="Interview readiness estimate: ' + g.chance + ' percent">' +
      '<svg viewBox="0 0 120 120" width="148" height="148" aria-hidden="true" focusable="false"><circle class="trk" cx="60" cy="60" r="52"/>' +
      '<circle class="val" id="ringVal" cx="60" cy="60" r="52" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/></svg>' +
      '<div class="ring-c" aria-hidden="true"><b>' + g.chance + "%</b><span>estimate</span></div></div>" +
      '<p class="ring-l">Interview readiness</p>' +
      '<p class="est">An estimate from your CV and three answers, not a verified probability of receiving an offer.</p>' +
      (prev ? '<p class="delta">Before: <b>' + prev.chance + "%</b> &rarr; Now: <b>" + g.chance + "%</b> (" + (delta > 0 ? "+" : "") + delta + ")</p>" : "") +
      '<p class="say">' + esc(g.summary) + "</p>" +
      '<div class="scale" role="img" aria-label="Readiness ' + g.chance + ' percent: ' + v.title + '"><div class="tr"><span></span><span></span><span></span><i class="pin" style="left:' + g.chance + '%"></i></div><div class="lb"><span>Not ready</span><span>Close</span><span>Likely pass</span></div></div>' +
      '<p class="how">Calculated as 30% your CV match (' + a.fitScore + ") and 70% your three answers (" + g.avg + ").</p></div>" +

      '<div class="sec"><h2>How each answer did</h2><p class="muted">Green means you made the point. Amber means the interviewer would still be waiting for it.</p>' +
      state.qs.map(function (q, i) {
        var r = g.answers[i], st = statusOf(r.score), total = r.covered.length + r.missed.length, made = r.covered.length;
        var was = prev && prev.answers[i] ? statusOf(prev.answers[i].score)[0] : "";
        return '<div class="rcard"><div class="hd"><div><p class="eyebrow muted">Question ' + (i + 1) + " &middot; " + q.kind + "</p><h3>" + esc(q.question) + "</h3></div>" +
          '<div class="st-col"><span class="status ' + st[1] + '">' + st[0] + "</span>" + (was ? '<span class="was">Before: ' + was + "</span>" : "") + "</div></div>" +
          (total ? '<div class="kp"><span>Key points made: <b>' + made + " of " + total + '</b></span><span class="kpbar" aria-hidden="true"><i style="width:' + Math.round((made / total) * 100) + '%"></i></span></div>' : "") +
          '<div class="cols"><div><h4>You covered</h4>' + (r.covered.length ? '<ul class="checks">' + r.covered.map(function (c) { return '<li><svg width="18" height="18" style="color:var(--good)" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>' + esc(c) + "</li>"; }).join("") + "</ul>" : '<p class="muted" style="font-size:14.5px">Nothing yet.</p>') + "</div>" +
          '<div><h4>You missed</h4>' + (r.missed.length ? '<ul class="checks x">' + r.missed.map(function (c) { return '<li><svg width="18" height="18" aria-hidden="true" focusable="false"><use href="#i-x"/></svg>' + esc(c) + "</li>"; }).join("") + "</ul>" : '<p class="muted" style="font-size:14.5px">Nothing important.</p>') + "</div></div>" +
          '<div class="say-box"><div class="say-hd"><h4>A strong answer sounds like this</h4><button class="linkbtn" type="button" id="sayCopy' + i + '">Copy</button></div><p>' + esc(r.sayItLike) + '</p><span class="hint" id="sayMsg' + i + '" role="status" aria-live="polite"></span></div>' +
          // Key points are shown only here, after all answers are submitted and graded, never on question pages.
          // The "qp" wrapper reuses the existing collapsed <details> styling unchanged.
          '<div class="qp"><details><summary>Show what a strong answer covers</summary><ul class="checks">' + q.passPoints.map(function (p) { return '<li><svg width="18" height="18" style="color:var(--orange)" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>' + esc(p) + "</li>"; }).join("") + "</ul></details></div>" +
          '<div class="card-actions"><button class="btn line sm" type="button" id="practice' + i + '">Practice this again</button></div></div>';
      }).join("") + "</div>" +

      '<div class="sec"><div class="stats"><div class="row"><div class="a"><p class="eyebrow" style="color:#bbb">Your strongest point</p><p>' + esc(g.strongest) + '</p></div><div class="b"><p class="eyebrow" style="color:#555">Your biggest risk</p><p>' + esc(g.risk) + "</p></div></div></div></div>" +

      // Next steps as a checklist. Ticks live in memory for this page only (no browser storage).
      '<div class="sec"><div class="next-hd"><h2>What to do next</h2><span class="next-prog" id="nextProg" role="status" aria-live="polite"></span></div>' +
      '<div class="nbar" aria-hidden="true"><i id="nextBar"></i></div><ol class="next check">' +
      steps.map(function (s, i) {
        return '<li id="ns' + i + '"' + (done[i] ? ' class="done"' : "") + '><input type="checkbox" id="nsc' + i + '"' + (done[i] ? " checked" : "") + ' aria-label="Mark step ' + (i + 1) + ' as done"><div><b>' + esc(s.action) + '</b><span class="w">' + esc(s.why) + '</span></div><span class="when">' + esc(s.when) + "</span></li>";
      }).join("") + "</ol></div>" +

      '<div class="actions" style="margin-top:36px"><button class="btn" id="copy">Copy my prep plan</button><button class="btn line" id="edit">Improve my answers</button><button class="btn line" id="again">Start over</button><span class="hint" id="copyMsg" role="status" aria-live="polite"></span></div>' +
      '<p class="disc">This is an AI estimate based only on the CV, the vacancy and your three answers. It does not know the other candidates or what this employer values most. Use it to decide what to practice, not as a promise.</p><div style="height:80px"></div></div>';

    var offset = (RING_C * (1 - g.chance / 100)).toFixed(2);
    requestAnimationFrame(function () { requestAnimationFrame(function () { $("ringVal").style.strokeDashoffset = offset; }); });

    function progress() {
      var n = steps.filter(function (s, i) { return done[i]; }).length;
      $("nextProg").textContent = n + " of " + steps.length + " done";
      $("nextBar").style.width = (steps.length ? Math.round((n / steps.length) * 100) : 0) + "%";
    }
    steps.forEach(function (s, i) {
      $("nsc" + i).addEventListener("change", function (e) {
        done[i] = !!e.target.checked;
        if (done[i]) $("ns" + i).classList.add("done"); else $("ns" + i).classList.remove("done");
        progress();
      });
    });
    progress();
    state.qs.forEach(function (q, i) {
      $("sayCopy" + i).addEventListener("click", function () { copyText(g.answers[i].sayItLike, "sayMsg" + i, "Copied."); });
      $("practice" + i).addEventListener("click", function () { state.practice = i; renderQuestion(i); });
    });
    $("copy").addEventListener("click", function () { copyText(reportText(), "copyMsg", "Copied."); });
    $("edit").addEventListener("click", function () { state.practice = null; renderQuestion(0); });
    $("again").addEventListener("click", resetAll);
  }
  function reportText() {
    var g = state.result, a = state.analysis, v = g.verdict, L = [];
    L.push("Prep plan: " + (a.role || "Role") + (a.company ? " at " + a.company : ""));
    L.push(v.title + ". Interview readiness (estimate): " + g.chance + "%.", "", g.summary, "");
    state.qs.forEach(function (q, i) {
      var r = g.answers[i];
      L.push("Q" + (i + 1) + " (" + statusOf(r.score)[0] + "): " + q.question);
      r.covered.forEach(function (c) { L.push("  + " + c); });
      r.missed.forEach(function (c) { L.push("  - " + c); });
    });
    L.push("", "Strongest point: " + g.strongest, "Biggest risk: " + g.risk, "", "Next steps:");
    arr(g.nextSteps).forEach(function (s, i) { L.push((i + 1) + ". " + s.action + " (" + s.when + "). " + s.why); });
    return L.join("\n");
  }

  /* ---------- boot ---------- */
  checkReady(); layoutUpload(); renderSteps();
  function init() {
    fetch("/api/health").then(function (r) { if (!r.ok) throw new Error("down"); }).catch(function () { $("no-ai").hidden = false; });
  }
  init();
})();
