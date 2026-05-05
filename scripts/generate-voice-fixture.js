// generate-voice-fixture.js — synthesize a voice-like WAV for the
// desktop harness's --voice-file flag (Chrome's
// --use-file-for-fake-audio-capture). 10 s of F0 ≈ 200 Hz with the
// first four harmonics, 5 Hz vibrato of ±3 Hz depth, soft 10 ms ramps
// at start/end. 16 kHz mono 16-bit PCM — Chrome's fake-audio path is
// most reliable at 16 kHz. Loops indefinitely while Chrome's fake mic
// is active, so any harness duration sees continuous voice-like audio.
//
// pYIN should detect F0 ≈ 200 Hz on this signal, ± vibrato depth.
// Used as the ground-truth reference for MSTP-vs-AudioContext capture
// path comparison in the desktop harness.
//
// Usage:  node scripts/generate-voice-fixture.js
// Output: tests/audio/fixtures/voice-200hz-10s.wav

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SR = 16000;
const SECONDS = 10;
const F0 = 200;
const VIBRATO_HZ = 5;
const VIBRATO_DEPTH_HZ = 3;
const HARMONIC_AMPS = [0.5, 0.3, 0.2, 0.15];

const N = SR * SECONDS;
const samples = new Int16Array(N);
let phase = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fInst = F0 + VIBRATO_DEPTH_HZ * Math.sin(2 * Math.PI * VIBRATO_HZ * t);
  phase += (2 * Math.PI * fInst) / SR;

  let s = 0;
  for (let h = 0; h < HARMONIC_AMPS.length; h++) {
    s += HARMONIC_AMPS[h] * Math.sin((h + 1) * phase);
  }

  // 10 ms cosine ramp at edges to avoid clicks
  const rampN = Math.floor(SR * 0.01);
  let env = 1;
  if (i < rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampN);
  else if (i > N - rampN) env = 0.5 - 0.5 * Math.cos((Math.PI * (N - i)) / rampN);

  // 0.3 amplitude target → comfortable speech level, headroom against clipping
  const v = s * env * 0.3 * 32767;
  samples[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
}

// WAV header + data
const dataSize = N * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);    // PCM chunk size
buf.writeUInt16LE(1, 20);     // PCM format
buf.writeUInt16LE(1, 22);     // mono
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2, 28);// byte rate
buf.writeUInt16LE(2, 32);     // block align
buf.writeUInt16LE(16, 34);    // bits per sample
buf.write("data", 36);
buf.writeUInt32LE(dataSize, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(samples[i], 44 + i * 2);

const outDir = join(REPO_ROOT, "tests", "audio", "fixtures");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "voice-200hz-10s.wav");
writeFileSync(outPath, buf);
console.log(`generated: ${outPath} (${(buf.length / 1024).toFixed(1)} KB, F0=${F0} Hz, ${SECONDS} s @ ${SR} Hz mono 16-bit)`);
