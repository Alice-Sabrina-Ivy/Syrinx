// attr.mjs — real-noise false voicing, STAGE ATTRIBUTION dump (2026-10-05).
//
// Runs the production chain of a src tree (scripts/session-oracle/lib/
// chain.mjs: the REAL pitch worker incl. notch / ghost veto / above-range
// null / harmonic guard, the REAL DSP worker, the REAL main-thread display
// decision handleAnalysisResult) over real noise-only clips (or mixes), with
// observation-only taps on the detector (tap-boersma.mjs) and on the notch
// (lib/tap-notch.mjs), and dumps per-hop columns for attr.py:
//
//   detection columns, indexed by the chunk completing the analysis frame
//   (window centre = chunk end - 40 ms):
//     uv     unvoicedStrength          s0 / c0f  best voiced candidate strength / Hz
//     dec    tracker decode (0 = unvoiced; before veto / range / guard)
//     gk     harmonic-guard verdict on the decoded frame (-1 = not called)
//     hc     harmonicStructureCount of that call (-1 = not called)
//     post   posted pitch (0 = null)    conf  posted confidence
//     nnotch active notches when posted
//   notch state, indexed by chunk (state after the chunk was processed):
//     npres  lines the tracker saw in its latest or previous observation
//     tf0..tf7 / ts0..ts7  the 8 strongest of them: Hz / status code
//            1 notched (in the cascade) 2 promoted but over capacity (not in
//            the cascade) 3 young (< minTrackSec) 4 onset-born, waiting for
//            onsetMinTrackSec 5 voice-timed, waiting 6 duty < promoteDuty
//            7 promotable (promotes on its next sighting)
//     tc0..tc7 their line verdict (noise-notch.js cohClass): 0 none yet,
//            1 machine, 2 voice, 3 undecided
//   display columns, indexed by display hop (lib/chain.mjs):
//     inten  DSP intensity (dB)   msg  pitch of the consumed message
//     paint  painted value        ro   readout    style  0 / 1 holding / 2 voiced
//   gender VAD (gender-worker.js maybeInfer replayed at its 150 ms cadence on
//   the same audio, pitch hints of earlier chunks), indexed by chunk:
//     gv     -1 no inference tick, 0 gated out, 1 scored (voiced pitch within
//            500 ms), 2 scored (sub-floor probe), 3 scored (stale feed, peak)
//
// Usage (repo root):
//   node --import ./scripts/realnoise-fv/lib/register.mjs scripts/realnoise-fv/attr.mjs \
//        [--set=noise|vin|gated|fda|ptdb|hil|voc] [--src=src] [--tag=head] [--shard=i/n] [--ids=a,b]
//        [--max-sec=90] [--data-root=<notchvd root>] [--out=build/realnoise-fv/attr]
//        [--split=tune|held] [--cf=noVeto,noGuard] [--notch-opts=<JSON>]
// --cf / --notch-opts are ATTRIBUTION COUNTERFACTUALS (switches in the taps):
// noVeto disables the ghost veto, noGuard makes the harmonic guard keep every
// frame, --notch-opts is merged over the notch's options (e.g.
// '{"maxNotches":99}', '{"minTrackSec":1e9,"onsetMinTrackSec":1e9}' = no notch).
// RN_TAP=0 runs untapped (pure production imports; notch / candidate columns
// stay 0) — the parity check compares post / paint / gv between the two.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dataRoot, noiseSet, publicMixes, splitOf } from "./lib/sets.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
dataRoot(args);
const { loadIndex, readClip } = await import("../notch-adversarial/realdata/realdata.mjs");
const { loadSrc, buildFrames, driveHook } = await import("../session-oracle/lib/chain.mjs");

const SRC = args.src ?? "src", TAG = args.tag ?? "head", SET = args.set ?? "noise";
const MAXS = Number(args["max-sec"] ?? 90);
const SR = 16000;
if (args.cf) globalThis.__RN_CF = Object.fromEntries(args.cf.split(",").map((k) => [k, true]));
if (args["notch-opts"]) globalThis.__RN_NOTCH_OPTS = JSON.parse(args["notch-opts"]);
const S = await loadSrc(SRC);
const AU = await import(pathToFileURL(resolve(SRC, "ml/audio-utils.js")).href);
const BAC = await import(pathToFileURL(resolve(SRC, "dsp/boersma-ac.js")).href);

export const COLS = ["uv", "s0", "c0f", "dec", "gk", "hc", "post", "conf", "nnotch", "npres",
  ...Array.from({ length: 8 }, (_, i) => `tf${i}`), ...Array.from({ length: 8 }, (_, i) => `ts${i}`),
  ...Array.from({ length: 8 }, (_, i) => `tc${i}`),
  "inten", "msg", "paint", "ro", "style", "gv", "refw", "refd"];

