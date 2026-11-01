// sbs-logger.mjs — the page logger the phone-vs-headset harnesses inject with
// Page.addScriptToEvaluateOnNewDocument (before any app script runs; nothing
// under src/ changes). It only listens; the app never reads what it adds.
//
// Recorded on the page (each row with the page clock, epoch ms =
// performance.timeOrigin + performance.now()):
//   chunk   [wall, contextTime, meanSquare, length] per capture chunk the MSTP
//           reader dispatches (MessagePort.prototype.postMessage; one row per
//           chunk, whatever the consumer count), plus — with cfg.pcm — a copy
//           of its samples (pulled separately as base64 float32);
//   pitch   [wall, ct, ts, voiced, pitch, confidence, vad.p, vad.voice (1/0/-1 none), wid]
//           every pitch-worker "pitch" message;
//   dsp     [wall, ct, intensity, hnr, absoluteTime, wid] every DSP "analysis";
//   state   every resonance-worker "state" post (all fields the cue uses +
//           narrowband + perf) and, from the worker hook below, __tm:
//           { ct, nCh, hCt, nH, busy (handler ms so far), wt };
//   wstat   status / vad-status / speech-detector messages of every worker;
//   worker  each worker created (kind, url, wid);
//   dom     [wall, cue (0 pitch / 1 resonance), attr (0 state, 1 value, 2 dot, 3 trail), value]
//           from a MutationObserver on the cue strip's columns;
//   samp    [wall, pState, pValue, pDot, rState, rValue, rDot, rTrail, streakPx (or -1), listening]
//           a 4 Hz sample of the strip (the streak's drawn height);
//   lt      [start wall, duration] long tasks;
//   gum     each getUserMedia result: track label, getSettings(), getConstraints(),
//           and the track's mute / unmute / ended events;
//   err     window errors (first 200 chars).
// The resonance worker is started from a blob module that imports a small
// hook and then the app's own worker file (timing-run.mjs's method): the
// hook adds __tm to each state post and resolves the worker's root-relative
// fetches ("/Syrinx/...") against the page origin.
// Queues are capped (rows dropped oldest-first and counted) so a stalled
// puller cannot exhaust the page's memory.

export const WORKER_HOOK = `
const ORIGIN = "__ORIGIN__";
const _f = self.fetch.bind(self);
self.fetch = (u, o) => _f(typeof u === "string" && u.startsWith("/") ? ORIGIN + u : u, o);
const T = () => performance.timeOrigin + performance.now();
const S = { ct: null, nCh: 0, hCt: null, nH: 0, busy: 0 };
const pd = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
Object.defineProperty(MessagePort.prototype, "onmessage", { configurable: true,
  get() { return pd.get.call(this); },
  set(h) { pd.set.call(this, typeof h === "function" ? function (ev) { const m = ev.data; if (m && typeof m.contextTime === "number") { S.ct = m.contextTime; S.nCh++; } const t0 = performance.now(); try { return h.call(this, ev); } finally { S.busy += performance.now() - t0; } } : h); } });
let p = self, gd = null;
while (p && !(gd = Object.getOwnPropertyDescriptor(p, "onmessage"))) p = Object.getPrototypeOf(p);
Object.defineProperty(self, "onmessage", { configurable: true,
  get() { return gd.get.call(self); },
  set(h) { gd.set.call(self, typeof h === "function" ? function (ev) { const m = ev.data; if (m && m.type === "pitch-hint" && typeof m.contextTime === "number") { S.hCt = m.contextTime; S.nH++; } const t0 = performance.now(); try { return h.call(this, ev); } finally { S.busy += performance.now() - t0; } } : h); } });
const _pm = self.postMessage.bind(self);
self.postMessage = function (m, t) {
  if (m && m.type === "state") m.__tm = { ct: S.ct, nCh: S.nCh, hCt: S.hCt, nH: S.nH, busy: S.busy, wt: T() };
  return arguments.length > 1 ? _pm(m, t) : _pm(m);
};
`;

