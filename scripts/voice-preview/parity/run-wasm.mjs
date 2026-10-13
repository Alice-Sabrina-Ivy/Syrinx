// run-wasm.mjs — WebAssembly side of the parity check (§P3 of
// measurements/voice-preview-spike-2026-10-12.md). Writes the exact float64 inputs
// and outputs of every stage so pyworld_ref.py can run pyworld on identical inputs.
//
//   node scripts/voice-preview/parity/run-wasm.mjs --build=simd|nosimd [--level=1|2|all] [--hashes-only]
//        [--l1-rates=32000,44100,48000]
//
// Level 1 (each stage on identical inputs):
//   16 kHz     the 8 prototype clips (clips/proto16); StoneMask's initial F0 = the
//              prototype's stored F0 grid mapped to 5 ms frames (frontends.js gridToFrames)
//   22.05/24k  the 4 timing clips at 5 s, resampled from 48 kHz with the page's resampler
//              (preview-core.js resampleClip); initial F0 = the lab replica's grid on the
//              48 kHz clip (this branch), mapped the same way
//   DIO and Harvest run on the waveform; CheapTrick and D4C on the WebAssembly StoneMask
//   output; the warp on the WebAssembly envelope / aperiodicity; synthesis on the
//   WebAssembly-shifted F0 and warped matrices. 26 grid cells at 16 kHz; (0, 1.00),
//   (+2, 1.03), (-2, 0.97) at 22.05 / 24 kHz.
// Level 2 (end to end, 16 kHz, 8 clips x 26 cells): stored grid -> 5 ms frames ->
//   StoneMask -> CheapTrick -> D4C -> render (WorldSession), output before finish, plus
//   the finished render (float32) for the meters (Level 3).
// Output: VP_CACHE/parity/<build>/{l1,l2}/<case>/..., manifest.json (sha256 of every output).
// --hashes-only writes only the manifest (used for the second build: if every hash
// equals the first build's, the two builds are bit-identical on every parity output).
// --l1-rates (§ Addition 2026-10-12, A4): Level 1 on the 4 timing clips at 5 s at these rates
// only (the 16 kHz prototype clips are skipped), brought from 48 kHz with the page's resampler
// (at 48 kHz the clip itself); manifest-1-<rates>.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, loadLab, readF32, writeArr, sha256Arr, cells, cellName } from "../lib/node-io.mjs";
import { gridToFrames } from "../lib/frontends.js";
import { WorldSession, pitchFactor } from "../lib/world-engine.js";
import { resampleClip, labGridTrack } from "../lib/preview-core.js";
import { finish } from "../lib/psola.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const build = args.build || "simd";
const level = args.level || "all";
const l1Rates = args["l1-rates"] ? String(args["l1-rates"]).split(",").map(Number) : null;
const hashesOnly = !!args["hashes-only"];
const W = await loadWorldNode(build);
const OUT = path.join(P.parity, build);
const manifest = { build, files: {} };
const t00 = Date.now();

function save(dir, name, arr) {
  const key = `${path.relative(OUT, dir).split(path.sep).join("/")}/${name}`;
  manifest.files[key] = { sha256: sha256Arr(arr), n: arr.length };
  if (!hashesOnly) { mkdirSync(dir, { recursive: true }); writeArr(path.join(dir, name), arr); }
}

const proto = JSON.parse(readFileSync(path.join(P.clips, "proto16", "clips.json"), "utf8"));
const timing = JSON.parse(readFileSync(path.join(P.clips, "timing", "index.json"), "utf8")).clips;

