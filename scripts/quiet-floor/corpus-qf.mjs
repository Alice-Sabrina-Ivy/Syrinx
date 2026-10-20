// corpus-qf.mjs — quiet-floor safety data on the public corpora
// (measurements/pitch-quiet-floor-2026-10-20.md §3). Every file goes through
// the REAL chain (scripts/session-oracle/lib/chain.mjs: real pitch worker,
// real DSP worker, real useAudioPipeline handleAnalysisResult; 25 ms hops),
// one fresh worker / hook instance per file, after one gain that puts the
// file's voiced level (mean power of its samples inside reference-voiced
// frames, dB re full scale = the DSP worker's intensity scale) at the target.
// No noise is added.
//
// Gate-only candidates (gNN) change only the main thread, so their hook is
// driven over the BASELINE workers' output of the same file and level (the
// workers are identical by construction); every G·F candidate (gfNN) runs its
// own workers. Candidate trees come from make-trees.mjs.
//
// Scoring (corpus.mjs conventions): a display value describes the reference
// at (k+1)·hop − 40 ms − L·hop − 30 ms, a worker value at (k+1)·hop − 40 ms;
// reference index = round((t_ms − offset) / hopMs) (PTDB +20 ms; LibriSpeech
// = its Praat AC frame times). Classes on q = value / ref as corpus.mjs.
// Counts per candidate × level × group, on reference-voiced display hops:
//   n, bp / cp (painted by baseline / candidate), lost (bp && !cp), gained,
//   bc / cc (painted & correct), bo / co (painted & octave: down2, down3,
//   up2, up3), roLost, recLost, onset / offset n and lost (first / last two
//   hops = 50 ms of every reference-voiced display run of >= 4 hops), lostEnd
//   (lost hops among the last six = 150 ms of every reference-voiced display
//   run; diagnostic added after the pre-registered result), and on
//   reference-voiced worker hops wn, bpost / cpost (posted voiced).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/corpus-qf.mjs \
//     --corpus=fda|ptdb|hil|voc|libri --split=dev|held [--levels=nat,-40,-45,-50,-55,-60]
//     [--cands=g60,g65,g70,g75,gf60,gf65,gf70,gf75] [--trees=build/trees] [--shard=i/n]
//     [--tag=dev] [--out=build/quiet-floor/corpus]
// Splits: FDA utterance number even = dev / odd = held; PTDB-TUG speaker 01 / 02;
// Hillenbrand speaker number odd / even; vocadito singer number odd / even;
// LibriSpeech dev-clean / test-clean (build/quiet-floor/libri from prep_libri.py).
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";
import { readWav } from "../session-oracle/lib/wav.mjs";
import { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } from "../../tests/dsp/data/corpora.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const CORPUS = args.corpus, SPLIT = args.split ?? "dev";
const LEVELS = (args.levels ?? "nat,-40,-45,-50,-55,-60").split(",");
const CANDS = (args.cands ?? "g60,g65,g70,g75,gf60,gf65,gf70,gf75").split(",").filter(Boolean);
const TREES = resolve(args.trees ?? "build/trees");
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const OUT = resolve(args.out ?? "build/quiet-floor/corpus", args.tag ?? SPLIT);
const PEAK_MAX = 0.99;

function cls(f, r) {
  if (!(f > 0)) return "null";
  const q = f / r;
  if (Math.abs(q - 1) < 0.05) return "correct";
  if (Math.abs(q - 0.5) <= 0.05) return "down2";
  if (Math.abs(q - 1 / 3) <= 0.0333) return "down3";
  if (Math.abs(q - 2) <= 0.2) return "up2";
  if (Math.abs(q - 3) <= 0.3 || Math.abs(q - 4) <= 0.4) return "up3";
  return "other";
}
const OCT = new Set(["down2", "down3", "up2", "up3"]);

