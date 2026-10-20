// wav-test.js — Voice Shaper's download format (src/voice-preview/wav.js): RIFF/WAVE
// header fields, 16-bit PCM mono, length, rounding and clipping, round trip.
// measurements/voice-preview-phase1-2026-10-19.md §13, §14 item 8.
//
//   node tests/voice-preview/wav-test.js
import { encodeWav, decodeWav16 } from "../../src/voice-preview/wav.js";
import { readWav16, makeChecker } from "./vp-test-lib.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const T = makeChecker();

console.log("header");
{
  const pcm = new Float32Array(48000 * 5);
  const buf = encodeWav(pcm, 48000);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  T.check("RIFF / WAVE / fmt / data tags", tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data");
  T.check("sizes: file = 44 + 2n, RIFF = file - 8, data = 2n", buf.byteLength === 44 + 2 * pcm.length && v.getUint32(4, true) === buf.byteLength - 8 && v.getUint32(40, true) === 2 * pcm.length);
  T.check("PCM, mono, 48000 Hz, 16 bit, byte rate 96000, block align 2",
    v.getUint32(16, true) === 16 && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 48000
    && v.getUint32(28, true) === 96000 && v.getUint16(32, true) === 2 && v.getUint16(34, true) === 16);
  const b441 = new DataView(encodeWav(new Float32Array(10), 44100));
  T.check("44.1 kHz rate field", b441.getUint32(24, true) === 44100 && b441.getUint32(28, true) === 88200);
}

console.log("\nrounding and clipping");
{
  const x = Float32Array.from([0, 1, -1, 1.5, -2, 0.5, -0.5, 1 / 32767, 0.4 / 32767, 0.6 / 32767, NaN, Infinity, -Infinity]);
  const v = new DataView(encodeWav(x, 16000));
  const s = Array.from({ length: x.length }, (_, i) => v.getInt16(44 + 2 * i, true));
  T.check("0, ±full scale -> 0, ±32767", s[0] === 0 && s[1] === 32767 && s[2] === -32767);
  T.check("clipped beyond ±1", s[3] === 32767 && s[4] === -32767);
  T.check("±0.5 -> ±16384 (halves away from zero: symmetric)", s[5] === 16384 && s[6] === -16384, `${s[5]}, ${s[6]}`);
  T.check("one LSB, below and above half an LSB", s[7] === 1 && s[8] === 0 && s[9] === 1);
  T.check("NaN -> 0, ±Infinity clipped", s[10] === 0 && s[11] === 32767 && s[12] === -32767);
}

console.log("\nround trip");
{
  const n = 7.5 * 44100;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin(2 * Math.PI * 220 * i / 44100) + 0.1 * Math.sin(2 * Math.PI * 3300 * i / 44100);
  const buf = encodeWav(x, 44100);
  const d = decodeWav16(buf);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(d.pcm[i] - x[i]));
  T.check("decode: rate, mono, 16 bit, length (the recording's duration)", d.sampleRate === 44100 && d.channels === 1 && d.bits === 16 && d.pcm.length === n);
  T.check("error <= half an LSB", maxErr <= 0.5 / 32767 + 1e-9, maxErr.toExponential(2));
  // an independent reader (the tests' WAV reader) agrees on the layout
  const dir = mkdtempSync(path.join(tmpdir(), "vp-wav-"));
  try {
    const p = path.join(dir, "t.wav");
    writeFileSync(p, Buffer.from(buf));
    const r = readWav16(p);
    T.check("an independent reader reads the same file", r.sr === 44100 && r.x.length === n && Math.abs(r.x[1000] - x[1000]) < 2e-4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  let threw = false;
  try { decodeWav16(new ArrayBuffer(44)); } catch { threw = true; }
  T.check("rejects a non-WAV buffer", threw);
}

T.done();
