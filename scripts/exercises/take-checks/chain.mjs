// chain.mjs — the take-checks harness's chain: the session oracle's production chain
// (scripts/session-oracle/lib/chain.mjs + lib/voice-gate.mjs: the REAL pitch worker with the
// REAL FireRedVAD model, the REAL DSP worker, 25 ms capture chunks, both workers fed the same
// chunk) and the REAL hook (useAudioPipeline), with the guided exercises' frame tap
// (src/exercises/bridge.js setExerciseFrameTap) installed.
//
// Differences from the oracle's own drive, both towards the app:
//   - the worker phase keeps every posted pitch message and every DSP "analysis" message
//     whole (the oracle keeps only pitch / confidence / decision and intensity);
//   - the hook phase delivers them through the hook's own handlers: each pitch message to
//     handlePitchMessage (what the hook's pitch-worker onmessage calls; it sets
//     latestPitchRef incl. the detector decision, the steadiness window, …), then the chunk's
//     DSP data to handleAnalysisResult (what the DSP onmessage calls). The oracle sets
//     latestPitchRef itself and passes formants / HNR as null.
// Kept from the oracle (its conventions, README "Voice gate"): a device that keeps up — the
// pitch message of frame kk is delivered with display hop kk + L (L = the tracker's decode
// delay), its `ts` and the DSP frame's `absoluteTime` are the hop's audio-clock time
// ((k + 1) x 25 ms), the worker phase runs with a frozen performance clock (the detector never
// switches itself off as "slow"); pitch hints are not relayed to the DSP worker (they only
// set its formant ceiling; nothing in the frame's voiced / f0 / voiceGate reads formants).
//
// Requires `node --import ./scripts/session-oracle/lib/register.mjs` (react mock, Vite-style
// extensionless imports); run with SO_TAP=0 (pure production imports, no boersma tap).
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { M } from "../../session-oracle/lib/react-mock.mjs";
import { loadSrc } from "../../session-oracle/lib/chain.mjs";
import { loadVoiceGate } from "../../session-oracle/lib/voice-gate.mjs";

