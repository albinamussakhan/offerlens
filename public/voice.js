/*
 * Optional voice-to-text for interview answers, using the browser's own Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). No audio is recorded, stored or uploaded by Offerlens;
 * the browser runs recognition itself (some browsers use their vendor's speech service).
 *
 * Only finalized speech is appended to the answer; interim words are reported as a preview.
 * Works in a browser (window.OfferlensVoice) and in Node tests (module.exports).
 */
(function (root) {
  "use strict";

  var MSG = {
    unsupported: "Voice input isn't available in this browser. You can type your answer.",
    insecure: "Voice input needs a secure (HTTPS) page. You can type your answer.",
    "not-allowed": "Microphone access is blocked. Allow it in your browser settings, or type your answer.",
    "service-not-allowed": "Speech recognition isn't allowed here. Check your browser or device dictation settings, or type your answer.",
    "audio-capture": "No microphone was found. You can type your answer.",
    network: "The speech service can't be reached. Check your connection, or type your answer.",
    "language-not-supported": "English speech recognition isn't available here. You can type your answer.",
    unavailable: "Voice input couldn't start. You can type your answer.",
    unstable: "Voice input keeps stopping. Your text is kept; you can type or try again.",
    hidden: "Voice input paused because the page was hidden. Your text is kept; tap Speak your answer to continue.",
    aborted: "The browser stopped speech recognition before it heard anything. Your text is kept; try again or type your answer.",
    other: "Voice input stopped because of an error. Your text is kept.",
  };

  /** Join answer text and new speech with exactly one space between them. */
  function joinText(current, addition) {
    var a = String(current || ""), b = String(addition || "").trim();
    if (!b) return a;
    if (!a || /\s$/.test(a)) return a + b;
    return a + " " + b;
  }

  function ctorOf(w) {
    return (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null;
  }

  /**
   * opts.window   - the global object (window)
   * opts.onAppend - function(text): add finalized speech to the answer
   * opts.onState  - function(state, detail): state is ready | listening | processing | stopped | error | unsupported
   * opts.lang     - recognition language, default "en-US"
   */
  function create(opts) {
    var w = opts.window || root;
    var Ctor = ctorOf(w);
    var now = function () { return Date.now(); };
    var unsupportedMsg = !Ctor ? MSG.unsupported : w.isSecureContext === false ? MSG.insecure : "";
    var state = "";

    var rec = null;          // the live recognition object, if any
    var session = 0;         // bumps on every start/cancel; events from older sessions are ignored
    var wantOn = false;      // user wants to keep listening (drives auto-restart)
    var inserted = 0;        // results[0..inserted) of this session are already appended
    var lastFinal = "";      // last finalized transcript in this session (for cumulative-result browsers)
    var interim = "";        // current unfinished words (preview only)
    var gotSpeech = false, startedAt = 0, quickEnds = 0, silentEnds = 0, pendingError = "";
    var browserAborted = false; // the browser itself aborted this session (our own aborts are filtered by session id)
    var finishTimer = null, lastToggle = -Infinity;

    // Diagnostics: event names, error codes, counts and state changes only. Never audio or transcript text.
    var log = [], t0 = now();
    function diag(entry) {
      var line = "+" + (now() - t0) + "ms " + entry;
      log.push(line);
      if (log.length > 80) log.shift();
      if (typeof console !== "undefined" && console.debug) console.debug("[voice] " + line);
    }
    function isHidden() { return !!(w.document && w.document.hidden); }
    function onVisibility() { diag("visibility " + (w.document && w.document.visibilityState)); }
    function watchVisibility(on) {
      var d = w.document;
      if (!d || !d.addEventListener) return;
      d.removeEventListener("visibilitychange", onVisibility);
      if (on) d.addEventListener("visibilitychange", onVisibility);
    }

    function set(s, detail) {
      if (s !== state) diag("state " + s);
      state = s;
      try { opts.onState(s, detail || ""); } catch (e) { /* UI may be gone; never break recognition */ }
    }
    function append(text) {
      var t = String(text || "").trim();
      if (!t) return;
      var lf = lastFinal.toLowerCase();
      // Some browsers resend the whole utterance as one growing final result; append only the new tail.
      if (lf && t.length > lastFinal.length && t.toLowerCase().indexOf(lf) === 0 && /\s/.test(t.charAt(lastFinal.length))) {
        lastFinal = t;
        t = t.slice(lf.length).trim();
      } else {
        lastFinal = t;
      }
      if (!t) return;
      gotSpeech = true;
      try { opts.onAppend(t); } catch (e) { /* ignore */ }
    }
    function clearFinishTimer() {
      if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
    }

    function onResult(e) {
      var results = e && e.results;
      if (!results) return;
      var finals = 0, chars = 0;
      for (var k = 0; k < results.length; k++) {
        if (results[k] && results[k].isFinal) finals++;
        chars += results[k] && results[k][0] ? String(results[k][0].transcript || "").trim().length : 0;
      }
      // Counts only: how many results, how many final, how many characters (never the words themselves).
      diag("s" + session + " result n=" + results.length + " final=" + finals + " chars=" + chars);
      if (results.length < inserted) inserted = 0; // the browser started a new result list
      // Append finals strictly in order. A final that follows an unfinished result waits (shown as preview)
      // until everything before it is final, so words are never added twice or out of order.
      var parts = [], blocked = false;
      for (var i = inserted; i < results.length; i++) {
        var r = results[i], text = r && r[0] ? r[0].transcript : "";
        if (r && r.isFinal && !blocked) {
          append(text);
          inserted = i + 1;
        } else {
          if (!(r && r.isFinal)) blocked = true;
          if (text && text.trim()) parts.push(text.trim());
        }
      }
      interim = parts.join(" ");
      if (interim) gotSpeech = true;
      if (wantOn) set("listening", interim);
    }

    function onError(code, message) {
      // The browser's error description (e.g. Safari's reason for aborting) is diagnostic text, not speech.
      diag("s" + session + " error " + code + (message ? ' msg="' + String(message).slice(0, 160) + '"' : ""));
      if (code === "aborted") {
        // Offerlens' own abort() calls bump the session first, so their events never reach here.
        // An "aborted" that does reach here came from the browser while the user wanted to listen.
        if (wantOn) browserAborted = true;
        return;
      }
      if (code === "no-speech") { silentEnds++; return; } // end follows; handled there
      wantOn = false;
      pendingError = MSG[code] || MSG.other;
      set("error", pendingError);
      // "end" normally follows an error; if a browser skips it, finish anyway so the button never sticks.
      var id = session, r = rec;
      clearFinishTimer();
      finishTimer = setTimeout(function () {
        if (id !== session || !rec) return;
        session++;
        try { r.abort(); } catch (e) { /* ignore */ }
        onEnd();
      }, 1500);
    }

    function onEnd() {
      clearFinishTimer();
      rec = null;
      // Recognition is over: words that never got an isFinal flag (common in Safari) are kept, not lost.
      if (interim) { var keep = interim; interim = ""; append(keep); }
      var hidden = isHidden();
      diag("s" + session + " end ms=" + (now() - startedAt) + " want=" + (wantOn ? 1 : 0) + " hidden=" + (hidden ? 1 : 0) + " speech=" + (gotSpeech ? 1 : 0));
      if (wantOn && hidden) {
        // Never reopen the microphone for a page the user can't see; say so instead of a plain "stopped".
        wantOn = false; watchVisibility(false);
        set("stopped", MSG.hidden);
        return;
      }
      if (wantOn) {
        // Every session that ends without speech counts, however long it lasted, so a browser that keeps
        // ending or aborting recognition can never cause endless microphone restarts.
        quickEnds = gotSpeech ? 0 : quickEnds + 1;
        if (gotSpeech) silentEnds = 0;
        if (browserAborted && !gotSpeech) { wantOn = false; pendingError = MSG.aborted; } // restarting repeats it
        else if (silentEnds >= 3) { wantOn = false; watchVisibility(false); set("stopped", "No speech detected. Voice input stopped."); return; }
        else if (quickEnds >= 3) { wantOn = false; pendingError = MSG.unstable; }
        else { diag("auto-restart"); startSession(); return; }
      }
      wantOn = false; watchVisibility(false);
      if (pendingError) set("error", pendingError);
      else set("stopped");
    }

    function startSession() {
      var id = ++session;
      var r;
      try { r = new Ctor(); } catch (e) { wantOn = false; set("error", MSG.unavailable); return; }
      r.lang = opts.lang || "en-US";
      r.continuous = opts.continuous !== false;         // a hint: many browsers still end after a pause, so onEnd restarts
      r.interimResults = opts.interimResults !== false;
      r.maxAlternatives = 1;
      inserted = 0; lastFinal = ""; interim = ""; gotSpeech = false; browserAborted = false; startedAt = now();
      r.onstart = function () { if (id === session) { diag("s" + id + " start"); if (wantOn) set("listening", ""); } };
      ["audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"].forEach(function (name) {
        r["on" + name] = function () { if (id === session) diag("s" + id + " " + name); };
      });
      r.onresult = function (e) { if (id === session) onResult(e); };
      r.onerror = function (e) { if (id === session) onError(e && e.error, e && e.message); };
      r.onend = function () { if (id === session) onEnd(); };
      rec = r;
      diag("s" + id + " start() called hidden=" + (isHidden() ? 1 : 0) + " continuous=" + (r.continuous ? 1 : 0) + " interim=" + (r.interimResults ? 1 : 0) + " lang=" + r.lang);
      try {
        r.start();
      } catch (e) {
        diag("s" + id + " start() threw " + (e && e.name));
        rec = null; wantOn = false;
        set("error", MSG.unavailable);
      }
    }

    function start() {
      if (unsupportedMsg) { set("unsupported", unsupportedMsg); return; }
      if (rec || wantOn) return; // one session at a time
      wantOn = true; quickEnds = 0; silentEnds = 0; pendingError = "";
      watchVisibility(true);
      set("processing", "Waiting for the microphone…");
      startSession();
    }

    /** User pressed Stop: ask the browser for its final words, then end. */
    function stop() {
      if (!rec) { wantOn = false; return; }
      if (!wantOn) return; // already stopping
      wantOn = false;
      diag("stop requested");
      set("processing", "Finishing…");
      var id = session, r = rec;
      try { r.stop(); } catch (e) { /* fall through to the timer */ }
      clearFinishTimer();
      finishTimer = setTimeout(function () { // some browsers never fire "end" after stop()
        if (id !== session) return;
        diag("s" + id + " no end event after stop; finishing");
        session++;
        try { r.abort(); } catch (e) { /* ignore */ }
        onEnd();
      }, 4000);
    }

    /**
     * Submit, question switch, navigation or Start over: end at once and ignore any later events,
     * so speech can never land in another question. Text already in the answer is untouched.
     */
    function cancel() {
      var was = rec;
      if (was || wantOn) diag("cancel (view change)");
      session++; wantOn = false; rec = null; interim = ""; pendingError = "";
      clearFinishTimer(); watchVisibility(false);
      if (was) { try { was.abort(); } catch (e) { /* ignore */ } }
      if (!unsupportedMsg && state !== "ready") set("ready");
    }

    function toggle() {
      // A second tap within half a second (double tap, or the button shifting under the finger as its
      // label changes) must not stop the session the first tap just started.
      var t = now();
      if (t - lastToggle < 500) { diag("toggle ignored (double tap)"); return; }
      lastToggle = t;
      diag("toggle " + (wantOn ? "stop" : rec ? "ignored (finishing)" : "start"));
      if (wantOn) stop();
      else if (!rec) start();
      // while finishing (rec set, wantOn false), extra clicks are ignored
    }

    set(unsupportedMsg ? "unsupported" : "ready", unsupportedMsg);
    return {
      start: start, stop: stop, cancel: cancel, toggle: toggle,
      /** Diagnostic lines (no audio, no transcript text). */
      log: function () { return log.slice(); },
      trail: function (n) { return log.slice(-(n || 10)).map(function (l) { return l.replace(/^\+\d+ms /, ""); }).join(" · "); },
      get state() { return state; },
      get active() { return !!rec || wantOn; },
    };
  }

  var api = { create: create, joinText: joinText, isSupported: function (w) { return !!ctorOf(w || root); }, MSG: MSG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OfferlensVoice = api;
})(typeof window !== "undefined" ? window : this);
