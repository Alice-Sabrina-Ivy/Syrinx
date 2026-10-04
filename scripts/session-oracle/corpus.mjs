// corpus.mjs — ground-truth corpora through the SAME production chain as the
// session oracle (lib/chain.mjs: REAL pitch worker incl. its streaming
// resampler, REAL DSP worker at the native rate, REAL handleAnalysisResult),
// one fresh worker/hook instance per file, scored at worker level (dec =
// tracker decode, post = posted) AND displayed level (paint, ro).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/corpus.mjs \
//        --corpus=fda|ptdb|hil|voc [--src=src] [--tag=head] [--shard=i/n]
//        [--out=build/session-oracle/corpus]
//   node scripts/session-oracle/corpus.mjs --report=BASE_TAG,TAG[,...] [--out=...]
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
  process.exit(0);
}

const { loadSrc, runWorkers, buildFrames, driveHook } = await import("./lib/chain.mjs");
const { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } = await import("../../tests/dsp/data/corpora.js");
const SETS = { fda: [loadFda, 0], ptdb: [loadPtdbTug, 20], hil: [loadHillenbrand, 0], voc: [loadVocadito, 0] };
const corpus = args.corpus;
const [loader, off] = SETS[corpus];
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const S = await loadSrc(args.src ?? "src");
const res = {};
const add = (st, g, r, c) => {
  for (const [bn, lo, hi] of BANDS) {
    if (r < lo || r >= hi) continue;
    const a = res[`${st}|${g}|${bn}`] ??= Object.fromEntries(["n", ...CATS].map((x) => [x, 0]));
    a.n++; a[c]++;
  }
};
const t0 = Date.now();
let nt = 0;
const tracks = loader().filter((_, i) => i % shN === shI);
for (const tr of tracks) {
  nt++;
  const W = runWorkers(S, tr.samples, tr.sampleRate);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const hop = W.C / W.sr;
  const gs = corpus === "voc" ? (tr.trackId === "vocadito_34" ? ["voc", "v34"] : ["voc"]) : [`${corpus}_${tr.gender === "w" ? "f" : tr.gender}`];
  const refAt = (tSec) => { const i = Math.round((tSec * 1000 - off) / tr.ref.hopMs); return i >= 0 && i < tr.ref.f0.length ? tr.ref.f0[i] : 0; };
  for (let k = 0; k < W.n; k++) {
    const rw = refAt((k + 1) * hop - 0.040);
    if (rw > 0) for (const g of gs) { add("dec", g, rw, cls(W.col.dec[k], rw)); add("post", g, rw, cls(W.col.post[k], rw)); }
    const rd = refAt((k + 1) * hop - 0.040 - W.L * hop - 0.030);
    if (rd > 0) for (const g of gs) { add("paint", g, rd, cls(D.paint[k], rd)); add("ro", g, rd, cls(D.ro[k], rd)); }
  }
}
const dir = resolve(OUT, args.tag ?? "head");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, `${corpus}.${shI}of${shN}.json`), JSON.stringify(res));
console.log(`${corpus} ${shI}/${shN}: ${nt} tracks, ${(Date.now() - t0) / 1000}s -> ${dir}`);
