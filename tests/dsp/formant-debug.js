// formant-debug.js — Synthetic vowel regression test for the formant extraction pipeline.
// Uses resonant-filtered pulse trains (matching real vocal tract acoustics) to validate
// that Burg LPC formant extraction correctly recovers known formant frequencies.
//
// Usage: node tests/dsp/formant-debug.js
//
// Exit code 0 = all pass, 1 = some failed.
// Pass criteria: F1 error < 100 Hz, F2 error < 150 Hz for all test cases.

// ============================================================
//  DSP FUNCTIONS — must match src/dsp/dsp-worker.js exactly
// ============================================================

function designLowPassFIR(cutoffNormalized, numTaps) {
  const coeffs = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    let sinc;
    if (Math.abs(x) < 1e-10) {
      sinc = 2 * cutoffNormalized;
    } else {
      sinc = Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    }
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1))
                     + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    coeffs[i] = sinc * win;
  }
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += coeffs[i];
  for (let i = 0; i < numTaps; i++) coeffs[i] /= sum;
  return coeffs;
}

function decimateWithFilter(buffer, factor, taps) {
  if (factor <= 1) return buffer;
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const newLen = Math.floor(buffer.length / factor);
  const result = new Float64Array(newLen);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const center = i * factor;
    for (let j = 0; j < numTaps; j++) {
      const idx = center - halfTaps + j;
      if (idx >= 0 && idx < buffer.length) {
        sum += buffer[idx] * taps[j];
      }
    }
    result[i] = sum;
  }
  return result;
}

function burgLPC(samples, order) {
  const n = samples.length;
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let ef = Float64Array.from(samples);
  let eb = Float64Array.from(samples);
  let errorPower = 0;
  for (let i = 0; i < n; i++) errorPower += samples[i] * samples[i];
  errorPower /= n;
  for (let m = 1; m <= order; m++) {
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    if (den === 0) break;
    const k = (-2 * num) / den;
    const aNew = new Float64Array(order + 1);
    aNew[0] = 1;
    for (let i = 1; i < m; i++) aNew[i] = a[i] + k * a[m - i];
    aNew[m] = k;
    const efNew = new Float64Array(n);
    const ebNew = new Float64Array(n);
    for (let i = m; i < n; i++) {
      efNew[i] = ef[i] + k * eb[i - 1];
      ebNew[i] = eb[i - 1] + k * ef[i];
    }
    ef = efNew;
    eb = ebNew;
    a.set(aNew);
    errorPower *= 1 - k * k;
  }
  return { coefficients: a, error: errorPower };
}

function findPolynomialRoots(coefficients) {
  const n = coefficients.length - 1;
  if (n <= 0) return [];
  const roots = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    roots.push({ real: 0.9 * Math.cos(angle), imag: 0.9 * Math.sin(angle) });
  }
  for (let iter = 0; iter < 50; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let pr = coefficients[0], pi = 0;
      for (let j = 1; j <= n; j++) {
        const newR = pr * roots[i].real - pi * roots[i].imag + coefficients[j];
        const newI = pr * roots[i].imag + pi * roots[i].real;
        pr = newR;
        pi = newI;
      }
      let qr = 1, qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = roots[i].real - roots[j].real;
        const di = roots[i].imag - roots[j].imag;
        const newR = qr * dr - qi * di;
        const newI = qr * di + qi * dr;
        qr = newR;
        qi = newI;
      }
      const denom = qr * qr + qi * qi;
      if (denom < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denom;
      const deltaI = (pi * qr - pr * qi) / denom;
      roots[i].real -= deltaR;
      roots[i].imag -= deltaI;
      const mag = Math.sqrt(deltaR * deltaR + deltaI * deltaI);
      if (mag > maxDelta) maxDelta = mag;
    }
    if (maxDelta < 1e-10) break;
  }
  return roots;
}

