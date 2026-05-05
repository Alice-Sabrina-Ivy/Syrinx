// generate-octave-step.js — 2 s pure sine at 200 Hz, then 2 s at 400 Hz.
// If the HMM permanently locks at 200 even after input becomes 400, the
// bug is reproduced. If it recovers (jumps to 400 within ~500 ms per the
// theoretical recovery rate), no bug at this stimulus.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SR = 16000;
const SECTIONS = [
  { dur: 2.0, freq: 200 },
  { dur: 2.0, freq: 400 },
];
const TOTAL_SEC = SECTIONS.reduce((a, s) => a + s.dur, 0);
const N_TOTAL = SR * TOTAL_SEC;
const samples = new Int16Array(N_TOTAL);
let phase = 0;
let i = 0;
for (const sec of SECTIONS) {
  const N = Math.round(sec.dur * SR);
  for (let k = 0; k < N; k++, i++) {
    phase += (2 * Math.PI * sec.freq) / SR;
    let s = Math.sin(phase);
    // Edge ramps within each section to avoid click artifacts.
    const rampN = Math.floor(SR * 0.005);
    let env = 1;
    if (k < rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * k) / rampN);
    else if (k > N - rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * (N - k)) / rampN);
    const v = s * env * 0.3 * 32767;
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
  }
}

const dataSize = N_TOTAL * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
for (let k = 0; k < N_TOTAL; k++) buf.writeInt16LE(samples[k], 44 + k * 2);

const outDir = join(REPO_ROOT, "tests", "audio", "fixtures");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "octave-step-200-then-400.wav");
writeFileSync(outPath, buf);
console.log(`generated: ${outPath}, ${TOTAL_SEC} s @ ${SR} Hz`);
console.log(`  0..2 s: 200 Hz pure sine`);
console.log(`  2..4 s: 400 Hz pure sine`);
