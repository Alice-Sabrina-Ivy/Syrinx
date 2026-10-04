// boersma-ac-test.js — Unit tests for the Boersma-AC detector + path
// tracker (src/dsp/boersma-ac.js), the production pitch backend since
// the 2026-06-09 cutover. Corpus-level accuracy is covered by the
// shootout harnesses (scripts/pitch-shootout-*); this file guards the
// frame-level basics and the weak-H1 case that motivated the cutover.
//
// Usage: node tests/dsp/boersma-ac-test.js

import {
  createBoersmaAC,
  createPathTracker,
  BOERSMA_FRAME_LENGTH_16K,
} from "../../src/dsp/boersma-ac.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 16000, N = BOERSMA_FRAME_LENGTH_16K;
const ac = createBoersmaAC(SR, N);

function tone(f, amps = [1]) {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 0; h < amps.length; h++) s += amps[h] * Math.sin(2 * Math.PI * f * (h + 1) * i / SR);
    b[i] = 0.3 * s;
  }
  return b;
}
const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;

console.log("detector — frame-local");
check("100 Hz pure tone", near(ac.detect(tone(100)).pitch, 100, 1));
check("300 Hz pure tone", near(ac.detect(tone(300)).pitch, 300, 2));
check("85 Hz low tone (low male / creaky speech)", near(ac.detect(tone(85)).pitch, 85, 1));
check("65 Hz tone below the 75 Hz search floor is not reported as 65",
  (() => { const r = ac.detect(tone(65)); return r.pitch === null || r.pitch >= 75; })());
check("450 Hz tone above the 400 Hz search ceiling is not reported as 450",
  (() => { const r = ac.detect(tone(450)); return r.pitch === null || r.pitch < 410; })());
// Top-of-range regression (2026-07-19): the candidate scan used to start
// at minLag+1, so the lag bin of maxPitchHz itself could never be a local
// max — any F0 above ~395 Hz had no fundamental candidate and decoded as
// a CONFIDENT octave-down (396→198, 400→200) via the 2x-period
// subharmonic peak. Harmonic-rich stimulus: the subharmonic trap needs
// harmonics to be attractive, same as real voices near the ceiling.
for (const f of [396, 398, 400]) {
  check(`${f} Hz harmonic tone at the range ceiling is not octave-down`,
    near(ac.detect(tone(f, [0.6, 0.3, 0.15])).pitch, f, 2.5));
}
// The cutover motivation: fundamental weaker than the 2nd harmonic
// (breathy/pressed phonation). SwiftF0 confidently reported 2×F0 here.
const weakH1 = tone(95, [0.35, 1.0, 0.4, 0.2]);
check("95 Hz with dominant H2 stays at 95 (weak-H1 case)", near(ac.detect(weakH1).pitch, 95, 1.5));
check("silence is unvoiced", ac.detect(new Float32Array(N)).pitch === null);
{
  const noise = new Float32Array(N);
  let seed = 42;
  for (let i = 0; i < N; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise[i] = (seed / 0x3fffffff - 1) * 0.05; }
  check("white noise is unvoiced", ac.detect(noise).pitch === null);
}

