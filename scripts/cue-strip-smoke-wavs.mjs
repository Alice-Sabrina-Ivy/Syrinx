// cue-strip-smoke-wavs.mjs — fake-mic WAVs for scripts/cue-strip-smoke.mjs,
// all public or synthetic, written to build/cue-strip-smoke/ (gitignored):
//   speech-woman.wav / speech-man.wav  one LibriSpeech test-clean reader each
//                     (CC BY 4.0), their utterances concatenated (>= 40 s),
//                     band-limited x3 to 48 kHz
//   held.wav          1 s silence + 6 s synthetic held vowel /a/ at 200 Hz
//   noise.wav         20 s synthetic pink noise (-30 dBFS rms)
//   silence.wav       20 s of digital silence
//   narrowband.wav    speech-woman.wav low-passed at 3.4 kHz (Blackman
//                     windowed sinc, 401 taps at 48 kHz, ~-74 dB above
//                     ~4.1 kHz): a phone-band stand-in for the resonance
//                     row's "Phone-quality audio" notice (2026-10-19). Made
//                     from speech-woman.wav whenever that exists (no --r1
//                     needed once it has been written).
//
//   pitch-only-man.wav / pitch-only-woman.wav  (with --pitch-only=<jobs_hcs.json>
//                     of scripts/heard-as/pitch-only/build_jobs.py) one Hillenbrand
//                     & Clark sentence-proxy session each: ~50 s of a LibriSpeech
//                     reader's natural speech, then ~40 s with the pitch moved
//                     and the resonance kept (man raised, woman lowered); the
//                     shift time goes to the matching .json — the pitch-only
//                     warning check of scripts/cue-strip-smoke.mjs --pitch-only
//   pitch-only-late-man.wav / pitch-only-late-woman.wav  (with
//                     --pitch-only-late=<jobs_test_hcsL.json> of the §8.8
//                     late-panel study's fresh pool) one hcsL session each:
//                     >= 170 s of a reader's natural speech, then the pitch
//                     moved with the resonance kept; default the first by key
//                     order that KS-Q5 hit at T120 in all four phases
//                     (hcsL_ls2654_PO, hcsL_ls1474_PO; measurement note §8.9
//                     (g)) — the late-switch-on check of cue-strip-smoke.mjs
//                     --pitch-only-late
//
//   node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs.json [{audio: float32 16 kHz file, speaker, sex}]>
//        [--woman=<speaker>] [--man=<speaker>] [--pitch-only=<jobs_hcs.json>]
//        [--pitch-only-late=<jobs_test_hcsL.json> [--late-man=<key>] [--late-woman=<key>]]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const OUT = path.join(repo, "build", "cue-strip-smoke");
mkdirSync(OUT, { recursive: true });
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);

