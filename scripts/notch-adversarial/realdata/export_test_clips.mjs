// export_test_clips.mjs — the few REAL clips tests/dsp/noise-notch-test.js
// commits (2026-10-05; licenses allow redistribution with attribution):
//   ac114.wav      — 10 s of MS-SNSD test/AirConditioner_10 (CC0; a 114.6 Hz
//                    compressor line, stationary-tonal; bc42ad0 notches it at
//                    5.4 s, 12.5 % of the noise-only clip painted as voice)
//   vs_f2_262.wav  — 3 VocalSet long tones of female2 at ~262 Hz (forte o,
//                    straight a, straight e), 3.5 s each (CC BY 4.0)
//   vs_m1_128.wav  — 3 VocalSet long tones of male1 at ~128 Hz (straight a /
//                    e / i), 2.75 s each (CC BY 4.0)
// 16 kHz mono PCM16, levels as in the corpus; the notes are stored back to
// back (the test cuts them by the offsets in tests/dsp/data/notch-real/README.md).
//   node scripts/notch-adversarial/realdata/export_test_clips.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { readClip } from "./realdata.mjs";
const OUT = "tests/dsp/data/notch-real";
mkdirSync(OUT, { recursive: true });
function pcm16(path, x) {
  const n = x.length, b = Buffer.alloc(44 + 2 * n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  writeFileSync(path, b);
  console.log(path, (n / 16000).toFixed(2), "s");
}
const cut = (rel, from, len) => readClip(rel).slice(Math.round(from * 16000), Math.round((from + len) * 16000));
pcm16(`${OUT}/ac114.wav`, cut("noise/mssnsd/mssnsd__test_AirConditioner_10.wav", 5, 10));
const cat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), y = new Float32Array(n); let o = 0; for (const p of parts) { y.set(p, o); o += p.length; } return y; };
pcm16(`${OUT}/vs_f2_262.wav`, cat([cut("voice/vocalset/vocalset__female2_forte_o.wav", 0.6, 3.5), cut("voice/vocalset/vocalset__female2_straight_a.wav", 0.776, 3.5), cut("voice/vocalset/vocalset__female2_straight_e.wav", 0.639, 3.5)]));
pcm16(`${OUT}/vs_m1_128.wav`, cat([cut("voice/vocalset/vocalset__male1_straight_a.wav", 0.229, 2.75), cut("voice/vocalset/vocalset__male1_straight_e.wav", 0.379, 2.75), cut("voice/vocalset/vocalset__male1_straight_i.wav", 0.429, 2.75)]));