console.log("\nharmonic-structure voicing guard (noise-robustness shootout 2026-07-20)");
{
  const { harmonicStructureCount, createHarmonicVoicingGuard } = await import("../../src/dsp/boersma-ac.js");
  let seed = 9;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const mk = (fn) => { const x = new Float32Array(N); for (let i = 0; i < N; i++) x[i] = fn(i / SR); return x; };
  const voiced330 = () => mk((t) => 0.1 * (Math.sin(2 * Math.PI * 330 * t) + 0.5 * Math.sin(2 * Math.PI * 660 * t) + 0.3 * Math.sin(2 * Math.PI * 990 * t)) + 0.01 * rnd());
  // The field-failure class, via the shootout-validated generator:
  // white noise through a moderate-Q resonator at 330 Hz over a
  // broadband floor (scripts/noise-synth.js resonantNoise) — genuinely
  // quasi-periodic at 330, but with no harmonic series.
  const { resonantNoise } = await import("../../scripts/noise-synth.js");
  const stream = resonantNoise(SR * 4);
  const resFrame = (k) => stream.subarray(k * 400, k * 400 + N);
  check("harmonic voice at 330 counts >= 2 harmonics",
    harmonicStructureCount(voiced330(), 330, SR) >= 2);
  {
    let below = 0;
    for (let k = 0; k < 20; k++) if (harmonicStructureCount(resFrame(k), 330, SR) < 2) below++;
    check("resonant noise frames overwhelmingly count < 2 harmonics", below >= 18, `${below}/20`);
  }
  const g = createHarmonicVoicingGuard();
  // find a run of 8 consecutive sub-threshold frames to exercise debounce
  let start = 0;
  for (let k = 0; k < 100; k++) {
    let ok = true;
    for (let j = k; j < k + 8; j++) if (harmonicStructureCount(resFrame(j), 330, SR) >= 2) { ok = false; break; }
    if (ok) { start = k; break; }
  }
  check("guard passes frames 1-3 of sustained non-harmonic (debounce)",
    g.check(resFrame(start), 330, SR) && g.check(resFrame(start + 1), 330, SR) && g.check(resFrame(start + 2), 330, SR));
  check("guard vetoes the 4th consecutive non-harmonic frame",
    g.check(resFrame(start + 3), 330, SR) === false);
  check("guard recovers immediately on a harmonic frame",
    g.check(voiced330(), 330, SR) === true);
  check("streak restarts after recovery (3 more pass again)",
    g.check(resFrame(start + 4), 330, SR) && g.check(resFrame(start + 5), 330, SR) && g.check(resFrame(start + 6), 330, SR));
}

console.log("\ndetector — real-mic levels (adaptive global peak)");
{
  // Regression: live mics with AGC off peak at 0.01-0.05 full scale. The
  // pre-fix silence term normalized against hardcoded full scale (1.0)
  // and silenced quiet-but-clean speech (live-use report 2026-06-09).
  const quiet = createBoersmaAC(SR, N);
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) b[i] = 0.02 * Math.sin(2 * Math.PI * 100 * i / SR);
  let r;
  for (let k = 0; k < 5; k++) r = quiet.detect(b);
  check("quiet mic (peak 0.02) 100 Hz tone is voiced", near(r.pitch, 100, 1));
}

