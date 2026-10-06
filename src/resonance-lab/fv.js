// fv.js — formant-vtl finalist (fv_app101214_gm1234_ridge2_bw800), streaming port.
//
// Port of scripts/resonance-lab/candidates/formant-vtl/fvtl_js.mjs +
// allpoles.mjs (the scored implementation), allocation-free per frame.
//
// The app's formant front end (src/dsp/formants.js) at the capture rate:
// 50 ms frames every 25 ms, pre-emphasis 0.97 -> Hamming -> Blackman-sinc
// FIR anti-alias + integer decimation to <= 12 kHz -> Burg LPC, snapshotted
// at orders 10 / 12 / 14 (one recursion) -> Durand-Kerner roots. It is
// sex-blind (no pitch hint). Per order, F1..F4 = the four lowest poles with
// 90 < f < 5400 Hz and bandwidth < 800 Hz; the frame estimate is
// mean(ln F1..F4) minus a 10-weight degree-2 ridge polynomial on the
// scale-free shape (ln Fi - mean ln F, i = 1..3), which removes vowel
// offsets without vowel labels. Voiced frames only (pitch-track voicing at
// the frame centre, the F0 value is unused). Estimates of all three orders
// pool into absolute 150 ms bins (by frame END time): median of >= 2.
// Units: log geometric-mean formant (ln Hz); larger = shorter tract.
// Readout pooling in the harness: MEDIAN of bin values.

const MAX_ORDER = 16;

function designLowPassFIR(cutoffNormalized, numTaps) {
  const c = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    const sinc = Math.abs(x) < 1e-10 ? 2 * cutoffNormalized : Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    c[i] = sinc * w;
  }
  let s = 0;
  for (let i = 0; i < numTaps; i++) s += c[i];
  for (let i = 0; i < numTaps; i++) c[i] /= s;
  return c;
}

function makeExtractor(sampleRate, maxWin, orders, maxAnalysisSR = 12000) {
  const factor = Math.max(1, Math.ceil(sampleRate / maxAnalysisSR));
  const asr = sampleRate / factor;
  const fir = designLowPassFIR(0.45 / factor, factor * 16 + 1);
  const pre = new Float64Array(maxWin);
  const win = new Float64Array(maxWin);
  const dec = new Float64Array(maxWin);
  const ef = new Float64Array(maxWin), eb = new Float64Array(maxWin);
  const eft = new Float64Array(maxWin), ebt = new Float64Array(maxWin);
  const a = new Float64Array(MAX_ORDER + 1), an = new Float64Array(MAX_ORDER + 1);
  const snaps = orders.map((o) => new Float64Array(o + 1));
  const maxO = Math.max(...orders);
  const rRe = new Float64Array(MAX_ORDER), rIm = new Float64Array(MAX_ORDER);
  // per-order outputs: sorted pole frequencies + bandwidths
  const outF = orders.map(() => new Float64Array(MAX_ORDER));
  const outB = orders.map(() => new Float64Array(MAX_ORDER));
  const outN = new Int32Array(orders.length);

  function roots(c, n) {
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * i) / n + 0.4;
      rRe[i] = 0.9 * Math.cos(ang);
      rIm[i] = 0.9 * Math.sin(ang);
    }
    for (let it = 0; it < 50; it++) {
      let md = 0;
      for (let i = 0; i < n; i++) {
        let pr = c[0], pi = 0;
        const xr = rRe[i], xi = rIm[i];
        for (let j = 1; j <= n; j++) { const nr = pr * xr - pi * xi + c[j]; pi = pr * xi + pi * xr; pr = nr; }
        let qr = 1, qi = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const dr = xr - rRe[j], di = xi - rIm[j];
          const nr = qr * dr - qi * di; qi = qr * di + qi * dr; qr = nr;
        }
        const den = qr * qr + qi * qi;
        if (den < 1e-30) continue;
        const dR = (pr * qr + pi * qi) / den, dI = (pi * qr - pr * qi) / den;
        rRe[i] = xr - dR; rIm[i] = xi - dI;
        const m = dR * dR + dI * dI;
        if (m > md) md = m;
      }
      if (md < 1e-20) break;
    }
  }

  // buf: a Float64Array-like accessor (start index + ring) is avoided: caller copies the frame into `frameBuf`.
  function analyze(buf, n) {
    pre[0] = buf[0];
    for (let i = 1; i < n; i++) pre[i] = buf[i] - 0.97 * buf[i - 1];
    for (let i = 0; i < n; i++) win[i] = pre[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
    let m;
    if (factor <= 1) {
      for (let i = 0; i < n; i++) dec[i] = win[i];
      m = n;
    } else {
      const nt = fir.length, h = nt >> 1;
      m = Math.floor(n / factor);
      for (let i = 0; i < m; i++) {
        let s = 0;
        const c = i * factor;
        const j0 = Math.max(0, h - c), j1 = Math.min(nt, n - c + h);
        for (let j = j0; j < j1; j++) s += win[c - h + j] * fir[j];
        dec[i] = s;
      }
    }
    a.fill(0); a[0] = 1;
    for (let i = 0; i < m; i++) { ef[i] = dec[i]; eb[i] = dec[i]; }
    for (let k = 1; k <= maxO; k++) {
      let num = 0, den = 0;
      for (let i = k; i < m; i++) { num += ef[i] * eb[i - 1]; den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1]; }
      if (den === 0) break;
      const r = (-2 * num) / den;
      an[0] = 1;
      for (let i = 1; i < k; i++) an[i] = a[i] + r * a[k - i];
      an[k] = r;
      for (let i = 0; i <= k; i++) a[i] = an[i];
      for (let i = k; i < m; i++) { eft[i] = ef[i] + r * eb[i - 1]; ebt[i] = eb[i - 1] + r * ef[i]; }
      for (let i = k; i < m; i++) { ef[i] = eft[i]; eb[i] = ebt[i]; }
      for (let q = 0; q < orders.length; q++) if (orders[q] === k) snaps[q].set(a.subarray(0, k + 1));
    }
    for (let q = 0; q < orders.length; q++) {
      const o = orders[q];
      roots(snaps[q], o);
      const F = outF[q], B = outB[q];
      let cnt = 0;
      for (let i = 0; i < o; i++) {
        if (rIm[i] <= 0) continue;
        const f = (Math.atan2(rIm[i], rRe[i]) * asr) / (2 * Math.PI);
        const mag = Math.hypot(rRe[i], rIm[i]);
        const bw = mag > 0 ? (-Math.log(mag) * asr) / Math.PI : Infinity;
        // insertion sort by frequency (stable, matches Array.sort on distinct values)
        let p = cnt;
        while (p > 0 && F[p - 1] > f) { F[p] = F[p - 1]; B[p] = B[p - 1]; p--; }
        F[p] = f; B[p] = bw;
        cnt++;
      }
      outN[q] = cnt;
    }
  }
  return { analyze, outF, outB, outN, factor, asr };
}