// The hook's start() reads import.meta.env.BASE_URL (Vite replaces it with "/Syrinx/");
// as tests/exercises/frame-tap-hook-test.js. Only start() reads it (the parity check's
// start() path); the replacement is the same for both paths.
register("data:text/javascript," + encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function load(url, ctx, next) {
  if (/\\/useAudioPipeline\\.js(\\?|$)/.test(url)) {
    const src = readFileSync(fileURLToPath(url.split("?")[0]), "utf8").replaceAll("import.meta.env.BASE_URL", '"/Syrinx/"');
    return { format: "module", source: src, shortCircuit: true };
  }
  return next(url, ctx);
}`));

export const FRAME_S = 0.025;
const frozenPerf = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
const turn = () => new Promise((r) => setImmediate(r));

export async function loadChain(srcDir) {
  if (process.env.SO_TAP !== "0") throw new Error("run with SO_TAP=0 (pure production imports)");
  const S = await loadSrc(srcDir);
  if (S.defaultLookback == null) throw new Error("no PATH_DEFAULTS.lookback in this src tree");
  const VG = await loadVoiceGate(S);
  const bridge = await import(pathToFileURL(resolve(S.src, "exercises/bridge.js")).href);
  const results = await import(pathToFileURL(resolve(S.src, "exercises/results.js")).href);
  return { S, VG, bridge, results, L: S.defaultLookback };
}

/**
 * Worker phase: the real pitch worker (voice detector on) and DSP worker over `samples`.
 * Returns { n, C, sr, L, events: [{ pitch: [msg…], dsp: data | null }] per chunk, stats }.
 */
export async function runWorkers(CH, samples, sr, { chunkMs = 25 } = {}) {
  const { S, VG, L } = CH;
  const C = Math.round(sr * chunkMs / 1000);
  const n = Math.floor(samples.length / C);
  const events = Array.from({ length: n }, () => ({ pitch: [], dsp: null }));
  const { P, D } = S;
  const stats = { voice: 0, novoice: 0, none: 0, late: 0, frames: 0, dropped: 0, dspMulti: 0 };
  const clock = globalThis.performance;
  globalThis.performance = frozenPerf;
  try {
    VG.PW.setVadModelLoaderForTests(async () => ({ runner: VG.FV.createFireRedRunner(VG.ort, VG.session), cmvn: VG.cmvn }));
    globalThis.self = P; P.posts = [];
    P.onmessage({ data: { type: "init", inputSampleRate: sr, vad: { modelBase: "test:" } } });
    for (let i = 0; i < 500 && !P.posts.some((m) => m.type === "vad-status" && m.status !== "loading"); i++) await turn();
    const st = P.posts.find((m) => m.type === "vad-status" && m.status !== "loading");
    if (!st || st.status !== "ready") throw new Error(`detector not ready: ${st?.status} ${st?.message ?? ""}`);
    const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
    globalThis.self = D; D.posts = [];
    D.onmessage({ data: { type: "init", sampleRate: sr } });
    const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
    let seen = P.posts.length, warm = false;
    const take = (k) => {
      for (let i = seen; i < P.posts.length; i++) {
        const m = P.posts[i];
        if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
        if (m.type === "vad-status") throw new Error(`detector ${m.status}: ${m.message ?? ""}`);
        if (m.type !== "pitch") continue;
        stats.frames++; warm = true;
        const kk = Math.round(m.contextTime * sr / C) - 1;
        const ka = kk + L;
        if (ka < k) stats.late++;
        if ((m.pitch !== null) !== (m.confidence >= 0.5)) throw new Error(`invariant pitch!==null <=> conf>=0.5 broken at chunk ${kk}`);
        const vad = m.vad && typeof m.vad.voice === "boolean" ? m.vad : null;
        if (!vad) stats.none++; else if (vad.voice) stats.voice++; else stats.novoice++;
        if (ka >= n) { stats.dropped++; continue; }
        events[ka].pitch.push(m);
      }
      seen = P.posts.length;
    };
    for (let k = 0; k < n; k++) {
      const ct = (k + 1) * C / sr;
      globalThis.self = P;
      const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
      pp.onmessage({ data: { buffer: a.buffer, contextTime: ct } });
      for (let i = 0; i < (warm ? 200 : 4); i++) {
        await turn();
        if (P.posts.slice(seen).some((m) => m.type === "pitch" && Math.round(m.contextTime * sr / C) - 1 + L === k)) break;
      }
      take(k);
      globalThis.self = D; D.posts.length = 0;
      const b = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
      dp.onmessage({ data: { buffer: b.buffer, contextTime: ct } });
      let nA = 0;
      for (const m of D.posts) {
        if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
        if (m.type === "analysis") { events[k].dsp = m.data; nA++; }
      }
      if (nA > 1) stats.dspMulti++;
    }
    for (let i = 0; i < 20; i++) await turn();
    globalThis.self = P; take(n);
  } finally {
    VG.PW.setVadModelLoaderForTests(null);
    globalThis.performance = clock;
  }
  return { n, C, sr, L, events, stats };
}

let hookGen = 0;
/**
 * Hook phase (the harness path): a fresh hook instance, the exercises frame tap installed,
 * every event delivered through handlePitchMessage / handleAnalysisResult in chunk order.
 * Returns the tap's frames [{ frame, nowMs, k }] in the order the tap received them.
 */
export async function driveHookTap(CH, W) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(pathToFileURL(CH.S.hookPath).href + `?tc=${++hookGen}`);
  mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
  const byName = (name) => M.refs.find((r) => typeof r.current === "function" && r.current.name === name);
  const hpm = byName("handlePitchMessage");
  const har = byName("handleAnalysisResult");
  if (!hpm || !har) throw new Error("could not locate handlePitchMessageRef / handleAnalysisResultRef");
  const tapped = [];
  let cur = null;
  CH.bridge.setExerciseFrameTap((frame) => tapped.push({ frame, nowMs: cur.nowMs, k: cur.k }));
  try {
    for (let k = 0; k < W.n; k++) {
      const nowMs = (k + 1) * W.C / W.sr * 1000;
      for (const m of W.events[k].pitch) hpm.current({ ...m, ts: nowMs });
      const d = W.events[k].dsp;
      if (d) { cur = { nowMs, k }; har.current({ ...d, absoluteTime: nowMs }); }
    }
  } finally {
    CH.bridge.setExerciseFrameTap(null);
  }
  return tapped;
}

/** Frames that arrive inside the take window: takeStart < arrival <= takeEnd (audio clock). */
export function inWindow(tapped, takeStartS, takeEndS) {
  const a = takeStartS * 1000 + 1e-6, b = takeEndS * 1000 + 1e-6;
  return tapped.filter((t) => t.nowMs > a && t.nowMs <= b);
}

const median = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The counts of §1 over the window's frames. a: the frame log's rule (results.js
 * createFrameLog, the tree's own module); b: as a, minus voiceGate === "hidden".
 */
export function counts(CH, win, { capS = null, takeStartS = 0 } = {}) {
  const log = CH.results.createFrameLog();
  const fa = [], fb = [];
  const gate = { voice: 0, hidden: 0, novoice: 0, none: 0 };
  let nb = 0, nb8 = 0, na8 = 0;
  for (const { frame: f, nowMs } of win) {
    log.push(f, nowMs);
    const g = f.voiceGate ?? "none";
    gate[g] = (gate[g] ?? 0) + 1;
    const v = !!f.voiced && f.f0 != null && f.f0 > 0;
    const inCap = capS == null || nowMs <= (takeStartS + capS) * 1000 + 1e-6;
    if (!v) continue;
    fa.push(f.f0);
    if (inCap) na8++;
    if (f.voiceGate === "hidden") continue;
    nb++; fb.push(f.f0);
    if (inCap) nb8++;
  }
  const a = log.voicedSeconds();
  if (Math.abs(a - fa.length * FRAME_S) > 1e-9) throw new Error(`frame log ${a} != own count ${fa.length * FRAME_S}`);
  return {
    frames: win.length,
    a: +(fa.length * FRAME_S).toFixed(3),
    b: +(nb * FRAME_S).toFixed(3),
    a8: +(na8 * FRAME_S).toFixed(3),
    b8: +(nb8 * FRAME_S).toFixed(3),
    medA: median(fa),
    medB: median(fb),
    gate,
  };
}