console.log("\ndetector — silence-term reference vs transients (2026-10-03)");
{
  // Regression: the running-max reference latched onto any loud frame, so
  // one click/pop/bump far above a quiet AGC-off voice vetoed the voice
  // via the silence term for 30-50 s. measurements/
  // pitch-globalpeak-transient-2026-10-03.md
  const HOP = 400;
  // Quiet AGC-off mic: 200 Hz harmonic voice at peak ~0.02, mic floor.
  // `events` adds content into the stream; returns per-frame detect().
  const stream = (sec, events) => {
    const x = new Float32Array(sec * SR);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    for (let i = 0; i < x.length; i++) {
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * 200 * h * i / SR) / h;
      x[i] = 0.0095 * v + 2e-4 * rnd();
    }
    events(x, rnd);
    const det = createBoersmaAC(SR, N);
    const out = [];
    for (let e = N; e <= x.length; e += HOP) out.push({ end: e, r: det.detect(x.subarray(e - N, e)) });
    return out;
  };
  const after = (frames, t) => frames.filter((f) => f.end - N > t * SR);
  // 1. a single full-scale click (5 ms decaying noise burst) at 1.0 s
  {
    const fr = stream(4, (x, rnd) => { for (let i = 0; i < 80; i++) x[SR + i] += rnd() * Math.exp(-i / 16); });
    const post = after(fr, 1.01);
    const voiced = post.filter((f) => f.r.voiced).length;
    check("quiet voice stays voiced after a full-scale click (no 30 s latch)", voiced === post.length, `${voiced}/${post.length}`);
  }
  // 2. a plosive pop (80 ms LF pressure pulse, peak 1.0) at 1.0 s
  {
    const fr = stream(4, (x) => {
      for (let i = 0; i < 1280; i++) x[SR + i] += i < 240 ? Math.sin(Math.PI * i / 240) : i < 880 ? -0.4 * Math.sin(Math.PI * (i - 240) / 640) : 0;
    });
    const post = after(fr, 1.09);
    const voiced = post.filter((f) => f.r.voiced).length;
    check("quiet voice stays voiced after a full-scale plosive pop", voiced === post.length, `${voiced}/${post.length}`);
  }
  // 3. a desk bump (400 ms decaying 55+130 Hz thump, peak 1.0) at 1.0 s
  {
    const fr = stream(4, (x) => {
      for (let i = 0; i < 0.4 * SR; i++) { const t = i / SR; x[SR + i] += 1.15 * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.07) * (0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.4 * Math.sin(2 * Math.PI * 130 * t + 1)); }
    });
    const post = after(fr, 1.4);
    const voiced = post.filter((f) => f.r.voiced).length;
    check("quiet voice stays voiced after a full-scale desk bump", voiced === post.length, `${voiced}/${post.length}`);
  }
  // 4. the silence term itself still works: after 2 s of LOUD voice
  //    (peak 0.5), the same voice at -40 dB is rejected as silence.
  {
    const det = createBoersmaAC(SR, N);
    const frame = (amp, k) => { const b = new Float32Array(N); for (let i = 0; i < N; i++) { const n = k * HOP + i; let v = 0; for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * 200 * h * n / SR) / h; b[i] = amp * v; } return b; };
    let k = 0;
    for (; k < 80; k++) det.detect(frame(0.24, k));
    const loud = det.detect(frame(0.24, k++));
    const faint = det.detect(frame(0.0024, k++));
    check("sustained loud voice sets the reference (loud frame voiced)", loud.voiced);
    check("frame 40 dB below a sustained voice is unvoiced (silence term intact)", !faint.voiced);
  }
  // 5. a sustained loud APERIODIC sound (1 s of white noise, peak ~0.5)
  //    is not a reference for the quiet voice that follows it.
  {
    const fr = stream(4, (x, rnd) => { for (let i = 0; i < SR; i++) x[SR + i] += 0.5 * rnd(); });
    const post = after(fr, 2.01);
    const voiced = post.filter((f) => f.r.voiced).length;
    check("quiet voice voiced after 1 s of loud aperiodic noise", voiced === post.length, `${voiced}/${post.length}`);
  }
}

console.log("\ncandidates — shape");
{
  const c = ac.candidates(tone(150));
  check("voiced candidates sorted by strength", c.voiced.length > 0 &&
    c.voiced.every((x, i) => i === 0 || x.strength <= c.voiced[i - 1].strength));
  check("unvoicedStrength present", typeof c.unvoicedStrength === "number");
}

console.log("\npath tracker — decode delay, stability, flush");
{
  const pt = createPathTracker();
  const L = pt.config.lookback;
  const out = [];
  for (let i = 0; i < 12; i++) out.push(pt.emit(ac.candidates(weakH1)));
  check(`first ${L} emits are null (decode delay)`, out.slice(0, L).every((v) => v === null));
  check("decoded frames hold 95 Hz", out.slice(L).every((v) => near(v, 95, 1.5)));
  const tail = pt.flush();
  check(`flush drains ${L} pending frames`, tail.length === L && tail.every((v) => near(v, 95, 1.5)));
}
{
  // A single-frame octave outlier must not flip the decoded contour.
  const pt = createPathTracker();
  const seq = Array(8).fill(tone(110)).concat([tone(220)]).concat(Array(8).fill(tone(110)));
  const out = [];
  for (const f of seq) { const v = pt.emit(ac.candidates(f)); if (v !== null) out.push(v); }
  out.push(...pt.flush());
  const flipped = out.filter((v) => v !== null && near(v, 220, 5)).length;
  check(`1-frame octave outlier suppressed (${flipped} frames at 220)`, flipped <= 1);
}
{
  // A sustained octave shift IS tracked. Note the stimulus subtlety: a
  // perfectly periodic tone correlates identically at lag T and 2T, so
  // the octave is genuinely ambiguous frame-locally and only the
  // octaveCost bonus (+0.01/frame toward the higher octave) accumulates
  // against the one-time jump cost (0.15) — ~15 frames to amortize.
  // Real voices break the 2T correlation via jitter/noise and flip in
  // 2-3 frames (measured: session flip behavior at Praat parity).
  const pt = createPathTracker();
  const seq = Array(8).fill(tone(110)).concat(Array(30).fill(tone(220)));
  const out = [];
  for (const f of seq) { const v = pt.emit(ac.candidates(f)); if (v !== null) out.push(v); }
  out.push(...pt.flush());
  check("sustained octave shift tracks to 220", near(out[out.length - 1], 220, 5));
}

