// corpus.mjs — ground-truth corpora through the SAME production chain as the
// session oracle (lib/chain.mjs: REAL pitch worker incl. its streaming
// resampler, REAL DSP worker at the native rate, REAL handleAnalysisResult),
// one fresh worker/hook instance per file, scored at worker level (dec =
// tracker decode, post = posted) AND displayed level (paint, ro).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/corpus.mjs \
//        --corpus=fda|ptdb|hil|voc [--src=src] [--tag=head] [--shard=i/n]
//        [--out=build/session-oracle/corpus] [--voice-gate]
//   node scripts/session-oracle/corpus.mjs --report=BASE_TAG,TAG[,...] [--out=...]
//
// --voice-gate (2026-10-21, lib/voice-gate.mjs): the pitch worker runs the
// real FireRedVAD model; one worker run per file, the hook driven with the
// detector's decisions (gate on -> <tag>) and without (gate off ->
// <tag>-gateoff). Also <out>/<tag>.voice-gate/<corpus>.<shard>.json:
// decision counts, late messages, mask violations (a gate-on painted value
// that differs from gate off; must be 0) and false painting / readout on
// reference-unvoiced hops, gate on and off; --report prints them for every
// reported tag that has them. Needs the local model copy (node
// scripts/fetch-firered-model.mjs).
//
// Scoring (2026-10-03 corpus conventions, = ceiling/octave workstreams'
// corp-run.mjs / corpus.mjs): a worker-stage value describes the analysis
// window centre (chunk end - 40 ms); a display-stage value adds the L-hop
// decode delay and +30 ms (one median-3 frame). Reference index =
// round((t_ms - offset) / hopMs), PTDB-TUG offset +20 ms. Classes on
// q = value/truth: correct |q-1|<0.05; down2 |q-0.5|<=0.05; down3
// |q-1/3|<=0.0333; up2 |q-2|<=0.2; up3 |q-3|<=0.3 or |q-4|<=0.4; null; other.
// Groups: <corpus>_<m|f>; vocadito: voc (all tracks) and v34 (vocadito_34,
// the known 42 %-octave-down track, also inside voc).
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const OUT = resolve(args.out ?? "build/session-oracle/corpus");
const CATS = ["correct", "down2", "down3", "up2", "up3", "null", "other"];
const BANDS = [["75-125", 75, 125], ["125-160", 125, 160], ["160-200", 160, 200], ["200-300", 200, 300], ["300-400", 300, 400], [">=400", 400, 1e9], ["<160", 0, 160], ["all<400", 0, 400], ["all", 0, 1e9]];
const STAGES = ["dec", "post", "paint", "ro"];

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