// Full extraction pipeline — mirrors extractFormants() in dsp-worker.js
function extractFormants(buffer, sampleRate, decimationFactor, targetSR, lpcOrder, antiAliasTaps) {
  // Pre-emphasis (0.97 coefficient)
  const preEmph = new Float64Array(buffer.length);
  preEmph[0] = buffer[0];
  for (let i = 1; i < buffer.length; i++) {
    preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Hamming window
  const n = preEmph.length;
  const windowed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    windowed[i] = preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Downsample with anti-alias filter
  const downsampled = decimateWithFilter(windowed, decimationFactor, antiAliasTaps);

  // Burg LPC
  const { coefficients } = burgLPC(downsampled, lpcOrder);

  // Root finding
  const roots = findPolynomialRoots(coefficients);

  // Convert roots to formants
  const formants = [];
  for (const root of roots) {
    if (root.imag <= 0) continue;
    const freq = (Math.atan2(root.imag, root.real) * targetSR) / (2 * Math.PI);
    const mag = Math.sqrt(root.real * root.real + root.imag * root.imag);
    const bw = mag > 0 ? (-Math.log(mag) * targetSR) / Math.PI : Infinity;
    if (freq > 90 && freq < 5500 && bw > 0 && bw < 600) {
      formants.push({ freq, bw });
    }
  }
  formants.sort((a, b) => a.freq - b.freq);

  return {
    f1: formants[0]?.freq || null,
    f2: formants[1]?.freq || null,
    f3: formants[2]?.freq || null,
  };
}

// ============================================================
//  SIGNAL GENERATION — resonant-filtered pulse train
// ============================================================

function biquadResonator(signal, centerFreq, bandwidth, sampleRate) {
  const r = Math.exp(-Math.PI * bandwidth / sampleRate);
  const theta = 2 * Math.PI * centerFreq / sampleRate;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  const output = new Float64Array(signal.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const y = signal[i] - a1 * y1 - a2 * y2;
    output[i] = y;
    y2 = y1;
    y1 = y;
  }
  return output;
}

function generateVowelSignal(f0, formantFreqs, formantBWs, sampleRate, durationMs) {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);

  // Glottal pulse train
  let signal = new Float64Array(numSamples);
  const period = Math.round(sampleRate / f0);
  for (let i = 0; i < numSamples; i += period) signal[i] = 1.0;

  // Glottal spectral tilt (-12 dB/octave)
  const tilted = new Float64Array(numSamples);
  tilted[0] = signal[0];
  for (let i = 1; i < numSamples; i++) tilted[i] = signal[i] + 0.98 * tilted[i - 1];
  signal = tilted;

  // Cascade resonant filters for each formant (vocal tract model)
  for (let f = 0; f < formantFreqs.length; f++) {
    signal = biquadResonator(signal, formantFreqs[f], formantBWs[f], sampleRate);
  }

  // Small noise for realism
  for (let i = 0; i < numSamples; i++) {
    signal[i] += (Math.random() - 0.5) * 0.001;
  }

  // Normalize
  let maxAbs = 0;
  for (let i = 0; i < numSamples; i++) {
    if (Math.abs(signal[i]) > maxAbs) maxAbs = Math.abs(signal[i]);
  }
  if (maxAbs > 0) {
    for (let i = 0; i < numSamples; i++) signal[i] /= maxAbs;
  }
  return signal;
}

// ============================================================
//  TEST CASES & RUNNER
// ============================================================

const SAMPLE_RATE = 48000;
const LPC_ORDER = 10;
const DECIMATION_FACTOR = Math.max(1, Math.round(SAMPLE_RATE / 11000)); // 4
const TARGET_SR = SAMPLE_RATE / DECIMATION_FACTOR; // 12000
const ANTI_ALIAS_TAPS = designLowPassFIR(0.4 / DECIMATION_FACTOR, DECIMATION_FACTOR * 16 + 1);

const testCases = [
  { label: "Male /a/",   f0: 120, f1: 700, f2: 1200, f3: 2600, bws: [80, 90, 120] },
  { label: "Male /i/",   f0: 120, f1: 300, f2: 2200, f3: 3000, bws: [60, 100, 120] },
  { label: "Male /u/",   f0: 120, f1: 300, f2: 800,  f3: 2200, bws: [60, 80, 120] },
  { label: "Female /a/", f0: 220, f1: 900, f2: 1500, f3: 2800, bws: [80, 100, 130] },
  { label: "Female /i/", f0: 220, f1: 350, f2: 2700, f3: 3300, bws: [60, 100, 130] },
];

// Test at both 200ms (user-specified) and 50ms (actual DSP worker window size)
const DURATIONS = [200, 50];

console.log("================================================================");
console.log("       Formant Extraction Regression Test");
console.log("================================================================");
console.log(`Sample rate: ${SAMPLE_RATE} Hz`);
console.log(`Decimation: x${DECIMATION_FACTOR} -> ${TARGET_SR} Hz`);
console.log(`LPC order: ${LPC_ORDER}`);
console.log(`FIR taps: ${ANTI_ALIAS_TAPS.length}`);
console.log(`Pass criteria: F1 < 100 Hz error, F2 < 150 Hz error\n`);

let totalFail = 0;

for (const durationMs of DURATIONS) {
  console.log(`--- Window: ${durationMs} ms ---`);

  for (const tc of testCases) {
    const signal = generateVowelSignal(
      tc.f0, [tc.f1, tc.f2, tc.f3], tc.bws, SAMPLE_RATE, durationMs
    );

    const result = extractFormants(signal, SAMPLE_RATE, DECIMATION_FACTOR, TARGET_SR, LPC_ORDER, ANTI_ALIAS_TAPS);

    const f1err = result.f1 ? Math.abs(result.f1 - tc.f1) : Infinity;
    const f2err = result.f2 ? Math.abs(result.f2 - tc.f2) : Infinity;
    const f3err = result.f3 ? Math.abs(result.f3 - tc.f3) : Infinity;

    const f1pass = f1err < 100;
    const f2pass = f2err < 150;
    const pass = f1pass && f2pass;
    if (!pass) totalFail++;

    const f1s = result.f1 ? String(Math.round(result.f1)).padStart(4) : ' ---';
    const f2s = result.f2 ? String(Math.round(result.f2)).padStart(4) : ' ---';
    const f3s = result.f3 ? String(Math.round(result.f3)).padStart(4) : ' ---';
    const e1 = f1err === Infinity ? 'MISS' : String(Math.round(f1err)).padStart(4);
    const e2 = f2err === Infinity ? 'MISS' : String(Math.round(f2err)).padStart(4);
    const e3 = f3err === Infinity ? 'MISS' : String(Math.round(f3err)).padStart(4);

    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${tc.label.padEnd(12)}` +
      `  detected F1=${f1s} F2=${f2s} F3=${f3s}` +
      `  err F1=${e1} F2=${e2} F3=${e3}`
    );
  }
  console.log();
}

if (totalFail === 0) {
  console.log("ALL TESTS PASSED");
  process.exit(0);
} else {
  console.log(`${totalFail} TEST(S) FAILED`);
  process.exit(1);
}
