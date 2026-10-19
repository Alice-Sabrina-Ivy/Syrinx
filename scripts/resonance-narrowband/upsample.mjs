// upsample.mjs (copied from scripts/resonance-robustness/ at 99ff7fc; output folder moved) — 16 kHz streams -> 48 kHz with the lab's band-limited upsampler
// (scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs `upsample`, the one
// the earlier cue harnesses use). Also writes the fan-hum noise source
// (scripts/noise-synth.js fanHum, 150 s at 16 kHz) through the same upsampler.
//   node scripts/resonance-narrowband/upsample.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const OUT = path.join(repo, "build", "resonance-narrowband");
const S16 = path.join(OUT, "streams16"), S48 = path.join(OUT, "streams48");
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
const { fanHum } = await import(pathToFileURL(path.join(repo, "scripts/noise-synth.js")).href);
mkdirSync(S48, { recursive: true });

const fan16 = path.join(S16, "_fan.f32");
if (!existsSync(fan16)) writeFileSync(fan16, Buffer.from(fanHum(150 * 16000).buffer));

let n = 0;
for (const f of readdirSync(S16).filter((f) => f.endsWith(".f32"))) {
  const out = path.join(S48, f);
  if (existsSync(out)) continue;
  const b = readFileSync(path.join(S16, f));
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  writeFileSync(out, Buffer.from(Float32Array.from(upsample(x)).buffer));
  n++;
}
console.log(`upsampled ${n} files`);
