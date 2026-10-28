// pause-row.mjs — the pause-floor dropout of the Dashboard resonance row,
// stage 2 of 3: the REAL DSP worker and the REAL useAudioPipeline hook over
// the streams the existing runner (chain.mjs run, via pause-queue.sh) already
// put through the REAL pitch worker + FireRedVAD and the resonance chain.
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/mobile/pause-row.mjs [--runs=build/resonance-mobile/pause/runs]
//     [--out=build/resonance-mobile/pause/hook] [--conds=a,b,...] [--shard=i/n]
//
// Per stream (one chain.mjs record, gate on):
//   1. the stream is rebuilt exactly as chain.mjs built it: the same source
//      (readers-<tag>.json variants.L, or the --f32 file), perturb.mjs
//      applyPert(record.pert, y0, 48000, { id, reader, sex, kind }) — checked
//      against the record's level.outActiveDb (must be identical);
//   2. the REAL DSP worker (src/dsp/dsp-worker.js, fake `self`) on the same
//      1200-sample chunks: the full-band 50 ms intensity per chunk;
//   3. the REAL hook (src/audio/useAudioPipeline.js, the session oracle's
//      React mock, voice-gate setting on): per chunk, every pitch message the
//      real pitch worker posted while handling that chunk (chain.mjs's cache:
//      voiced, pitch, contextTime, detector decision) goes through
//      handlePitchMessage (confidence 0.9 / 0.1: the worker's invariant pitch
//      != null <=> confidence >= 0.5 is the only way the hook reads it), then
//      that chunk's DSP frame through handleAnalysisResult. The hook runs
//      with a +1 s per call clock (the session oracle's), so every frame's
//      state lands; pause-report.mjs applies the 200 ms throttle afterwards
//      (setState fires at the first frame >= 200 ms after the last one —
//      the updaters overwrite every flag the cue strip reads, so the
//      throttled state is the per-frame state at the firing frames).
//      A fake resonance worker in the hook's resonanceWorkerRef records the
//      pitch hints the REAL hook relays; they are compared, hint by hint,
//      with the hint chain.mjs fed the resonance chain (gate on).
//   Per chunk the record keeps: intensity (0.01 dB), and a code with bits
//      1 voiced, 2 holding (raw), 4 pitchVoiced, 8 pitchHolding (gated, what
//      both cue-strip rows read), 16 pitchLevel != null, 32 the hook's
//      silence gate engaged after this frame (gateStateRef quietFrames >= 3),
//      64 a DSP frame ran this chunk;
//   and the pitch level (Hz, 0.1) per chunk where it is set.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000, CH = 1200;
const { applyPert, activeLevelDb } = await import("./perturb.mjs");

// ---- clocks: workers frozen (as chain.mjs), hook +1 s per call (session oracle)
const frozenPerf = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
let fakeNow = 0;
const hookPerf = { now: () => (fakeNow += 1000), timeOrigin: 0, mark() {}, measure() {} };
const setPerf = (p) => Object.defineProperty(globalThis, "performance", { value: p, configurable: true, writable: true });
setPerf(frozenPerf);

// ---- DSP worker
let dspPosts = [];
globalThis.self = { postMessage: (m) => dspPosts.push(m) };
await import(pathToFileURL(path.join(repo, "src/dsp/dsp-worker.js")).href);
const dspOn = self.onmessage;
function dspPass(y, nChunks) {
  dspPosts = [];
  dspOn({ data: { type: "init", sampleRate: SR } });
  const port = {};
  dspOn({ data: { type: "port", port } });
  const inten = new Float64Array(nChunks).fill(NaN);
  for (let k = 0; k < nChunks; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    dspPosts.length = 0;
    port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
    for (const m of dspPosts) {
      if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
      if (m.type === "analysis") inten[k] = m.data.intensity;
    }
  }
  return inten;
}