console.log("\noctave arbitration — rumble vs. odd-multiple evidence (2026-10-03)");
{
  // Room rumble (narrowband noise ~90 Hz) inflates the autocorrelation at
  // the 2T lag of a ~220 Hz voice, so the subharmonic 110 Hz candidate
  // wins by a few hundredths — the "trace at half my pitch" report.
  // octaveEvidence penalizes a subharmonic whose odd multiples (3f, 5f,
  // ...) carry no partials. Low-voice control: a real 110 Hz voice under
  // the same rumble must stay at 110 (its odd multiples exist).
  // measurements/pitch-octave-arbitration-2026-10-03.md
  function voicePlusRumble(f0, seedInit) {
    let seed = seedInit;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const n = Math.round(1.2 * SR), v = new Float32Array(n), w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 1; k * f0 < 7000; k++) s += Math.pow(10, (-12 * Math.log2(k)) / 20) * Math.sin(2 * Math.PI * k * f0 * i / SR);
      v[i] = s;
    }
    const r = Math.exp(-Math.PI * 60 / SR), th = 2 * Math.PI * 90 / SR, a1 = 2 * r * Math.cos(th), a2 = -r * r;
    let y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const y = gauss() + a1 * y1 + a2 * y2; y2 = y1; y1 = y;
      const z = y + a1 * z1 + a2 * z2; z2 = z1; z1 = z; w[i] = z;
    }
    const rms = (a) => Math.sqrt(a.reduce((q, x) => q + x * x, 0) / a.length);
    const rv = rms(v), g = (rv / rms(w)) * Math.pow(10, -10 / 20); // rumble 10 dB below voice
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.1 * (v[i] + g * w[i]) / rv;
    return out;
  }
  function decodedCorrectFrac(f0) {
    let ok = 0, tot = 0;
    for (const s of [7919, 15838, 23757, 31676]) {
      const x = voicePlusRumble(f0, s);
      const det = createBoersmaAC(SR, N), pt = createPathTracker();
      const buf = new Float32Array(N);
      let fill = 0, k2 = 0;
      for (let k = 0; (k + 1) * 400 <= x.length; k++) {
        buf.copyWithin(0, 400); buf.set(x.subarray(k * 400, (k + 1) * 400), N - 400);
        fill += 400; if (fill < N) continue;
        const d = pt.emit(det.candidates(buf));
        if (d === null || k2++ < 2) continue;
        tot++; if (d > 0 && Math.abs(d / f0 - 1) < 0.05) ok++;
      }
    }
    return ok / tot;
  }
  const hi = decodedCorrectFrac(220), lo = decodedCorrectFrac(110);
  check("220 Hz voice + 90 Hz rumble (-10 dB) decodes at 220, not 110 (>= 80 % of frames)", hi >= 0.8, `${(100 * hi).toFixed(1)} %`);
  check("110 Hz voice + same rumble stays at 110 (no octave-up, >= 95 %)", lo >= 0.95, `${(100 * lo).toFixed(1)} %`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