function level1Case(dir, x, fs, init, cellList) {
  save(dir, "x.f64", x);
  const d = W.dio(x, fs);
  save(dir, "dio_f0.f64", d.f0); save(dir, "dio_t.f64", d.t);
  const h = W.harvest(x, fs);
  save(dir, "hv_f0.f64", h.f0); save(dir, "hv_t.f64", h.t);
  save(dir, "sm_in.f64", init.f0); save(dir, "sm_t.f64", init.t);
  const sm = W.stonemask(x, fs, init.t, init.f0);
  save(dir, "sm_out.f64", sm);
  const ct = W.cheaptrick(x, fs, init.t, sm);
  const ap = W.d4c(x, fs, init.t, sm);
  save(dir, "sp.f64", ct.sp); save(dir, "ap.f64", ap.ap);
  const nf = sm.length, fft = ct.fftSize;
  const warped = new Map([[1, { sp: ct.sp, ap: ap.ap }]]);
  for (const [, a] of cellList) {
    if (warped.has(a)) continue;
    const w = W.warp(ct.sp, ap.ap, nf, fft, fs, a);
    warped.set(a, w);
    save(dir, `warp_${a.toFixed(2)}_sp.f64`, w.sp); save(dir, `warp_${a.toFixed(2)}_ap.f64`, w.ap);
  }
  for (const [st, a] of cellList) {
    const k = pitchFactor(st);
    const f0 = sm.map((v) => v * k);
    const w = warped.get(a);
    const y = W.synthesize(f0, w.sp, w.ap, fft, fs, 5);
    save(dir, `f0_${cellName(st, a)}.f64`, f0); save(dir, `y_${cellName(st, a)}.f64`, y);
  }
  return { nf, fft, n: x.length };
}

const meta = { l1: {}, l2: {} };
if (level === "1" || level === "all") {
  if (!l1Rates) for (const c of proto) {
    const x = Float64Array.from(readF32(path.join(P.clips, "proto16", `${c.name}.f32`)));
    const grid = readF32(path.join(P.clips, "proto16", `${c.name}.protogrid.f32`));
    const init = gridToFrames(grid, x.length, 16000, 5);
    meta.l1[`16000/${c.name}`] = level1Case(path.join(OUT, "l1", "16000", c.name), x, 16000, init, cells(c.sex));
    console.log(`L1 16000 ${c.name} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
  }
  const lab = await loadLab();
  for (const r of l1Rates || [22050, 24000]) {
    for (const c of timing) {
      const pcm = readF32(path.join(P.clips, "timing", c.lengths["5"].pcm));
      const x = Float64Array.from(resampleClip(pcm, 48000, r));
      const grid = labGridTrack(lab, pcm, 48000);
      const init = gridToFrames(grid, x.length, r, 5);
      meta.l1[`${r}/${c.name}`] = level1Case(path.join(OUT, "l1", String(r), c.name), x, r, init, [[0, 1], [2, 1.03], [-2, 0.97]]);
      console.log(`L1 ${r} ${c.name} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
    }
  }
}

if (level === "2" || level === "all") {
  for (const c of proto) {
    const x32 = readF32(path.join(P.clips, "proto16", `${c.name}.f32`));
    const grid = readF32(path.join(P.clips, "proto16", `${c.name}.protogrid.f32`));
    const init = gridToFrames(grid, x32.length, 16000, 5);
    const s = new WorldSession(W, x32, 16000, { framePeriod: 5 });
    s.analyse("init", init);
    const dir = path.join(OUT, "l2", c.name);
    const rdir = path.join(P.parity, "renders", `wasm-${build}`, c.name);
    for (const [st, a] of cells(c.sex)) {
      const { y } = s.render(st, a);
      save(dir, `y_${cellName(st, a)}.f64`, y);
      const fin = finish(y, x32);
      manifest.files[`renders/${c.name}/${cellName(st, a)}.f32`] = { sha256: sha256Arr(fin), n: fin.length };
      if (!hashesOnly) { mkdirSync(rdir, { recursive: true }); writeArr(path.join(rdir, `${cellName(st, a)}.f32`), fin); }
    }
    s.free();
    meta.l2[c.name] = { n: x32.length };
    console.log(`L2 ${c.name} done (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
  }
}

manifest.meta = meta;
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `manifest-${level}${l1Rates ? `-${l1Rates.join("-")}` : ""}.json`), JSON.stringify(manifest, null, 1));
console.log(`${Object.keys(manifest.files).length} outputs, ${((Date.now() - t00) / 1000).toFixed(0)} s`);