// ---- the hook
const { M } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/react-mock.mjs")).href);
const hookFile = path.join(repo, "src/audio/useAudioPipeline.js");
const hookUrl = pathToFileURL(hookFile).href;
// resonanceWorkerRef's position among the hook's useRef calls (call order).
const refNames = [...readFileSync(hookFile, "utf8").matchAll(/const (\w+) = useRef\(/g)].map((m) => m[1]);
const RES_WORKER_IDX = refNames.indexOf("resonanceWorkerRef");
if (RES_WORKER_IDX < 0 || refNames[RES_WORKER_IDX + 1] !== "resonanceRef") throw new Error("resonanceWorkerRef not found");
let hookGen = 0;
const T0 = 1e6; // ms, the hook's epoch clock for this replay (frame time = T0 + chunk end)
async function hookPass(byChunk, inten) {
  setPerf(hookPerf);
  try {
    M.refs = []; M.effects = []; M.state = null;
    const mod = await import(`${hookUrl}?pause=${++hookGen}`);
    const api = mod.useAudioPipeline();
    for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
    const hpm = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handlePitchMessage");
    const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
    const gateRef = M.refs.find((r) => r.current && typeof r.current === "object" && "quietFrames" in r.current && "lastFreshPitchAt" in r.current);
    if (!hpm || !har || !gateRef) throw new Error("hook refs not found");
    if (M.refs[RES_WORKER_IDX + 1] !== api.resonanceRef) throw new Error("resonanceWorkerRef index mismatch");
    api.setVoiceGateEnabled(true);
    const hints = [];
    M.refs[RES_WORKER_IDX].current = { postMessage: (m) => hints.push(m) };
    const n = byChunk.length;
    const code = new Uint8Array(n), level = new Array(n).fill(null);
    let last = 0, lastLevel = null, msgs = 0, noDecision = 0;
    for (let k = 0; k < n; k++) {
      const now = T0 + (k + 1) * 25;
      for (const m of byChunk[k]) {
        msgs++;
        const vad = m[3] === -1 ? undefined : { p: m[3] ? 0.9 : 0.1, voice: m[3] === 1 };
        if (!vad) noDecision++;
        hpm.current({ type: "pitch", pitch: m[1], confidence: m[1] !== null ? 0.9 : 0.1, voiced: !!m[0], ts: now, contextTime: m[2], ...(vad ? { vad } : {}) });
      }
      let ran = 0;
      if (!Number.isNaN(inten[k])) {
        har.current({ intensity: inten[k], formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: now });
        const s = M.state;
        last = (s.voiced ? 1 : 0) | (s.holding ? 2 : 0) | (s.pitchVoiced ? 4 : 0) | (s.pitchHolding ? 8 : 0) | (s.pitchLevel != null ? 16 : 0)
          | (gateRef.current.quietFrames >= 3 ? 32 : 0);
        lastLevel = s.pitchLevel != null ? Math.round(s.pitchLevel * 10) / 10 : null;
        ran = 64;
      }
      code[k] = (last & 63) | ran;
      level[k] = lastLevel;
    }
    return { code, level, hints, msgs, noDecision };
  } finally {
    setPerf(frozenPerf);
  }
}

// ---- streams
const runsDir = path.resolve(repo, arg("runs", "build/resonance-mobile/pause/runs"));
const outDir = path.resolve(repo, arg("out", "build/resonance-mobile/pause/hook"));
mkdirSync(outDir, { recursive: true });
const readers = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8")).readers;
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const conds = arg("conds", "") ? arg("conds", "").split(",") : readdirSync(runsDir).filter((d) => existsSync(path.join(runsDir, d, "pitch")));
const jobs = [];
for (const cond of conds) {
  const dir = path.join(runsDir, cond);
  for (const f of readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!l) continue;
      const r = JSON.parse(l);
      if (r.gate !== "on") continue;
      jobs.push({ cond, id: r.id, file: path.join(dir, f), line: l });
    }
  }
}
jobs.sort((a, b) => (a.cond + a.id).localeCompare(b.cond + b.id));
const [si, sn] = arg("shard", "0/1").split("/").map(Number);
const mine = jobs.filter((_, i) => i % sn === si);
const out = path.join(outDir, `hook-${si}of${sn}.jsonl`);
const done = new Set();
for (const f of readdirSync(outDir).filter((f) => /^hook-.*\.jsonl$/.test(f))) {
  for (const l of readFileSync(path.join(outDir, f), "utf8").split("\n")) { if (l) { try { const r = JSON.parse(l); done.add(`${r.cond}|${r.id}`); } catch { /* partial */ } } }
}
console.log(`${mine.length} streams (${mine.filter((j) => done.has(`${j.cond}|${j.id}`)).length} done) -> ${out}`);
for (const j of mine) {
  if (done.has(`${j.cond}|${j.id}`)) continue;
  const t0 = Date.now();
  const r = JSON.parse(j.line);
  const meta = JSON.parse(readFileSync(path.join(runsDir, j.cond, "pitch", `${r.id}.json`), "utf8"));
  let y0, ctx;
  if (r.kind === "long") {
    const rd = readers.find((x) => x.id === r.reader);
    y0 = readF32(rd.variants.L);
    ctx = { id: r.id, reader: r.reader, sex: r.sex, kind: r.kind };
  } else if (r.kind === "ext") {
    y0 = new Float32Array(SR * 150); // the zeros file the queue gives --f32
    ctx = { id: r.id, reader: r.reader, sex: r.sex, kind: r.kind };
  } else throw new Error(`kind ${r.kind}`);
  const { y } = await applyPert(r.pert, y0, SR, ctx);
  const outActive = activeLevelDb(y, SR);
  const levelSame = (meta.level.outActiveDb === null && !Number.isFinite(outActive)) || meta.level.outActiveDb === outActive;
  if (!levelSame) throw new Error(`${j.cond} ${r.id}: rebuilt stream differs (active ${outActive} vs ${meta.level.outActiveDb})`);
  const n = meta.byChunk.length;
  if (n !== Math.ceil(y.length / CH)) throw new Error("chunk count");
  const inten = dspPass(y, n);
  const H = await hookPass(meta.byChunk, inten);
  // hint check: the real hook's relayed hints vs chain.mjs's gate-on hint
  const want = meta.byChunk.flat().map((m) => ({ voiced: m[3] === 0 ? false : !!m[0], pitch: m[1], contextTime: m[2] }));
  let hintMismatch = want.length !== H.hints.length ? Math.abs(want.length - H.hints.length) : 0;
  for (let i = 0; i < Math.min(want.length, H.hints.length); i++) {
    const a = want[i], b = H.hints[i];
    if (b.type !== "pitch-hint" || a.voiced !== b.voiced || a.pitch !== b.pitch || a.contextTime !== b.contextTime) hintMismatch++;
  }
  const rec = {
    cond: j.cond, id: r.id, reader: r.reader, sex: r.sex, kind: r.kind, n,
    levelCheck: { outActiveDb: outActive, same: levelSame },
    hint: { n: H.hints.length, want: want.length, mismatch: hintMismatch },
    msgs: H.msgs, noDecision: H.noDecision,
    inten: Array.from(inten, (v) => (Number.isNaN(v) ? null : Number.isFinite(v) ? Math.round(v * 100) / 100 : -999)),
    code: Buffer.from(H.code).toString("base64"),
    level: H.level,
  };
  appendFileSync(out, JSON.stringify(rec) + "\n");
  console.log(`${j.cond} ${r.id}: hints ${H.hints.length - hintMismatch}/${want.length} equal, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
process.exit(0);
