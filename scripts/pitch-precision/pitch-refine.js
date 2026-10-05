// pitch-refine.js — (precision pass 2026-10-04, scratch variant) post-decode
// refinement of the DECODED frequency only. Decisions (which candidate,
// voicing, veto, range, guard) are untouched: the worker calls refine()
// after all of them, on the decoded frame's own audio.
//   mode "sinc"  : full-frame window-corrected AC, Praat sinc70 + golden-
//                  section maximisation around the decoded lag
//   mode "sub40" : centred 40 ms sub-window AC (own Hann + correction),
//                  local max within +-4 % of the decoded lag, parabolic
// Returns the refined Hz, or the input when no matching peak exists.
function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? 1 : -1);
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = re[i + k], uI = im[i + k];
        const vR = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vI = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = uR + vR; im[i + k] = uI + vI;
        re[i + k + len / 2] = uR - vR; im[i + k + len / 2] = uI - vI;
        const nr = cr * wRe - ci * wIm; ci = cr * wIm + ci * wRe; cr = nr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function sincInterp(y, nx, x, depth) {
  const ml = Math.floor(x), mr = ml + 1;
  if (x === ml) return y[ml];
  const d0 = Math.min(depth, mr, nx - 1 - ml);
  let res = 0;
  for (let ix = ml; ix >= mr - d0; ix--) { const d = x - ix, pd = Math.PI * d; res += y[ix] * (Math.sin(pd) / pd) * (0.5 + 0.5 * Math.cos(pd / (d0 + 0.5))); }
  for (let ix = mr; ix <= ml + d0; ix++) { const d = ix - x, pd = Math.PI * d; res += y[ix] * (Math.sin(pd) / pd) * (0.5 + 0.5 * Math.cos(pd / (d0 + 0.5))); }
  return res;
}
export function createRefiner(sampleRate, frameLength, mode, minPitchHz = 75) {
  const n = mode === "sub40" ? Math.round(frameLength / 2) : frameLength;
  const off = Math.floor((frameLength - n) / 2);
  const fftSize = 1 << Math.ceil(Math.log2(2 * n));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minPitchHz) + 2);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  const ac = (x, out) => {
    re.fill(0); im.fill(0);
    for (let i = 0; i < n; i++) re[i] = x[i];
    fft(re, im, false);
    for (let i = 0; i < fftSize; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im, true);
    for (let t = 0; t <= maxLag; t++) out[t] = re[t];
  };
  const rW = new Float64Array(maxLag + 1); ac(w, rW);
  const rX = new Float64Array(maxLag + 1), r = new Float64Array(maxLag + 1), xw = new Float64Array(n);
  return function refine(buffer, freq) {
    let mean = 0; for (let i = 0; i < n; i++) mean += buffer[off + i]; mean /= n;
    for (let i = 0; i < n; i++) xw[i] = (buffer[off + i] - mean) * w[i];
    ac(xw, rX);
    if (!(rX[0] > 0)) return freq;
    for (let t = 0; t <= maxLag; t++) r[t] = (rX[t] / rX[0]) / (rW[t] / rW[0]);
    const L0 = sampleRate / freq;
    const lo = Math.max(2, Math.floor(L0 * 0.96)), hi = Math.min(maxLag - 1, Math.ceil(L0 * 1.04));
    let bt = -1;
    for (let t = lo; t <= hi; t++) if (r[t] > r[t - 1] && r[t] >= r[t + 1] && (bt < 0 || Math.abs(t - L0) < Math.abs(bt - L0))) bt = t;
    if (bt < 0) return freq;
    let lag;
    if (mode === "sinc") {
      const g = (Math.sqrt(5) - 1) / 2;
      let a = bt - 1, b = bt + 1, c = b - g * (b - a), d = a + g * (b - a);
      let fc = sincInterp(r, maxLag + 1, c, 70), fd = sincInterp(r, maxLag + 1, d, 70);
      while (b - a > 1e-4) {
        if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sincInterp(r, maxLag + 1, c, 70); }
        else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sincInterp(r, maxLag + 1, d, 70); }
      }
      lag = (a + b) / 2;
    } else {
      const A = r[bt - 1], B = r[bt], C = r[bt + 1];
      const den = A - 2 * B + C; const dt = den !== 0 ? 0.5 * (A - C) / den : 0;
      lag = bt + Math.max(-0.5, Math.min(0.5, dt));
    }
    const f = sampleRate / lag;
    return Math.abs(f / freq - 1) < 0.04 ? f : freq;
  };
}