export const FV_BIN_S = 0.15;

/**
 * model = models/fv_app101214_gm1234_ridge2_bw800.json ({cfg, corr, population}).
 * sampleRate = the capture rate the frames are cut at (production: 48 kHz).
 * onBin(tEndSeconds, valueOrNull) once per 150 ms bin, in order.
 */
export function createFv(model, sampleRate, onBin) {
  const cfg = model.cfg, corr = model.corr;
  if (cfg.est !== "gm1234" || !corr || corr.type !== "ridge" || corr.deg !== 2) {
    throw new Error("fv.js ports the gm1234 + ridge deg-2 configuration only");
  }
  const orders = cfg.orders || [cfg.order || 12];
  const WIN = Math.round(sampleRate * 0.05);
  const HOP = Math.round(sampleRate * 0.025);
  const ex = makeExtractor(sampleRate, WIN, orders);
  const FMIN = cfg.fmin ?? 90, FMAX = cfg.fmax ?? 5400, BWMAX = cfg.bwmax ?? 600;
  const MINN = cfg.min_n ?? 2;
  const cw = Float64Array.from(corr.w);
  const frameBuf = new Float64Array(WIN);
  const F = new Float64Array(5);
  const vals = new Float64Array(orders.length * 8); // >= 3 orders x frames per 150 ms bin (6)
  let nv = 0;
  let cur = 0;
  let nextFrame = 0; // index k of the next frame to analyse (start sample k*HOP)

  function estimate() {
    // gm1234 minus ridge-2 shape correction; F has >= 4 finite entries here
    const l0 = Math.log(F[0]), l1 = Math.log(F[1]), l2 = Math.log(F[2]), l3 = Math.log(F[3]);
    const m = (l0 + l1 + l2 + l3) / 4;
    const x0 = l0 - m, x1 = l1 - m, x2 = l2 - m;
    // phi = [1, x0, x1, x2, x0x0, x0x1, x0x2, x1x1, x1x2, x2x2]
    const off = cw[0] + cw[1] * x0 + cw[2] * x1 + cw[3] * x2
      + cw[4] * x0 * x0 + cw[5] * x0 * x1 + cw[6] * x0 * x2
      + cw[7] * x1 * x1 + cw[8] * x1 * x2 + cw[9] * x2 * x2;
    return m - off;
  }
  function median(n) {
    const a = vals.subarray(0, n).sort();
    const h = n >> 1;
    return n % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }
  function flush() {
    // the scored JS rounds its output to 6 decimals (toFixed(6)); keep full precision here
    onBin((cur + 1) * FV_BIN_S, nv >= MINN ? median(nv) : null);
    nv = 0;
    cur++;
  }

  return {
    hop: HOP,
    win: WIN,
    get nextFrame() { return nextFrame; },
    /** Frame k's END time (s) and centre time used for the voicing lookup. */
    frameEnd(k) { return (k * HOP + WIN) / sampleRate; },
    /**
     * Process frame k (must be called for k = 0, 1, 2, ... in order) from the
     * capture-rate ring; voiced = pitch-track voicing at the frame centre.
     */
    frame(ring, k, voiced) {
      const tEnd = (k * HOP + WIN) / sampleRate;
      const b = Math.floor(tEnd / FV_BIN_S);
      while (cur < b) flush();
      nextFrame = k + 1;
      if (!voiced) return;
      const s0 = k * HOP;
      for (let i = 0; i < WIN; i++) frameBuf[i] = ring.at(s0 + i);
      ex.analyze(frameBuf, WIN);
      for (let q = 0; q < orders.length; q++) {
        const fr = ex.outF[q], bw = ex.outB[q], cnt = ex.outN[q];
        let nF = 0;
        for (let i = 0; i < cnt && nF < 5; i++) {
          if (fr[i] > FMIN && fr[i] < FMAX && bw[i] > 0 && bw[i] < BWMAX) F[nF++] = fr[i];
        }
        if (nF < 4) continue;
        const v = estimate();
        if (!Number.isFinite(v)) continue;
        if (nv < vals.length) vals[nv++] = v;
      }
    },
    finish(durS) {
      const nb = Math.ceil(durS / FV_BIN_S);
      while (cur < nb) flush();
    },
    reset() { nv = 0; cur = 0; nextFrame = 0; },
  };
}