if (args.report) {
  const tags = args.report.split(",");
  const agg = {};
  for (const t of tags) {
    agg[t] = {};
    const dir = resolve(OUT, t);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
      for (const [k, v] of Object.entries(j)) { const a = agg[t][k] ??= Object.fromEntries(["n", ...CATS].map((c) => [c, 0])); for (const c in v) a[c] += v[c]; }
    }
  }
  writeFileSync(resolve(OUT, `report.${tags.join("+")}.json`), JSON.stringify(agg, null, 1));
  const groups = [...new Set(Object.keys(agg[tags[0]]).map((k) => k.split("|")[1]))].sort();
  const p = (a, c) => (a && a.n ? (100 * a[c] / a.n) : NaN);
  const f = (x) => (Number.isFinite(x) ? x.toFixed(2).padStart(6) : "   -  ");
  for (const st of STAGES) for (const g of groups) for (const [b] of BANDS) {
    const k = `${st}|${g}|${b}`;
    if (!agg[tags[0]][k] || !agg[tags[0]][k].n) continue;
    console.log(`${st.padEnd(5)} ${g.padEnd(7)} ${b.padEnd(8)} n=${String(agg[tags[0]][k].n).padStart(6)} | ` + tags.map((t) => {
      const a = agg[t][k];
      return `${t}: cor ${f(p(a, "correct"))} dn ${f(p(a, "down2") + p(a, "down3"))} up2 ${f(p(a, "up2"))} up3 ${f(p(a, "up3"))} null ${f(p(a, "null"))}`;
    }).join(" | "));
  }
  // Identical counts in every category, stage, group and band?
  if (tags.length > 1) {
    const same = (a, b) => !!a && !!b && ["n", ...CATS].every((c) => a[c] === b[c]);
    const keys = new Set(tags.flatMap((t) => Object.keys(agg[t])));
    for (const t of tags.slice(1)) {
      const diff = [...keys].filter((k) => !same(agg[tags[0]][k], agg[t][k]));
      console.log(`\n${t} vs ${tags[0]}: ${diff.length ? `${diff.length} of ${keys.size} cells differ (${diff.slice(0, 6).join(", ")})` : `identical in all ${keys.size} cells (stage x group x band, every class count)`}`);
    }
  }
  // --voice-gate runs: decisions, mask check, false painting on
  // reference-unvoiced hops.
  for (const t of tags) {
    const dir = resolve(OUT, `${t}.voice-gate`);
    if (!existsSync(dir)) continue;
    const x = { files: 0, voice: 0, novoice: 0, none: 0, late: 0, maskBad: 0, uv: { on: {}, off: {} } };
    for (const fn of readdirSync(dir).filter((y) => y.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(resolve(dir, fn), "utf8"));
      for (const k of ["files", "voice", "novoice", "none", "late", "maskBad"]) x[k] += j[k];
      for (const arm of ["on", "off"]) for (const [g, v] of Object.entries(j.uv[arm])) {
        const a = x.uv[arm][g] ??= { n: 0, paint: 0, ro: 0 };
        a.n += v.n; a.paint += v.paint; a.ro += v.ro;
      }
    }
    console.log(`\n${t} (--voice-gate): ${x.files} files; detector decisions voice ${x.voice} / no voice ${x.novoice} / none ${x.none}; late ${x.late}; mask violations ${x.maskBad}`);
    console.log("false painting / readout on reference-unvoiced hops, gate off -> on:");
    for (const g of Object.keys(x.uv.off).sort()) {
      const a = x.uv.off[g], b = x.uv.on[g];
      console.log(`  ${g.padEnd(7)} n=${String(a.n).padStart(6)}  paint ${(100 * a.paint / a.n).toFixed(2)} -> ${(100 * b.paint / b.n).toFixed(2)} %   readout ${(100 * a.ro / a.n).toFixed(2)} -> ${(100 * b.ro / b.n).toFixed(2)} %`);
    }
  }
  process.exit(0);
}