function writeWav(file, x, sr = 48000) {
  const b = Buffer.alloc(44 + 2 * x.length);
  b.write("RIFF", 0); b.writeUInt32LE(36 + 2 * x.length, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(2 * sr, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(2 * x.length, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  writeFileSync(path.join(OUT, file), b);
  console.log(`${file}: ${(x.length / sr).toFixed(1)} s`);
}

const r1 = arg("r1", "");
if (r1) {
  const jobs = JSON.parse(readFileSync(r1, "utf8"));
  const pick = (sex, want) => {
    const spk = want || [...new Set(jobs.filter((j) => j.sex === sex).map((j) => j.speaker))][0];
    const parts = jobs.filter((j) => j.speaker === spk).map((j) => { const b = readFileSync(j.audio); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); });
    const gap = new Float32Array(16000 * 0.3);
    const n = parts.reduce((a, p) => a + p.length + gap.length, 0);
    const x = new Float32Array(n); let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length + gap.length; }
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    const y = Float32Array.from(upsample(x)).map((v) => (0.5 * v) / pk);
    return { spk, y };
  };
  const w = pick("f", arg("woman", "")), m = pick("m", arg("man", ""));
  writeWav("speech-woman.wav", w.y); console.log(`  (LibriSpeech test-clean reader ${w.spk})`);
  writeWav("speech-man.wav", m.y); console.log(`  (LibriSpeech test-clean reader ${m.spk})`);
}

// session.mjs / session_late.mjs layout: each file followed by a 0.25 s gap (or the phase's gapS)
function writePitchOnly(jobsPath, prefix, picks) {
  const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
  for (const [name, key] of picks) {
    const job = jobs.find((j) => j.key === key);
    if (!job) { console.error(`no job ${key} in ${jobsPath}`); continue; }
    const parts = []; let n = 0, shiftS = null;
    for (const ph of job.phases) {
      if (ph.phase === "shift") shiftS = n / 16000;
      for (const f of ph.files) {
        if (f.sr !== 16000) throw new Error(`${f.audio}: sr ${f.sr}`);
        const b = readFileSync(f.audio);
        const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
        parts.push(x, new Float32Array(Math.round((ph.gapS ?? 0.25) * 16000)));
        n += x.length + Math.round((ph.gapS ?? 0.25) * 16000);
      }
    }
    const x = new Float32Array(n); let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length; }
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    writeWav(`${prefix}-${name}.wav`, Float32Array.from(upsample(x)).map((v) => (0.5 * v) / pk));
    writeFileSync(path.join(OUT, `${prefix}-${name}.json`), JSON.stringify({ key, shiftS, durS: n / 16000 }));
    console.log(`  (${key}: shift at ${shiftS.toFixed(1)} s of ${(n / 16000).toFixed(1)} s)`);
  }
}
const pitchOnlyJobs = arg("pitch-only", "");
if (pitchOnlyJobs) writePitchOnly(pitchOnlyJobs, "pitch-only", [["man", arg("pitch-only-man", "hcs_908_PO")], ["woman", arg("pitch-only-woman", "hcs_4970_PO")]]);
const pitchOnlyLateJobs = arg("pitch-only-late", "");
if (pitchOnlyLateJobs) writePitchOnly(pitchOnlyLateJobs, "pitch-only-late", [["man", arg("late-man", "hcsL_ls2654_PO")], ["woman", arg("late-woman", "hcsL_ls1474_PO")]]);

const SR = 48000;
{
  const n = SR * 7, src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += 200 / SR; if (ph >= 1) ph -= 1;
    const env = t < 1 ? 0 : Math.min(1, (t - 1) / 0.03, (7 - t) / 0.03);
    src[i] = env * ((ph < 0.6 ? Math.sin((Math.PI * ph) / 0.6) ** 2 : 0) - 0.3);
  }
  let y = src;
  for (const [f, bw] of [[730, 90], [1090, 110], [2440, 160]]) {
    const r = Math.exp((-Math.PI * bw) / SR), th = (2 * Math.PI * f) / SR, a1 = 2 * r * Math.cos(th), a2 = -r * r;
    const o = new Float32Array(n); let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const v = y[i] + a1 * y1 + a2 * y2; o[i] = v; y2 = y1; y1 = v; }
    y = o;
  }
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  writeWav("held.wav", y.map((v) => (0.4 * v) / pk));
}
{
  // Paul Kellet's pink-noise filter on a deterministic white source
  const n = SR * 20, y = new Float32Array(n);
  let s = 12345, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const w = s / 2147483648 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
  let e = 0; for (const v of y) e += v * v;
  const g = 0.0316 / Math.sqrt(e / n);
  writeWav("noise.wav", y.map((v) => v * g));
}
writeWav("silence.wav", new Float32Array(SR * 20));
if (existsSync(path.join(OUT, "speech-woman.wav"))) {
  const b = readFileSync(path.join(OUT, "speech-woman.wav"));
  let off = 12, sr = 0, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === "fmt ") sr = b.readUInt32LE(off + 12);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  const half = 200, fc = 3400 / sr, taps = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let t = -half; t <= half; t++) {
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    taps[t + half] = sinc * (0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half));
    sum += taps[t + half];
  }
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let a = 0;
    const lo = Math.max(-half, i - x.length + 1), hi = Math.min(half, i);
    for (let t = lo; t <= hi; t++) a += taps[t + half] * x[i - t];
    y[i] = a / sum;
  }
  writeWav("narrowband.wav", y, sr);
}
