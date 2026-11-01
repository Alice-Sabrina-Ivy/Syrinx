// sbs-hook.mjs — the REAL useAudioPipeline hook (voice gate on, the app's
// default) replayed over one device's logged pitch-worker and DSP-worker
// messages in their arrival order (pause-diag.mjs's method, on the whole
// session instead of the diag snapshot's ~30 s): the per-frame idle runs of
// the cue strip's gated flags by cause (onset blink / idle inside a pause /
// voice gate / silence hold expired), the silence gate in pauses, and the
// pause floor.
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/mobile/sbs/sbs-hook.mjs --dev=<run folder>/<phone|desktop> [--src=build/resonance-mobile/sbs/tree]
//
// Prints one JSON line. The hook is imported from --src (the clean tree), so
// it is the deployed code. Each pitch message goes in with its logged fields
// (pitch, confidence, voiced, the worker's ts, contextTime, the detector's
// decision); each DSP frame with its logged intensity and absoluteTime; the
// hook's performance clock steps +1 s per call so every frame's state lands
// (the 200 ms throttle is not modelled: per-frame flags, as pause-diag).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDevice } from "./sbs-load.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
import { existsSync } from "node:fs";
const tree = path.join(repo, "build/resonance-mobile/sbs/tree");
const src = arg("src", "") ? path.resolve(repo, arg("src", "")) : existsSync(path.join(tree, "src")) ? tree : repo;
const { M } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/react-mock.mjs")).href);
let fake = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => (fake += 1000), timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const q = (a, p) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };

// pause-report.mjs idleRuns (copied: that module imports the worktree's cue-strip model)
function idleRuns(code) {
  const runs = [];
  let s = -1;
  for (let k = 0; k <= code.length; k++) {
    const idle = k < code.length && !(code[k] & 12);
    if (idle) { if (s < 0) s = k; continue; }
    if (s >= 0) {
      const c0 = code[s], next = k < code.length ? code[k] : 0, len = k - s;
      const cause = c0 & 32 ? "silence" : c0 & 3 ? "gate" : next & 4 && len <= 10 ? "onset" : "pause";
      runs.push({ a: s, b: k - 1, cause });
    }
    s = -1;
  }
  return runs;
}

const D = loadDevice(path.resolve(arg("dev", "")));
M.refs = []; M.effects = []; M.state = null;
const mod = await import(pathToFileURL(path.join(src, "src/audio/useAudioPipeline.js")).href);
const api = mod.useAudioPipeline();
for (const e of M.effects) { try { e(); } catch { /* browser-only */ } }
const hpm = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handlePitchMessage");
const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
const gateRef = M.refs.find((r) => r.current && typeof r.current === "object" && "quietFrames" in r.current);
if (!hpm || !har || !gateRef) { console.log(JSON.stringify({ error: "hook refs not found" })); process.exit(1); }
api.setVoiceGateEnabled(true);
// merge in arrival order
const ev = [...D.rows.pitch.map((p) => ({ w: p[0], k: 0, p })), ...D.rows.dsp.map((d) => ({ w: d[0], k: 1, d }))].sort((a, b) => a.w - b.w || a.k - b.k);
const code = [], inten = [], ct = [];
for (const e of ev) {
  if (e.k === 0) {
    const p = e.p;
    hpm.current({ type: "pitch", pitch: p[4], confidence: p[5], voiced: !!p[3], ts: p[2] ?? p[0], contextTime: p[1], ...(p[7] === -1 ? {} : { vad: { p: p[6], voice: p[7] === 1 } }) });
  } else {
    const d = e.d, I = d[2] === -999 ? -Infinity : d[2];
    if (I == null) continue;
    har.current({ intensity: I, formants: null, spectralTilt: null, hnr: d[3], cpp: null, absoluteTime: d[4] ?? d[0] });
    const s = M.state;
    code.push((s.voiced ? 1 : 0) | (s.holding ? 2 : 0) | (s.pitchVoiced ? 4 : 0) | (s.pitchHolding ? 8 : 0) | (gateRef.current.quietFrames >= 3 ? 32 : 0));
    inten.push(I); ct.push(d[1]);
  }
}
const runs = idleRuns(code);
const mins = (code.length * 0.025) / 60;
const by = {};
for (const c of ["onset", "pause", "gate", "silence"]) { const r = runs.filter((x) => x.cause === c); by[c] = { perMin: +(r.length / mins).toFixed(2), framesPct: +((100 * r.reduce((a, x) => a + x.b - x.a + 1, 0)) / code.length).toFixed(2) }; }
// pause frames: > 0.5 s from any frame whose gated flag is voiced
const vIdx = []; code.forEach((c, i) => { if (c & 4) vIdx.push(i); });
let j = 0;
const pauseI = [];
for (let i = 0; i < code.length; i++) { while (j + 1 < vIdx.length && vIdx[j + 1] <= i) j++; const dPrev = vIdx.length && vIdx[j] <= i ? i - vIdx[j] : Infinity, dNext = j + 1 < vIdx.length ? vIdx[j + 1] - i : vIdx.length && vIdx[j] > i ? vIdx[j] - i : Infinity; if (Math.min(dPrev, dNext) > 20) pauseI.push(i); }
const pi = pauseI.map((i) => (Number.isFinite(inten[i]) ? inten[i] : -120));
console.log(JSON.stringify({
  frames: code.length, minutes: +mins.toFixed(2), idle: by,
  pauseFrames: pauseI.length, floor: { q10: q(pi, 0.1), median: q(pi, 0.5), q90: q(pi, 0.9), below50Pct: pi.length ? +((100 * pi.filter((x) => x < -50).length) / pi.length).toFixed(1) : null },
  silenceGateInPausesPct: pauseI.length ? +((100 * pauseI.filter((i) => code[i] & 32).length) / pauseI.length).toFixed(1) : null,
}));
process.exit(0);