function trackStatus(t, inCascade, span, duty, c, minObs, onsetMinObs) {
  if (inCascade) return 1;
  if (t.active) return 2;
  if (span < minObs) return 3;
  if (t.onsetBorn && span < onsetMinObs) return t.voiceBorn ? 5 : 4;
  if (duty < c.promoteDuty) return 6;
  return 7;
}

function runX(samples, sr = SR) {
  const C = Math.round(sr * 0.025);
  const n = Math.floor(samples.length / C);
  const col = Object.fromEntries(COLS.map((c) => [c, new Float32Array(n)]));
  col.gk.fill(-1); col.hc.fill(-1); col.inten.fill(NaN); col.gv.fill(-1);
  const msgPitch = new Float32Array(n).fill(NaN), msgConf = new Float32Array(n).fill(NaN);
  const msgNotch = new Array(n).fill(null);
  const frameChunk = []; let L = null; let curK = -1; let lastDec = -1; let notch = null;
  globalThis.__RN_TAP = { notch(inst) { notch = inst; } };
  globalThis.__SO_TAP = {
    tracker(t) { L = t.config.lookback; },
    cand(fc) {
      const v = fc.voiced;
      col.uv[curK] = fc.unvoicedStrength;
      col.s0[curK] = v.length ? v[0].strength : 0;
      col.c0f[curK] = v.length ? v[0].freq : 0;
      frameChunk.push(curK);
    },
    emit(d) {
      const fi = frameChunk.length - 1; lastDec = -1;
      if (L !== null && fi >= L) { lastDec = frameChunk[fi - L]; col.dec[lastDec] = d > 0 ? d : 0; }
    },
    guard(keep, f0, buf) {
      if (lastDec < 0) return;
      col.gk[lastDec] = keep ? 1 : 0;
      col.hc[lastDec] = BAC.harmonicStructureCount(buf, f0, 16000); // the worker's 16 kHz analysis buffer
    },
  };
  const { P, D } = S;
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  if (L === null) L = S.defaultLookback;
  globalThis.self = D; D.posts = [];
  D.onmessage({ data: { type: "init", sampleRate: sr } });
  const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
  for (let k = 0; k < n; k++) {
    const ct = (k + 1) * C / sr;
    globalThis.self = P; curK = k; P.posts.length = 0;
    pp.onmessage({ data: { buffer: Float32Array.from(samples.subarray(k * C, (k + 1) * C)).buffer, contextTime: ct } });
    for (const m of P.posts) {
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
      if (m.type !== "pitch") continue;
      const kk = Math.round(m.contextTime * sr / C) - 1;
      col.post[kk] = m.pitch !== null ? m.pitch : 0; col.conf[kk] = m.confidence;
      col.nnotch[kk] = m.notchedFreqs ? m.notchedFreqs.length : 0;
      msgPitch[k] = m.pitch !== null ? m.pitch : 0; msgConf[k] = m.confidence;
      msgNotch[k] = m.notchedFreqs ?? [];
    }
    if (notch && notch.__obs) {
      const o = notch.__obs(), c = o.cfg;
      const ops = 10; // observations per second at 25 ms chunks (observeEveryChunks 4)
      const minObs = Math.ceil(c.minTrackSec * ops), onsetMinObs = Math.ceil(c.onsetMinTrackSec * ops);
      const inC = new Set(o.cascade.map((x) => x.id));
      const pres = o.tracks.filter((t) => o.obsIndex - t.lastSeenObs <= 1).sort((a, b) => b.power - a.power);
      col.npres[k] = pres.length;
      pres.slice(0, 8).forEach((t, i) => {
        const span = o.obsIndex - t.firstObs + 1;
        col[`tf${i}`][k] = t.freq;
        col[`ts${i}`][k] = trackStatus(t, inC.has(t.id), span, t.hits / span, c, minObs, onsetMinObs);
        // line verdict: 0 none (< cohMinWin windows / not measured), 1 machine, 2 voice, 3 undecided
        if (o.cohClass && t.coh && t.coh.wins.length >= c.cohMinWin) {
          const v = o.cohClass(t);
          col[`tc${i}`][k] = v === "machine" ? 1 : v === "voice" ? 2 : 3;
        }
      });
    }
    globalThis.self = D; D.posts.length = 0;
    dp.onmessage({ data: { buffer: Float32Array.from(samples.subarray(k * C, (k + 1) * C)).buffer, contextTime: ct } });
    for (const m of D.posts) if (m.type === "analysis") col.inten[k] = m.data.intensity;
  }
  globalThis.__SO_TAP = null; globalThis.__RN_TAP = null;
  // gender VAD replay: 0.75 s window, inference attempted every 150 ms once
  // the ring is full; hints = pitch messages of chunks < k (relay latency)
  const WIN = Math.floor(SR * 0.75), HOP = 6;
  let lastHint = -1, lastVoiced = -1, lastNotch = [], lastTick = -1e9;
  for (let k = 0; k < n && sr === 16000; k++) { // gender replay on 16 kHz streams only
    if (k > 0 && !Number.isNaN(msgPitch[k - 1])) { lastHint = k - 1; lastNotch = msgNotch[k - 1]; if (msgPitch[k - 1] > 0) lastVoiced = k - 1; }
    if ((k + 1) * C < WIN || k - lastTick < HOP) continue;
    lastTick = k;
    const w = samples.subarray((k + 1) * C - WIN, (k + 1) * C);
    const peak = AU.windowPeak(w);
    const stale = lastHint < 0 || (k - lastHint) * 25 > AU.PITCH_HINT_STALE_MS;
    const voiced = !stale && lastVoiced >= 0 && (k - lastVoiced) * 25 <= AU.VOICED_RECENCY_MS;
    let g;
    if (peak < AU.VAD_SILENCE_FLOOR) g = 0;
    else if (stale) g = peak < AU.VAD_PEAK_THRESHOLD ? 0 : 3;
    else if (voiced) g = 1;
    else g = AU.subFloorVoiced(w, SR, lastNotch) ? 2 : 0;
    col.gv[k] = g;
  }
  return { n, C, sr, L, col, msgPitch, msgConf };
}

