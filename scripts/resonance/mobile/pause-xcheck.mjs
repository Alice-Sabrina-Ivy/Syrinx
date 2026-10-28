// pause-xcheck.mjs — an INDEPENDENT re-implementation of the pause-floor
// dropout measurement (pause-row.mjs + pause-report.mjs), written for the
// verification pass of 2026-10-28. What differs from the measured harness:
//   - intensity: computed here from the samples (20 log10 RMS of the last
//     2400 samples at each 1200-sample chunk end, as dsp-worker.js
//     computeIntensity), compared with pause-row.mjs's stored values;
//   - the hook runs with a REALISTIC clock (performance.now() = the frame's
//     wall time, optional jitter), so the hook's OWN throttledSetState decides
//     which frames reach the strip; M.state after each frame = the strip's
//     props (no post-hoc throttle emulation). Two message orders: pf (the
//     pitch message of a chunk, then its DSP frame — the session oracle's
//     order) and dp (DSP frame first, then the pitch message);
//   - the strip: own event-driven replica of CueStrip.jsx (4 Hz tick at a
//     chosen phase; render = current props + view.snap; thumb; streak per
//     CueColumn) with time-weighted shares (not a 25 ms grid);
//   - pause frames from the CLEAN stream's own intensity (< -60 dBFS), not
//     from posted voicing; 1-5 s pauses from posted voicing with the row idle
//     somewhere in [start, end - 150 ms].
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/mobile/pause-xcheck.mjs --conds=clean,brown_m50 [--ids=...] [--order=pf|dp]
//     [--jitter=0] [--phase=100] [--runs=build/resonance-mobile/pause/runs] [--out=<jsonl>]
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000, CH = 1200, WIN = 2400;
const { applyPert } = await import("./perturb.mjs");
const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const GEO = await import(pathToFileURL(path.join(repo, "src/components/cueMeterGeometry.js")).href);
const { M } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/react-mock.mjs")).href);
const hookUrl = pathToFileURL(path.join(repo, "src/audio/useAudioPipeline.js")).href;

const runsDir = path.resolve(repo, arg("runs", "build/resonance-mobile/pause/runs"));
const hookDir = path.resolve(repo, arg("hook", "build/resonance-mobile/pause/hook"));
const conds = arg("conds", "clean").split(",");
const idsArg = arg("ids", "");
const ORDER = arg("order", "pf");
const JITTER = Number(arg("jitter", "0"));
const PHASE = Number(arg("phase", "100"));
const CADENCE = arg("cadence", "25"); // "25": a frame every 25 ms; "phone": chunks completed by 40 ms (1920-sample) capture buffers, in bursts
const FROM_S = 20;
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/pause/xcheck/xcheck.jsonl"));
mkdirSync(path.dirname(OUT), { recursive: true });

const readers = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8")).readers;
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const loadJsonl = (d, re) => readdirSync(d).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const theirHooks = existsSync(hookDir) ? loadJsonl(hookDir, /^hook-.*\.jsonl$/) : [];
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function intensities(y) {
  const n = Math.ceil(y.length / CH), v = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const e = Math.min(y.length, (k + 1) * CH);
    if (e < WIN) continue;
    let s = 0; for (let i = e - WIN; i < e; i++) s += y[i] * y[i];
    const r = Math.sqrt(s / WIN);
    v[k] = r === 0 ? -Infinity : 20 * Math.log10(r);
  }
  return v;
}

// a seeded jitter (ms) per frame
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); }; }

