// voice-preview-smoke-wavs.mjs — fake-microphone WAVs for scripts/voice-preview-smoke.mjs,
// all public or synthetic, 48 kHz 16-bit mono, written to build/voice-preview-smoke/wavs/
// (gitignored). Chrome's fake capture loops each file.
//
//   clean.wav  two committed LibriSpeech test-clean excerpts (CC BY 4.0,
//              tests/resonance-lab/fixtures/ls_woman_high.wav and ls_man_hi8_f105.wav;
//              level margins 39.8 / 40.0 dB), each followed by 0.3 s of silence, ~10.6 s.
//              (ls_man_low is left out: its own recording's noise floor gets the noise
//              notice, measurements/voice-preview-phase1-2026-10-19.md Deviations 7.)
//   hum.wav    10 s of a synthetic fan hum alone (scripts/noise-synth.js fanHum, 120 Hz),
//              then the clean phrase with the hum 20 dB below the speech, ~20.6 s
//   noise.wav  the clean phrase with synthetic pink noise at +10 dB SNR, ~10.6 s
//   timing.wav (only when the Phase 0 spike's timing clips are in $VP_CACHE, local only) the
//              spike's four speech-dense 8 s clips at 48 kHz (PTDB-TUG, public;
//              $VP_CACHE/clips/timing-speech/{F01,F02,M01,M02}_8s.f32), each followed by
//              0.3 s of silence, ~33 s, not resampled — the desktop timing run
//              (voice-preview-smoke.mjs --parts=timing)
//
// Built at 16 kHz (the fixtures' rate and noise-synth's), then upsampled to 48 kHz with
// the voice preview's own resampleClip (the resonance lab's sinc resampler), peak 0.5.
//
//   node scripts/voice-preview-smoke-wavs.mjs [--out=<dir>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fanHum, pink, mix, SR } from "./noise-synth.js";
import { resampleClip } from "../src/voice-preview/engine/preview.js";
import { readWav16 } from "../tests/voice-preview/vp-test-lib.js";
import { P } from "./voice-preview/lib/paths.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = arg("out", path.join(repo, "build", "voice-preview-smoke", "wavs"));
mkdirSync(OUT, { recursive: true });
const RATE = 48000;

function writeWav(file, x16, { resample = true } = {}) {
  const y = resample ? resampleClip(x16, SR, RATE) : x16;
  let pk = 0;
  for (const v of y) pk = Math.max(pk, Math.abs(v));
  const g = 0.5 / (pk || 1);
  const b = Buffer.alloc(44 + 2 * y.length);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * y.length, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(2 * RATE, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(2 * y.length, 40);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * g * 32767))), 44 + 2 * i);
  writeFileSync(path.join(OUT, file), b);
  console.log(`${file}: ${(y.length / RATE).toFixed(2)} s`);
}

const clip = (name) => {
  const { x, sr } = readWav16(path.join(repo, "tests/resonance-lab/fixtures", `${name}.wav`));
  if (sr !== SR) throw new Error(`${name}: ${sr} Hz`);
  return x;
};
const gap = new Float32Array(Math.round(0.3 * SR));
const parts = [clip("ls_woman_high"), gap, clip("ls_man_hi8_f105"), gap];
const clean = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
{ let o = 0; for (const p of parts) { clean.set(p, o); o += p.length; } }

writeWav("clean.wav", clean);
{
  const LEAD_S = 10;
  const { mixed } = mix(clean, fanHum(clean.length + LEAD_S * SR), 20, 0, LEAD_S);
  writeWav("hum.wav", mixed);
}
{
  const { mixed } = mix(clean, pink(clean.length), 10);
  writeWav("noise.wav", mixed);
}

{
  const dir = path.join(P.clips, "timing-speech");
  const names = ["F01", "F02", "M01", "M02"].map((c) => path.join(dir, `${c}_8s.f32`));
  if (names.every(existsSync)) {
    const g48 = new Float32Array(Math.round(0.3 * RATE));
    const xs = names.flatMap((f) => { const b = readFileSync(f); return [new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), g48]; });
    const y = new Float32Array(xs.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of xs) { y.set(p, o); o += p.length; }
    writeWav("timing.wav", y, { resample: false });
  } else {
    console.log("timing.wav: skipped (no $VP_CACHE/clips/timing-speech)");
  }
}
