// allpoles.mjs — scratch copy of the app's formant pipeline (src/dsp/formants.js)
// that returns EVERY LPC pole (frequency + bandwidth), at several LPC orders, instead
// of the app's F1-F3 after its 90 Hz..ceiling / bw < 600 Hz filter.
//
// Pipeline identical to production at 48 kHz capture: pre-emphasis 0.97 (at the
// capture rate) -> Hamming -> Blackman-sinc FIR anti-alias (0.45/factor, factor*16+1
// taps) + integer decimation -> Burg LPC -> Durand-Kerner roots. Production uses one
// order (lpcOrderForRate(12000) = 12); Burg is order-recursive, so the order-10/12/14
// models are snapshots of ONE recursion (no extra cost beyond root finding).
//
// The analysis is sex-blind by construction: no pitch hint, fixed decimation.

export const MAX_ORDER = 16;

function designLowPassFIR(cutoffNormalized, numTaps) {
  const c = new Float64Array(numTaps), mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    const sinc = Math.abs(x) < 1e-10 ? 2 * cutoffNormalized : Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    c[i] = sinc * w;
  }
  let s = 0; for (let i = 0; i < numTaps; i++) s += c[i];
  for (let i = 0; i < numTaps; i++) c[i] /= s;
  return c;
}

export function makeExtractor(sampleRate, maxWin, orders = [10, 12, 14], maxAnalysisSR = 12000) {
  const factor = Math.max(1, Math.ceil(sampleRate / maxAnalysisSR));
  const asr = sampleRate / factor;
  const fir = designLowPassFIR(0.45 / factor, factor * 16 + 1);
  const pre = new Float64Array(maxWin), win = new Float64Array(maxWin), dec = new Float64Array(maxWin);
  const ef = new Float64Array(maxWin), eb = new Float64Array(maxWin), eft = new Float64Array(maxWin), ebt = new Float64Array(maxWin);
  const a = new Float64Array(MAX_ORDER + 1), an = new Float64Array(MAX_ORDER + 1);
  const snaps = orders.map((o) => new Float64Array(o + 1));
  const maxO = Math.max(...orders);
  const rRe = new Float64Array(MAX_ORDER), rIm = new Float64Array(MAX_ORDER);

  function roots(c, n) {
    for (let i = 0; i < n; i++) { const ang = (2 * Math.PI * i) / n + 0.4; rRe[i] = 0.9 * Math.cos(ang); rIm[i] = 0.9 * Math.sin(ang); }
    for (let it = 0; it < 50; it++) {
      let md = 0;
      for (let i = 0; i < n; i++) {
        let pr = c[0], pi = 0; const xr = rRe[i], xi = rIm[i];
        for (let j = 1; j <= n; j++) { const nr = pr * xr - pi * xi + c[j]; pi = pr * xi + pi * xr; pr = nr; }
        let qr = 1, qi = 0;
        for (let j = 0; j < n; j++) { if (j === i) continue; const dr = xr - rRe[j], di = xi - rIm[j]; const nr = qr * dr - qi * di; qi = qr * di + qi * dr; qr = nr; }
        const den = qr * qr + qi * qi; if (den < 1e-30) continue;
        const dR = (pr * qr + pi * qi) / den, dI = (pi * qr - pr * qi) / den;
        rRe[i] = xr - dR; rIm[i] = xi - dI;
        const m = dR * dR + dI * dI; if (m > md) md = m;
      }
      if (md < 1e-20) break;
    }
  }

  // returns [{order, f: Float64Array, bw: Float64Array}] sorted by frequency (all poles with Im > 0)
  function analyze(buf) {
    const n = buf.length;
    pre[0] = buf[0];
    for (let i = 1; i < n; i++) pre[i] = buf[i] - 0.97 * buf[i - 1];
    for (let i = 0; i < n; i++) win[i] = pre[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
    let m;
    if (factor <= 1) { for (let i = 0; i < n; i++) dec[i] = win[i]; m = n; }
    else {
      const nt = fir.length, h = nt >> 1; m = Math.floor(n / factor);
      for (let i = 0; i < m; i++) {
        let s = 0; const c = i * factor;
        const j0 = Math.max(0, h - c), j1 = Math.min(nt, n - c + h);
        for (let j = j0; j < j1; j++) s += win[c - h + j] * fir[j];
        dec[i] = s;
      }
    }
    // Burg, snapshotting the requested orders
    a.fill(0); a[0] = 1;
    for (let i = 0; i < m; i++) { ef[i] = dec[i]; eb[i] = dec[i]; }
    let done = 0;
    for (let k = 1; k <= maxO; k++) {
      let num = 0, den = 0;
      for (let i = k; i < m; i++) { num += ef[i] * eb[i - 1]; den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1]; }
      if (den === 0) break;
      const r = (-2 * num) / den;
      an[0] = 1; for (let i = 1; i < k; i++) an[i] = a[i] + r * a[k - i]; an[k] = r;
      for (let i = 0; i <= k; i++) a[i] = an[i];
      for (let i = k; i < m; i++) { eft[i] = ef[i] + r * eb[i - 1]; ebt[i] = eb[i - 1] + r * ef[i]; }
      for (let i = k; i < m; i++) { ef[i] = eft[i]; eb[i] = ebt[i]; }
      for (let q = 0; q < orders.length; q++) if (orders[q] === k) { snaps[q].set(a.subarray(0, k + 1)); done++; }
    }
    const out = [];
    for (let q = 0; q < orders.length; q++) {
      const o = orders[q];
      roots(snaps[q], o);
      const fs = [], bs = [];
      for (let i = 0; i < o; i++) {
        if (rIm[i] <= 0) continue;
        const f = (Math.atan2(rIm[i], rRe[i]) * asr) / (2 * Math.PI);
        const mag = Math.hypot(rRe[i], rIm[i]);
        const bw = mag > 0 ? (-Math.log(mag) * asr) / Math.PI : Infinity;
        fs.push(f); bs.push(bw);
      }
      const idx = fs.map((_, i) => i).sort((p, r) => fs[p] - fs[r]);
      out.push({ order: o, f: idx.map((i) => fs[i]), bw: idx.map((i) => bs[i]) });
    }
    return out;
  }
  return { analyze, analysisSR: asr, factor };
}