let gen = 0;
async function hookPass(byChunk, inten) {
  let wall = 0;
  const saved = globalThis.performance;
  Object.defineProperty(globalThis, "performance", { value: { now: () => wall, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
  try {
    M.refs = []; M.effects = []; M.state = null;
    const mod = await import(`${hookUrl}?xcheck=${++gen}`);
    const api = mod.useAudioPipeline();
    for (const e of M.effects) { try { e(); } catch { /* browser-only */ } }
    const hpm = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handlePitchMessage");
    const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
    const gateRef = M.refs.find((r) => r.current && typeof r.current === "object" && "quietFrames" in r.current);
    if (!hpm || !har || !gateRef) throw new Error("refs");
    api.setVoiceGateEnabled(true);
    const n = byChunk.length, T0 = 1e6, rnd = rng(12345);
    const t = new Float64Array(n), pv = new Uint8Array(n), ph = new Uint8Array(n), lvl = new Array(n).fill(null), quiet = new Uint8Array(n), fired = new Uint8Array(n);
    let lastStateObj = M.state, prevBase = null;
    for (let k = 0; k < n; k++) {
      const base = CADENCE === "phone" ? Math.ceil(((k + 1) * CH) / 1920) * 40 : (k + 1) * 25;
      wall = T0 + base + (base === prevBase ? 0.5 : 0) + (JITTER ? (rnd() - 0.5) * 2 * JITTER : 0);
      prevBase = base;
      t[k] = wall - T0;
      const sendMsgs = () => { for (const m of byChunk[k]) {
        const vad = m[3] === -1 ? undefined : { p: m[3] ? 0.9 : 0.1, voice: m[3] === 1 };
        hpm.current({ type: "pitch", pitch: m[1], confidence: m[1] !== null ? 0.9 : 0.1, voiced: !!m[0], ts: wall, contextTime: m[2], ...(vad ? { vad } : {}) });
      } };
      const dsp = () => { if (!Number.isNaN(inten[k])) har.current({ intensity: inten[k], formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: wall }); };
      if (ORDER === "dp") { dsp(); sendMsgs(); } else { sendMsgs(); dsp(); }
      const s = M.state;
      fired[k] = s !== lastStateObj ? 1 : 0; lastStateObj = s;
      pv[k] = s.pitchVoiced ? 1 : 0; ph[k] = s.pitchHolding ? 1 : 0; lvl[k] = s.pitchLevel ?? null;
      quiet[k] = gateRef.current.quietFrames >= 3 ? 1 : 0;
    }
    return { t, pv, ph, lvl, quiet, fired };
  } finally {
    Object.defineProperty(globalThis, "performance", { value: saved, configurable: true, writable: true });
  }
}

const G448 = GEO.meterGeometry(189, 270, false);
const pxPerX = G448.y(0) - G448.y(1);

// event-driven strip: frames (prop changes) and ticks; returns time-weighted shares + tick metrics
function strip(H, posts, { cf = false, from = FROM_S * 1000, to = 150000 } = {}) {
  const n = H.t.length;
  const postTime = posts.map((p) => H.t[Math.min(H.t.length - 1, p[0])]);
  const snapOf = (p) => (p ? { u: p[2], raw: p[3], shownStartU: p[5], startU: p[6], fill: p[7], voicedS: p[8],
    verdict: ["silent", "warming", "score", "sustained", "pause", "stale"][p[9]], sinceResumeS: p[10], narrowband: { on: !!p[11], decided: !!p[12] } } : null);
  // last pitchVoiced time per frame (cf)
  let lastPv = -Infinity;
  const props = (k) => {
    if (k < 0) return { pitchVoiced: false, pitchHolding: false, pitchLevel: null };
    return { pitchVoiced: !!H.pv[k], pitchHolding: !!H.ph[k] || (cf && !H.pv[k] && H.t[k] - lastPvAt[k] <= 5000), pitchLevel: H.lvl[k] };
  };
  const lastPvAt = new Float64Array(n);
  for (let k = 0; k < n; k++) { if (H.pv[k]) lastPv = H.t[k]; lastPvAt[k] = lastPv; }
  // events: frames and ticks, by time
  const ev = [];
  for (let k = 0; k < n; k++) ev.push({ t: H.t[k], k, type: "f" });
  for (let tt = PHASE; tt <= 150000 + 250; tt += 250) ev.push({ t: tt, type: "t" });
  ev.sort((a, b) => a.t - b.t || (a.type === "f" ? -1 : 1));
  const tr = CS.createTrail(CS.RESONANCE_TRAIL.n, CS.RESONANCE_TRAIL.everyTicks);
  let curK = -1, pi = -1, view = { snap: null, trail: [] };
  let lastT = null, lastScreen = null;
  const acc = { dur: 0, idle: 0, thumb: 0, warming: 0, notIdle: 0 };
  const ticks = [];
  const idleIntervals = [];
  const screen = () => {
    const st = CS.cueRowStates({ ...props(curK), snap: view.snap, workerStatus: "ready", hasRef: true }).resonance;
    const thumb = CS.dotOpacity(st) !== null && view.snap?.u != null;
    return { st, thumb };
  };
  const integrate = (tNow) => {
    if (lastT !== null && lastScreen) {
      const a = Math.max(lastT, from), b = Math.min(tNow, to);
      if (b > a) {
        const d = b - a; acc.dur += d;
        if (lastScreen.st === "idle") { acc.idle += d; idleIntervals.push([a, b]); }
        if (lastScreen.st !== "idle" && lastScreen.st !== "starting") acc.notIdle += d;
        if (lastScreen.st === "warming") acc.warming += d;
        if (lastScreen.thumb) acc.thumb += d;
      }
    }
    lastT = tNow;
  };
  for (const e of ev) {
    integrate(e.t);
    if (e.type === "f") curK = e.k;
    else {
      while (pi + 1 < posts.length && postTime[pi + 1] <= e.t) pi++;
      const snap = pi >= 0 ? snapOf(posts[pi]) : null;
      const inputs = { ...props(curK), snap };
      const st = CS.cueRowStates({ ...inputs, workerStatus: "ready", hasRef: true }).resonance;
      const trail = tr.tick(st, CS.rowValue("resonance", inputs));
      view = { snap, trail };
      // the render after the tick (CueColumn): thumb from the CURRENT props and view
      const sc = screen();
      const val = view.snap?.u ?? null;
      const dotPos = CS.dotOpacity(sc.st) !== null && val != null ? CS.axisPos("resonance", val, { clamp: CS.resonanceClamp(view.snap) }) : null;
      const ys = trail.map((v) => CS.axisPos("resonance", v)).filter(Boolean).map((p) => G448.y(p.x));
      let drawable = false;
      if (ys.length) {
        const anchor = dotPos ? G448.y(dotPos.x) : ys[ys.length - 1];
        drawable = Math.max(anchor, ...ys) - Math.min(anchor, ...ys) >= 3;
      }
      if (e.t >= from && e.t <= to) ticks.push({ t: e.t, len: trail.length, drawable });
    }
    lastScreen = screen();
  }
  integrate(to);
  let clears = 0; for (let i = 1; i < ticks.length; i++) if (ticks[i - 1].len > 0 && ticks[i].len === 0) clears++;
  // merge idle intervals into idle entries
  let entries = 0, prevEnd = -1;
  for (const [a, b] of idleIntervals) { if (a > prevEnd + 1e-6) entries++; prevEnd = b; }
  const min = acc.dur / 60000;
  return {
    idlePct: (100 * acc.idle) / acc.dur, thumbPct: (100 * acc.thumb) / acc.dur, warmingPct: (100 * acc.warming) / acc.dur, notIdlePct: (100 * acc.notIdle) / acc.dur,
    idlePerMin: entries / min, trailMean: mean(ticks.map((x) => x.len)), clearsPerMin: clears / ((ticks.length * 0.25) / 60),
    streakPct: (100 * ticks.filter((x) => x.drawable).length) / ticks.length, idleIntervals,
  };
}

// their post-hoc throttle from their per-frame codes, for an exactness check of the emulation
function theirThrottled(code) {
  const n = code.length, pv = new Uint8Array(n), ph = new Uint8Array(n);
  let last = -Infinity, cur = 0;
  for (let k = 0; k < n; k++) { const tms = (k + 1) * 25; if (code[k] & 64 && tms - last >= 200) { last = tms; cur = code[k]; } pv[k] = cur & 4 ? 1 : 0; ph[k] = cur & 8 ? 1 : 0; }
  return { pv, ph };
}

const cleanCache = new Map();
for (const cond of conds) {
  const dir = path.join(runsDir, cond);
  let recs = loadJsonl(dir, /^runs-.*\.jsonl$/).filter((r) => r.gate === "on");
  if (idsArg) { const s = new Set(idsArg.split(",")); recs = recs.filter((r) => s.has(r.id) || s.has(r.reader)); }
  for (const r of recs) {
    const t0 = Date.now();
    const meta = JSON.parse(readFileSync(path.join(dir, "pitch", `${r.id}.json`), "utf8"));
    const ctx = { id: r.id, reader: r.reader, sex: r.sex, kind: r.kind };
    const y0 = r.kind === "long" ? readF32(readers.find((x) => x.id === r.reader).variants.L) : new Float32Array(SR * 150);
    const { y } = await applyPert(r.pert, y0, SR, ctx);
    const inten = intensities(y);
    // the noise alone and the speech alone (level step only)
    const levelOnly = r.pert.filter((p) => p.type === "level");
    const ys = levelOnly.length ? (await applyPert(levelOnly, y0, SR, ctx)).y : y0;
    let noiseMed = null;
    if (r.pert.some((p) => p.type === "mod")) {
      const z = new Float32Array(y.length); for (let i = 0; i < y.length; i++) z[i] = y[i] - ys[i];
      noiseMed = med(Array.from(intensities(z)));
    }
    const intenS = intensities(ys);
    // compare with pause-row.mjs's stored intensity
    const th = theirHooks.find((h) => h.cond === cond && h.id === r.id);
    let intenCmp = null, throttleCmp = null;
    const H = await hookPass(meta.byChunk, inten);
    if (th) {
      let nn = 0, same = 0, maxd = 0;
      for (let k = 0; k < th.inten.length; k++) {
        if (th.inten[k] == null) continue; nn++;
        const a = th.inten[k] === -999 ? -Infinity : th.inten[k], b = Number.isFinite(inten[k]) ? Math.round(inten[k] * 100) / 100 : -Infinity;
        if (a === b) same++; else if (Number.isFinite(a) && Number.isFinite(b)) maxd = Math.max(maxd, Math.abs(a - b));
      }
      intenCmp = { n: nn, same, maxd };
      if (ORDER === "pf" && !JITTER) {
        const T = theirThrottled(Buffer.from(th.code, "base64"));
        let d = 0; for (let k = 0; k < T.pv.length; k++) if (T.pv[k] !== H.pv[k] || T.ph[k] !== H.ph[k]) d++;
        throttleCmp = { n: T.pv.length, diff: d };
      }
    }
    // pause frames from the clean stream: speech-alone intensity < -60 dBFS, k >= 20 s
    const kFrom = FROM_S * 40;
    const pf = [], pq = [];
    for (let k = kFrom; k < inten.length; k++) if (intenS[k] < -60) { pf.push(inten[k]); pq.push(H.quiet[k]); }
    // speech level: intensity on posted-voiced display hops of the speech alone
    const vh = []; for (let k = kFrom; k < inten.length; k++) if (meta.byChunk[k].some((m) => m[0])) vh.push(intenS[k]);
    // 1-5 s pauses from the clean condition's posted voicing (own implementation)
    let clean = cleanCache.get(r.id);
    if (!clean && existsSync(path.join(runsDir, "clean", "pitch", `${r.id}.json`))) { clean = JSON.parse(readFileSync(path.join(runsDir, "clean", "pitch", `${r.id}.json`), "utf8")).byChunk; cleanCache.set(r.id, clean); }
    const act = strip(H, r.posts), cf = strip(H, r.posts, { cf: true });
    let mid = null;
    if (clean && r.kind === "long") {
      const pauses = []; let s = -1;
      for (let k = 0; k <= clean.length; k++) {
        const unv = k < clean.length && clean[k].every((m) => !m[0]);
        if (unv) { if (s < 0) s = k; continue; }
        if (s >= 0 && k - s >= 12) pauses.push([s, k - 1]);
        s = -1;
      }
      const m15 = pauses.filter(([a, b]) => a >= kFrom && (b - a + 1) * 0.025 >= 1 && (b - a + 1) * 0.025 < 5);
      const inside = m15.filter(([a, b]) => act.idleIntervals.some(([x, y2]) => y2 > (a + 1) * 25 && x < (b + 1) * 25 - 150)).length;
      mid = { n: m15.length, idleInsidePct: m15.length ? (100 * inside) / m15.length : null };
    }
    delete act.idleIntervals; delete cf.idleIntervals;
    const rec = { cond, id: r.id, sex: r.sex, order: ORDER, jitter: JITTER, phase: PHASE, cadence: CADENCE,
      noiseAloneMedDb: noiseMed, pauseFloorMedDb: med(pf), pauseQuietPct: pq.length ? (100 * pq.reduce((a, b) => a + b, 0)) / pq.length : null, pauseN: pf.length,
      voicedHopMedDb: med(vh), intenCmp, throttleCmp, act, cf, mid15: mid, sec: (Date.now() - t0) / 1000 };
    appendFileSync(OUT, JSON.stringify(rec) + "\n");
    console.log(`${cond} ${r.id} ${ORDER} j${JITTER} ph${PHASE}: noise ${noiseMed?.toFixed(2)} floor ${med(pf)?.toFixed(2)} quiet ${rec.pauseQuietPct?.toFixed(1)} | idle ${act.idlePct.toFixed(1)} thumb ${act.thumbPct.toFixed(1)} trail ${act.trailMean.toFixed(2)} clears ${act.clearsPerMin.toFixed(1)} streak ${act.streakPct.toFixed(1)} mid15 ${mid?.idleInsidePct?.toFixed(0)} | cf idle ${cf.idlePct.toFixed(1)} trail ${cf.trailMean.toFixed(1)} | inten ${intenCmp ? `${intenCmp.same}/${intenCmp.n} maxd ${intenCmp.maxd}` : "-"} thr ${throttleCmp ? `${throttleCmp.diff}/${throttleCmp.n}` : "-"}`);
  }
}
process.exit(0);