const { loadSrc, runWorkers, buildFrames, driveHook } = await import("./lib/chain.mjs");
const VOICE_GATE = !!args["voice-gate"];
const VGL = VOICE_GATE ? await import("./lib/voice-gate.mjs") : null;
const { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } = await import("../../tests/dsp/data/corpora.js");
const SETS = { fda: [loadFda, 0], ptdb: [loadPtdbTug, 20], hil: [loadHillenbrand, 0], voc: [loadVocadito, 0] };
const corpus = args.corpus;
const [loader, off] = SETS[corpus];
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const S = await loadSrc(args.src ?? "src");
const VG = VOICE_GATE ? await VGL.loadVoiceGate(S) : null;
const TAG = args.tag ?? "head";
// One result per display arm: without --voice-gate just <tag>; with it
// <tag> (gate on) and <tag>-gateoff (the same worker run, no decisions).
const ARMS = VOICE_GATE ? [[TAG, true], [`${TAG}-gateoff`, false]] : [[TAG, null]];
const res = Object.fromEntries(ARMS.map(([t]) => [t, {}]));
const vg = { files: 0, voice: 0, novoice: 0, none: 0, late: 0, maskBad: 0, uv: { on: {}, off: {} } };
const add = (R, st, g, r, c) => {
  for (const [bn, lo, hi] of BANDS) {
    if (r < lo || r >= hi) continue;
    const a = R[`${st}|${g}|${bn}`] ??= Object.fromEntries(["n", ...CATS].map((x) => [x, 0]));
    a.n++; a[c]++;
  }
};
const t0 = Date.now();
let nt = 0;
const tracks = loader().filter((_, i) => i % shN === shI);
for (const tr of tracks) {
  nt++;
  const W = VOICE_GATE ? await VGL.runWorkersVad(S, VG, tr.samples, tr.sampleRate) : runWorkers(S, tr.samples, tr.sampleRate);
  const Ds = [];
  for (const [, gate] of ARMS) Ds.push(await driveHook(S.hookPath, gate === null ? buildFrames(W) : VGL.buildFramesVad(W, { gate }), W.n));
  if (VOICE_GATE) {
    vg.files++; vg.voice += W.stats.voice; vg.novoice += W.stats.novoice; vg.none += W.stats.none; vg.late += W.stats.late;
    vg.maskBad += VGL.maskCheck(Ds[0], Ds[1]).bad;
  }
  const hop = W.C / W.sr;
  const gs = corpus === "voc" ? (tr.trackId === "vocadito_34" ? ["voc", "v34"] : ["voc"]) : [`${corpus}_${tr.gender === "w" ? "f" : tr.gender}`];
  const refIdx = (tSec) => Math.round((tSec * 1000 - off) / tr.ref.hopMs);
  const refAt = (tSec) => { const i = refIdx(tSec); return i >= 0 && i < tr.ref.f0.length ? tr.ref.f0[i] : 0; };
  for (let k = 0; k < W.n; k++) {
    const rw = refAt((k + 1) * hop - 0.040);
    if (rw > 0) for (const g of gs) for (const [t] of ARMS) { add(res[t], "dec", g, rw, cls(W.col.dec[k], rw)); add(res[t], "post", g, rw, cls(W.col.post[k], rw)); }
    const td = (k + 1) * hop - 0.040 - W.L * hop - 0.030;
    const rd = refAt(td);
    if (rd > 0) {
      for (const g of gs) ARMS.forEach(([t], ai) => { add(res[t], "paint", g, rd, cls(Ds[ai].paint[k], rd)); add(res[t], "ro", g, rd, cls(Ds[ai].ro[k], rd)); });
    } else if (VOICE_GATE && refIdx(td) >= 0 && refIdx(td) < tr.ref.f0.length && !Number.isNaN(W.col.inten[k])) {
      // reference unvoiced: false painting / readout, gate on and off
      for (const g of gs) ARMS.forEach(([, gate], ai) => {
        const a = vg.uv[gate ? "on" : "off"][g] ??= { n: 0, paint: 0, ro: 0 };
        a.n++; if (Ds[ai].paint[k] > 0) a.paint++; if (Ds[ai].ro[k] > 0) a.ro++;
      });
    }
  }
}
for (const [t] of ARMS) {
  const dir = resolve(OUT, t);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${corpus}.${shI}of${shN}.json`), JSON.stringify(res[t]));
}
if (VOICE_GATE) {
  const dir = resolve(OUT, `${TAG}.voice-gate`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${corpus}.${shI}of${shN}.json`), JSON.stringify(vg));
}
const vgText = VOICE_GATE ? `; detector voice ${vg.voice} / no voice ${vg.novoice} / none ${vg.none}, late ${vg.late}, mask violations ${vg.maskBad}` : "";
console.log(`${corpus} ${shI}/${shN}: ${nt} tracks, ${(Date.now() - t0) / 1000}s${vgText} -> ${ARMS.map(([t]) => resolve(OUT, t)).join(", ")}`);
// --voice-gate: the detector's ONNX session keeps the event loop alive.
if (VOICE_GATE) process.exit(0);