// ---- tracks: { id, group, samples, sr, ref: {f0, hopMs}, off (ms), split } ----
function vocSinger() {
  const m = new Map();
  const csv = readFileSync(resolve("tests/dsp/data/vocadito/vocadito_metadata.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  for (const line of csv) { const [tid, sid] = line.split(","); m.set(`vocadito_${tid}`, Number(sid.replace(/\D/g, ""))); }
  return m;
}
function loadTracks() {
  if (CORPUS === "fda") return loadFda().map((t) => ({ id: t.trackId, group: `fda_${t.gender}`, samples: t.samples, sr: t.sampleRate, ref: t.ref, off: 0,
    split: Number(t.trackId.replace(/\D/g, "")) % 2 === 0 ? "dev" : "held" }));
  if (CORPUS === "ptdb") return loadPtdbTug().map((t) => ({ id: t.trackId, group: `ptdb_${t.gender}`, samples: t.samples, sr: t.sampleRate, ref: t.ref, off: 20,
    split: /_[MF]01_/.test(t.trackId) ? "dev" : "held" }));
  if (CORPUS === "hil") return loadHillenbrand().map((t) => ({ id: t.trackId, group: `hil_${t.gender === "w" ? "f" : t.gender}`, samples: t.samples, sr: t.sampleRate, ref: t.ref, off: 0,
    split: Number(t.trackId.slice(1, 3)) % 2 === 1 ? "dev" : "held" }));
  if (CORPUS === "voc") {
    const sg = vocSinger();
    return loadVocadito().map((t) => ({ id: t.trackId, group: "voc", samples: t.samples, sr: t.sampleRate, ref: t.ref, off: 0,
      split: sg.get(t.trackId) % 2 === 1 ? "dev" : "held" }));
  }
  if (CORPUS === "libri") {
    const dir = resolve(args.libri ?? "build/quiet-floor/libri");
    const idx = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8"));
    return idx.map((it) => {
      const { samples, sr } = readWav(resolve(dir, it.wav));
      // copy out of the Buffer's own bytes: small files come from Node's shared
      // buffer pool, so `.buffer` is not just this file
      const rb = readFileSync(resolve(dir, it.ref));
      const f0 = new Float32Array(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.length));
      return { id: it.uid, group: `libri_${it.sex}`, samples, sr, ref: { f0, hopMs: it.refHopMs }, off: it.refT0Ms,
        split: it.split === "dev-clean" ? "dev" : "held" };
    });
  }
  throw new Error(`unknown corpus ${CORPUS}`);
}

function voicedLevelDb(tr) {
  let s = 0, n = 0;
  for (let i = 0; i < tr.samples.length; i++) {
    const j = Math.round((i * 1000 / tr.sr - tr.off) / tr.ref.hopMs);
    if (j >= 0 && j < tr.ref.f0.length && tr.ref.f0[j] > 0) { s += tr.samples[i] * tr.samples[i]; n++; }
  }
  return n > 0 && s > 0 ? 10 * Math.log10(s / n) : null;
}

const base = await loadSrc(resolve(TREES, "qf-base/src"));
const S = {};
for (const c of CANDS) S[c] = await loadSrc(resolve(TREES, `qf-${c}/src`));

const res = {};
const files = [];
const zero = () => ({ n: 0, bp: 0, cp: 0, lost: 0, gained: 0, bc: 0, cc: 0, bo: 0, co: 0, roLost: 0, recLost: 0,
  onN: 0, onLost: 0, offN: 0, offLost: 0, lostEnd: 0, wn: 0, bpost: 0, cpost: 0 });

function score(key, tr, W0, D0, W, D) {
  const a = res[key] ??= zero();
  const hop = W0.C / W0.sr;
  const refAt = (tSec) => { const i = Math.round((tSec * 1000 - tr.off) / tr.ref.hopMs); return i >= 0 && i < tr.ref.f0.length ? tr.ref.f0[i] : 0; };
  const rd = new Float32Array(W0.n);
  for (let k = 0; k < W0.n; k++) {
    rd[k] = refAt((k + 1) * hop - 0.040 - W0.L * hop - 0.030);
    const rw = refAt((k + 1) * hop - 0.040);
    if (rw > 0) { a.wn++; a.bpost += W0.col.post[k] > 0; a.cpost += W.col.post[k] > 0; }
    if (!(rd[k] > 0)) continue;
    const bp = D0.paint[k] > 0, cp = D.paint[k] > 0;
    a.n++; a.bp += bp; a.cp += cp; a.lost += bp && !cp; a.gained += !bp && cp;
    if (bp) { const c = cls(D0.paint[k], rd[k]); a.bc += c === "correct"; a.bo += OCT.has(c); }
    if (cp) { const c = cls(D.paint[k], rd[k]); a.cc += c === "correct"; a.co += OCT.has(c); }
    a.roLost += D0.ro[k] > 0 && !(D.ro[k] > 0);
    a.recLost += D0.rec[k] > 0 && !(D.rec[k] > 0);
  }
  // onsets / offsets: first / last two hops of reference-voiced display runs >= 4 hops
  for (let k = 0; k < W0.n;) {
    if (!(rd[k] > 0)) { k++; continue; }
    let e = k; while (e < W0.n && rd[e] > 0) e++;
    for (let j = Math.max(k, e - 6); j < e; j++) a.lostEnd += D0.paint[j] > 0 && !(D.paint[j] > 0);
    if (e - k >= 4) {
      for (const j of [k, k + 1]) { a.onN++; a.onLost += D0.paint[j] > 0 && !(D.paint[j] > 0); }
      for (const j of [e - 2, e - 1]) { a.offN++; a.offLost += D0.paint[j] > 0 && !(D.paint[j] > 0); }
    }
    k = e;
  }
}

const t0 = Date.now();
const tracks = loadTracks().filter((t) => t.split === SPLIT).filter((_, i) => i % shN === shI);
for (const tr of tracks) {
  const vl = voicedLevelDb(tr);
  let peak = 0; for (const x of tr.samples) peak = Math.max(peak, Math.abs(x));
  const info = { id: tr.id, group: tr.group, voicedDb: vl, peak, skipped: [] };
  files.push(info);
  if (vl === null) { info.skipped.push("no-voiced-ref"); continue; }
  for (const lv of LEVELS) {
    const gain = lv === "nat" ? 1 : 10 ** ((Number(lv) - vl) / 20);
    if (lv !== "nat" && peak * gain > PEAK_MAX) { info.skipped.push(lv); continue; }
    const x = gain === 1 ? tr.samples : Float32Array.from(tr.samples, (v) => v * gain);
    const W0 = runWorkers(base, x, tr.sr);
    const F0 = buildFrames(W0);
    const D0 = await driveHook(base.hookPath, F0, W0.n);
    score(`base|${lv}|${tr.group}`, tr, W0, D0, W0, D0);
    for (const c of CANDS) {
      let W = W0, D;
      if (c.startsWith("gf")) { W = runWorkers(S[c], x, tr.sr); D = await driveHook(S[c].hookPath, buildFrames(W), W.n); }
      else D = await driveHook(S[c].hookPath, F0, W0.n);
      score(`${c}|${lv}|${tr.group}`, tr, W0, D0, W, D);
    }
  }
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, `${CORPUS}.${shI}of${shN}.json`), JSON.stringify({ corpus: CORPUS, split: SPLIT, levels: LEVELS, cands: CANDS, res, files }));
console.log(`${CORPUS} ${SPLIT} ${shI}/${shN}: ${tracks.length} files, ${(Date.now() - t0) / 1000}s -> ${OUT}`);
