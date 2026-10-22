// switch-streams.mjs — the resonance switch-asymmetry stimuli
// (measurements/resonance-switch-asymmetry-2026-10-21.md).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/switch-streams.mjs \
//        --split=dev [--n=3] [--out=build/resonance-switch]
//
// Inputs: build/resonance-switch/src.json (switch-prep.py: 54 s of one
// LibriSpeech reader, 16 kHz). Per reader (the first n men and n women of
// the split, by speaker id):
//   (a) the SAME speech re-rendered by the Voice Shaper's WORLD engine
//       (src/voice-preview/engine/preview.js, the app's engine; posted pitch
//       track from the real pitch chain at 16 kHz, as the app's recorder
//       gives it), four variants of the whole 54 s:
//         Dk  dark,   pitch kept:   0 st, formants -8 %
//         Bk  bright, pitch kept:   0 st, formants +9 %
//         Dm  dark,   pitch moves: -3 st, formants -8 %
//         Bm  bright, pitch moves: +3 st, formants +9 %
//   (b) the reader's own recording (no resynthesis), "O".
// Each variant is upsampled to 48 kHz (the engine's resampleClip) and
// written as float32 (<out>/v/<reader>__<variant>.f32). The run script
// splices streams from them at 18 s / 36 s.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PreviewEngine, resampleClip } from "../../src/voice-preview/engine/preview.js";
import { loadWorld } from "../../tests/voice-preview/vp-test-lib.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = path.resolve(repo, arg("out", "build/resonance-switch"));
const split = arg("split", "dev");
const nPer = Number(arg("n", "3"));
export const VARIANTS = { Dk: [0, -8], Bk: [0, 9], Dm: [-3, -8], Bm: [3, 9] };

const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/chain.mjs")).href);
const S = await loadSrc(path.join(repo, "src"));
const world = await loadWorld("simd");
const src = JSON.parse(readFileSync(path.join(OUT, "src.json"), "utf8")).filter((r) => r.split === split);
const pick = (sex) => src.filter((r) => r.sex === sex).sort((a, b) => a.speaker.localeCompare(b.speaker)).slice(0, nPer);
const readers = [...pick("m"), ...pick("f")];
mkdirSync(path.join(OUT, "v"), { recursive: true });
const write = (f, x) => writeFileSync(f, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
const list = [];
for (const r of readers) {
  const b = readFileSync(r.path);
  const x16 = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
  const t0 = Date.now();
  const f = (v) => path.join(OUT, "v", `${r.id}__${v}.f32`);
  if (!existsSync(f("O"))) write(f("O"), resampleClip(x16, 16000, 48000));
  if (!Object.keys(VARIANTS).every((v) => existsSync(f(v)))) {
    const W = runWorkers(S, x16, 16000, { chunkMs: 25 });
    const track = Float32Array.from(W.col.post);
    const eng = new PreviewEngine(world);
    eng.analyse(x16, 16000, track);
    for (const [v, [st, pct]] of Object.entries(VARIANTS)) {
      const { pcm } = eng.render(st, pct);
      write(f(v), resampleClip(pcm, 16000, 48000));
    }
    eng.free();
  }
  list.push({ ...r, variants: ["O", ...Object.keys(VARIANTS)].map((v) => ({ v, path: f(v) })) });
  console.log(`${r.id} (${r.sex}) ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const lf = path.join(OUT, `readers-${split}.json`);
writeFileSync(lf, JSON.stringify({ variants: VARIANTS, readers: list }, null, 1));
console.log(`${list.length} readers -> ${lf}`);