const CORPORA = { fda: ["loadFda", 0], ptdb: ["loadPtdbTug", 20], hil: ["loadHillenbrand", 0], voc: ["loadVocadito", 0] };
let items;
if (CORPORA[SET]) {
  // ground-truth corpora (tests/dsp/data/corpora.js; SYRINX_CORPORA_DIR selects
  // another checkout's data). refw / refd = reference F0 at the worker /
  // display alignment of corpus.mjs (PTDB-TUG reference offset +20 ms).
  const loaders = await import("../../tests/dsp/data/corpora.js");
  const [fn, off] = CORPORA[SET];
  items = loaders[fn]().map((t) => ({ id: t.trackId, track: t, off, meta: { corpus: SET, gender: t.gender === "w" ? "f" : t.gender } }));
} else if (SET === "noise") items = noiseSet(loadIndex).map((r) => ({ id: r.id, rec: r, meta: { label: r.label, source: r.source, cls: r.class, flags: r.flags ?? [], split: splitOf(r.id) } }));
else {
  const set = { vin: "voice_in_noise", gated: "noise_gated" }[SET];
  items = publicMixes(loadIndex, set).map((r) => ({ id: r.id, rec: r, meta: { noise_id: r.noise_id, noise_label: r.noise_label, snr_db: r.snr_db, voice_kind: r.voice_kind, voice_t0: r.voice_t0, voice_t1: r.voice_t1, on_s: r.on_s, split: splitOf(r.noise_id) } }));
}
if (args.ids) { const s = new Set(args.ids.split(",")); items = items.filter((x) => s.has(x.id)); }
if (args.split) items = items.filter((x) => x.meta.split === args.split);
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
items = items.filter((_, i) => i % shN === shI);
const OUT = resolve(args.out ?? "build/realnoise-fv/attr", TAG, SET);
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
for (const it of items) {
  let x, sr = SR;
  if (it.track) { x = it.track.samples; sr = it.track.sampleRate; }
  else x = readClip(it.rec.path);
  if (SET === "noise" && MAXS > 0 && x.length > MAXS * SR) x = x.subarray(0, MAXS * SR);
  const W = runX(x, sr);
  if (it.track) {
    const { f0, hopMs } = it.track.ref, hop = W.C / W.sr;
    const refAt = (tSec) => { const i = Math.round((tSec * 1000 - it.off) / hopMs); return i >= 0 && i < f0.length ? f0[i] : 0; };
    for (let k = 0; k < W.n; k++) { W.col.refw[k] = refAt((k + 1) * hop - 0.040); W.col.refd[k] = refAt((k + 1) * hop - 0.040 - W.L * hop - 0.030); }
  }
  const Dc = await driveHook(S.hookPath, buildFrames(W), W.n);
  for (const c of ["msg", "paint", "ro", "style"]) W.col[c].set(Dc[c]);
  const tbl = new Float32Array(W.n * COLS.length);
  COLS.forEach((c, i) => tbl.set(W.col[c], i * W.n));
  writeFileSync(resolve(OUT, `${it.id}.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(OUT, `${it.id}.json`), JSON.stringify({ id: it.id, n: W.n, hopS: W.C / W.sr, C: W.C, sr: W.sr, L: W.L, cols: COLS, ...it.meta, src: SRC, cf: args.cf ?? null, notchOpts: args["notch-opts"] ?? null }));
}
console.log(`${TAG} ${SET} ${shI}/${shN}: ${items.length} items ${(Date.now() - t0) / 1000}s`);
