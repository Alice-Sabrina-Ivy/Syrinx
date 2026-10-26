// faster-streams.mjs — WORLD-rendered resonance variants for the resonance
// responsiveness study (measurements/resonance-faster-2026-10-26.md), as
// switch-streams.mjs (the app's Voice Shaper engine, posted pitch track of
// the real pitch chain at 16 kHz), with the variants given on the command line.
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/faster-streams.mjs \
//        --tag=dev --variants=N:0:0,U05:0:6,... [--only=<reader ids>] [--out=build/resonance-faster]
//
// Input: <out>/src-<tag>.json (faster-prep.py). Per reader and variant
// name:st:pct the whole 54 s clip re-rendered at st semitones / pct % formant
// scale, upsampled to 48 kHz (resampleClip) -> <out>/v/<reader>__<name>.f32;
// the reader's own 150 s stream upsampled the same way -> <out>/v/<reader>__L.f32.
// Writes <out>/readers-<tag>.json (variants merged with any earlier run).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PreviewEngine, resampleClip } from "../../src/voice-preview/engine/preview.js";
import { loadWorld } from "../../tests/voice-preview/vp-test-lib.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = path.resolve(repo, arg("out", "build/resonance-faster"));
const tag = arg("tag", "dev");
const VARIANTS = Object.fromEntries(arg("variants", "N:0:0").split(",").map((s) => { const [n, st, pct] = s.split(":"); return [n, [Number(st), Number(pct)]]; }));
const only = new Set(arg("only", "").split(",").filter(Boolean));

const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/chain.mjs")).href);
const S = await loadSrc(path.join(repo, "src"));
const world = await loadWorld("simd");
let readers = JSON.parse(readFileSync(path.join(OUT, `src-${tag}.json`), "utf8"));
if (only.size) readers = readers.filter((r) => only.has(r.id));
mkdirSync(path.join(OUT, "v"), { recursive: true });
const write = (f, x) => writeFileSync(f, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const lf = path.join(OUT, `readers-${tag}.json`);
const prev = existsSync(lf) ? JSON.parse(readFileSync(lf, "utf8")) : { variants: {}, readers: [] };
const f = (r, v) => path.join(OUT, "v", `${r.id}__${v}.f32`);
for (const r of readers) {
  const t0 = Date.now();
  if (!existsSync(f(r, "L"))) write(f(r, "L"), resampleClip(readF32(r.long), 16000, 48000));
  const todo = Object.entries(VARIANTS).filter(([v]) => !existsSync(f(r, v)));
  if (todo.length) {
    const x16 = readF32(r.src);
    const W = runWorkers(S, x16, 16000, { chunkMs: 25 });
    const eng = new PreviewEngine(world);
    eng.analyse(x16, 16000, Float32Array.from(W.col.post));
    for (const [v, [st, pct]] of todo) write(f(r, v), resampleClip(eng.render(st, pct).pcm, 16000, 48000));
    eng.free();
  }
  console.log(`${r.id} (${r.sex}) ${todo.length} variants, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const variants = { ...prev.variants, ...VARIANTS };
const all = JSON.parse(readFileSync(path.join(OUT, `src-${tag}.json`), "utf8"));
writeFileSync(lf, JSON.stringify({ variants, readers: all.map((r) => ({ ...r, variants: Object.fromEntries(["L", ...Object.keys(variants)].filter((v) => existsSync(f(r, v))).map((v) => [v, f(r, v)])) })) }, null, 1));
console.log(`-> ${lf}`);