/** The page logger (runs in the page; must be self-contained). */
function sbsPageLogger(cfg, workerHook) {
  if (window.__sbs) return;
  const T = () => performance.timeOrigin + performance.now();
  const CAP = cfg.maxRows || 200000, PCM_CAP = Math.round((cfg.maxPcmS || 180) * 48000);
  const Q = { chunk: [], pitch: [], dsp: [], state: [], wstat: [], worker: [], dom: [], samp: [], lt: [], gum: [], err: [] };
  const S = (window.__sbs = {
    v: 1, id: Math.random().toString(36).slice(2, 10), cfg, t0: T(), url: location.href, ua: navigator.userAgent,
    now: T, drops: {}, pcm: [], pcmSamples: 0, pcmDropped: 0, nChunks: 0, nWorkers: 0,
  });
  const push = (k, row) => {
    const q = Q[k];
    q.push(row);
    if (q.length > CAP) { q.splice(0, q.length - CAP); S.drops[k] = (S.drops[k] || 0) + 1; }
  };
  S.pull = () => {
    const out = { id: S.id, now: T(), drops: S.drops, pcmDropped: S.pcmDropped, nChunks: S.nChunks, rows: {} };
    for (const k of Object.keys(Q)) { out.rows[k] = Q[k]; Q[k] = []; }
    return out;
  };
  // base64 float32 of the buffered chunks (in order) + their [ct, length]
  S.pullPcm = async (maxSamples = 96000) => {
    const take = [];
    let n = 0;
    while (S.pcm.length && n < maxSamples) { const c = S.pcm.shift(); take.push(c); n += c.x.length; }
    S.pcmSamples -= n;
    if (!take.length) return { id: S.id, n: 0, idx: [], b64: "" };
    const all = new Float32Array(n);
    let o = 0;
    const idx = [];
    for (const c of take) { all.set(c.x, o); idx.push([c.ct, c.x.length]); o += c.x.length; }
    const u8 = new Uint8Array(all.buffer);
    let b64;
    if (typeof u8.toBase64 === "function") b64 = u8.toBase64();
    else b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(new Blob([u8])); });
    return { id: S.id, n, idx, b64 };
  };
  try {
    window.addEventListener("error", (e) => push("err", [T(), String(e.message || e.error || "").slice(0, 200)]));
    window.addEventListener("unhandledrejection", (e) => push("err", [T(), "rejection: " + String(e.reason && (e.reason.message || e.reason)).slice(0, 200)]));
  } catch { /* ignore */ }
  // ---- capture chunks (the MSTP reader runs on this thread)
  try {
    const PM = MessagePort.prototype.postMessage;
    let lastCt = null;
    MessagePort.prototype.postMessage = function (m) {
      try {
        if (m && typeof m.contextTime === "number" && m.buffer instanceof ArrayBuffer && m.contextTime !== lastCt && m.buffer.byteLength) {
          lastCt = m.contextTime;
          const x = new Float32Array(m.buffer);
          let s = 0;
          for (let i = 0; i < x.length; i++) s += x[i] * x[i];
          push("chunk", [T(), m.contextTime, s / x.length, x.length]);
          S.nChunks++;
          if (cfg.pcm) {
            S.pcm.push({ ct: m.contextTime, x: x.slice() });
            S.pcmSamples += x.length;
            while (S.pcmSamples > PCM_CAP && S.pcm.length) { S.pcmSamples -= S.pcm.shift().x.length; S.pcmDropped++; }
          }
        }
      } catch { /* never break the app */ }
      return PM.apply(this, arguments);
    };
  } catch { /* ignore */ }
  // ---- getUserMedia: the track the app gets
  try {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const G = md.getUserMedia.bind(md);
      md.getUserMedia = async function (c) {
        const t = T();
        const s = await G(c);
        try {
          const tr = s.getAudioTracks()[0];
          const rec = { wall: T(), tCall: t, constraints: c, label: tr && tr.label, settings: tr && tr.getSettings ? tr.getSettings() : null,
            got: tr && tr.getConstraints ? tr.getConstraints() : null, caps: null, devices: null };
          try { rec.caps = tr && tr.getCapabilities ? tr.getCapabilities() : null; } catch { /* ignore */ }
          try { rec.devices = (await md.enumerateDevices()).filter((d) => d.kind === "audioinput").map((d) => ({ label: d.label, id: (d.deviceId || "").slice(0, 12), g: (d.groupId || "").slice(0, 12) })); } catch { /* ignore */ }
          push("gum", rec);
          if (tr) for (const ev of ["mute", "unmute", "ended"]) tr.addEventListener(ev, () => push("gum", { wall: T(), event: ev, label: tr.label }));
        } catch { /* ignore */ }
        return s;
      };
    }
  } catch { /* ignore */ }
  // ---- workers
  try {
    const W = window.Worker;
    let wid = 0;
    window.Worker = class extends W {
      constructor(url, opts) {
        const s = String(url);
        const isRes = cfg.workerHook !== false && s.includes("resonance-worker");
        let u = url;
        if (isRes) {
          const abs = new URL(s, location.href).href;
          const hookUrl = URL.createObjectURL(new Blob([workerHook.replace("__ORIGIN__", location.origin)], { type: "text/javascript" }));
          u = URL.createObjectURL(new Blob([`import "${hookUrl}";\nimport "${abs}";\n`], { type: "text/javascript" }));
        }
        super(u, opts);
        const id = ++wid;
        const kind = s.includes("resonance-worker") ? "resonance" : ((s.match(/(pitch|dsp|gender|lab|vp)-worker/) || [])[1] || "other");
        push("worker", { wall: T(), kind, wid: id, url: s.slice(-80), hooked: isRes });
        S.nWorkers++;
        this.addEventListener("message", (e) => {
          try {
            const m = e.data, now = T();
            if (!m || typeof m !== "object") return;
            if (kind === "pitch" && m.type === "pitch") {
              push("pitch", [now, m.contextTime ?? null, m.ts ?? null, m.voiced ? 1 : 0, m.pitch ?? null, m.confidence ?? null,
                m.vad ? (m.vad.p ?? null) : null, m.vad && typeof m.vad.voice === "boolean" ? (m.vad.voice ? 1 : 0) : -1, id]);
            } else if (kind === "dsp" && m.type === "analysis" && m.data) {
              const d = m.data;
              push("dsp", [now, d.contextTime ?? null, Number.isFinite(d.intensity) ? d.intensity : d.intensity === -Infinity ? -999 : null, d.hnr ?? null, d.absoluteTime ?? null, id]);
            } else if (kind === "resonance" && m.type === "state") {
              push("state", { a: now, wid: id, u: m.u, raw: m.raw, uPlain: m.uPlain, n: m.n, fill: m.fill, voicedS: m.voicedS, clamp: m.clamp, verdict: m.verdict,
                startU: m.startU, shownStartU: m.shownStartU, sinceResumeS: m.sinceResumeS, framesDropped: m.framesDropped,
                nb: m.narrowband ? { on: m.narrowband.on, decided: m.narrowband.decided, f: m.narrowband.f ?? null } : null,
                perf: m.perf ?? null, tm: m.__tm ?? null });
            } else if (m.type === "status" || m.type === "vad-status" || m.type === "speech-detector") {
              push("wstat", { a: now, kind, wid: id, type: m.type, status: m.status ?? null, message: m.message ? String(m.message).slice(0, 200) : null, source: m.source ?? null });
            }
          } catch { /* ignore */ }
        });
      }
    };
  } catch { /* ignore */ }
  // ---- the cue strip: change times + a 4 Hz sample
  const ATTR = ["data-state", "data-value", "data-dot", "data-trail"];
  try {
    const mo = new MutationObserver((recs) => {
      const now = T();
      for (const r of recs) {
        const el = r.target, c = el.getAttribute && el.getAttribute("data-cue");
        if (c !== "pitch" && c !== "resonance") continue;
        push("dom", [now, c === "pitch" ? 0 : 1, ATTR.indexOf(r.attributeName), el.getAttribute(r.attributeName)]);
      }
    });
    const obs = () => mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ATTR });
    if (document.documentElement) obs(); else document.addEventListener("DOMContentLoaded", obs);
  } catch { /* ignore */ }
  setInterval(() => {
    try {
      const p = document.querySelector('[data-cue="pitch"]'), r = document.querySelector('[data-cue="resonance"]');
      const st = r && r.querySelector("[data-cue-streak]");
      const listening = !!document.querySelector("[data-dock-mic-off]");
      push("samp", [T(), p ? p.getAttribute("data-state") : null, p ? p.getAttribute("data-value") : null, p ? p.getAttribute("data-dot") : null,
        r ? r.getAttribute("data-state") : null, r ? r.getAttribute("data-value") : null, r ? r.getAttribute("data-dot") : null,
        r ? Number(r.getAttribute("data-trail")) : null, st ? Number(st.getAttribute("height")) : -1, listening ? 1 : 0]);
    } catch { /* ignore */ }
  }, 250);
  // ---- long tasks
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) push("lt", [performance.timeOrigin + e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  } catch { /* unsupported */ }
}

/** The script text for Page.addScriptToEvaluateOnNewDocument. */
export function loggerScript(cfg = {}) {
  return `(${sbsPageLogger.toString()})(${JSON.stringify(cfg)}, ${JSON.stringify(WORKER_HOOK)});`;
}
