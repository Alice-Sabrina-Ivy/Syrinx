// sbs-align.mjs — where the test sound is in a device's capture, on that
// device's audio clock (contextTime). Three stages:
//   1. coarse: Pearson cross-correlation (FFT) of 10 ms log-energy envelopes,
//      the device's from its per-chunk mean squares (the logger records them
//      always), the source's from the WAV — finds every occurrence (r >= 0.4,
//      at least one sound length apart);
//   2. envelope refine: per chunk log energy vs the source over the same span,
//      1 ms steps within +-30 ms, separately on the first and the last 60 s of
//      the sound (two anchors -> the device / loudspeaker clock ratio);
//   3. PCM refine (when the PCM was logged): the click trains A and B by
//      sample-level cross-correlation with the source resampled to the
//      device rate.
// Result: fileToCt(t) / ctToFile(ct) for that occurrence.
import { ncc, nccPartial, parabolic } from "./sbs-dsp.mjs";

export const STEP = 0.01;
const lg = (x) => 10 * Math.log10(x + 1e-10);

export function sourceEnv(y, sr, step = STEP) {
  const n = Math.floor(y.length / (sr * step)), e = new Float64Array(n), L = Math.round(sr * step);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * L; j < (i + 1) * L; j++) s += y[j] * y[j]; e[i] = lg(s / L); }
  return floorEnv(e);
}
function floorEnv(e) {
  let mx = -Infinity; for (const v of e) if (v > mx) mx = v;
  for (let i = 0; i < e.length; i++) e[i] = Math.max(e[i], mx - 60);
  return e;
}
/** The device envelope on its audio clock: bin i covers [t0 + i*step, t0 + (i+1)*step). */
export function deviceEnv(seg, step = STEP) {
  const sr = seg.sr ?? 48000, C = seg.chunks;
  const t0 = C[0][1] - C[0][3] / sr, n = Math.ceil((seg.ct1 - t0) / step) + 1;
  const acc = new Float64Array(n), w = new Float64Array(n);
  for (const [, ct, ms, len] of C) {
    const a = ct - len / sr, b = ct, v = lg(ms);
    for (let i = Math.max(0, Math.floor((a - t0) / step)); i < n && t0 + i * step < b; i++) {
      const ov = Math.min(b, t0 + (i + 1) * step) - Math.max(a, t0 + i * step);
      if (ov > 0) { acc[i] += v * ov; w[i] += ov; }
    }
  }
  const e = new Float64Array(n);
  let last = -100;
  for (let i = 0; i < n; i++) { if (w[i] > 0) last = acc[i] / w[i]; e[i] = last; }
  return { env: floorEnv(e), t0, step };
}
/** Occurrences of the template (source env, from bin tb0) in the device env: [{ ct0 (device time of file 0), r }]. */
export function findSound(dev, src, { minR = 0.4, tb0 = 0, tb1 = src.length, minCover = 0.8 } = {}) {
  const tmpl = src.subarray(tb0, tb1);
  // partial overlap allowed (a sound that started just before the capture, or a capture cut short): >= minCover of the sound inside
  const { r, n, lag0 } = nccPartial(dev.env, tmpl, Math.ceil(minCover * tmpl.length));
  const out = [];
  const used = new Uint8Array(r.length);
  for (;;) {
    let bi = -1, bv = minR;
    for (let i = 0; i < r.length; i++) if (!used[i] && r[i] > bv) { bv = r[i]; bi = i; }
    if (bi < 0) break;
    const p = parabolic(r, bi);
    out.push({ ct0: dev.t0 + (p.x - lag0) * dev.step - tb0 * dev.step, r: bv, cover: n[bi] / tmpl.length });
    for (let i = Math.max(0, bi - tmpl.length); i < Math.min(r.length, bi + tmpl.length); i++) used[i] = 1;
    if (out.length >= 4) break;
  }
  return out.sort((a, b) => a.ct0 - b.ct0);
}
/** Per-chunk log energy vs the source's over the same file span; best ct0 within +-range (1 ms steps) using the chunks whose file time is in [from, to). */
export function refineChunks(seg, srcCs, srcSr, ct0, { from, to, range = 0.03, stepS = 0.001 } = {}) {
  const sr = seg.sr ?? 48000;
  const use = seg.chunks.filter((c) => c[1] - ct0 >= from && c[1] - ct0 < to);
  const ys = use.map((c) => lg(c[2]));
  const score = (c0) => {
    const xs = [], yy = [];
    for (let i = 0; i < use.length; i++) {
      const e = Math.round((use[i][1] - c0) * srcSr), s = e - Math.round((use[i][3] / sr) * srcSr);
      if (s < 0 || e >= srcCs.length) continue;
      xs.push(lg((srcCs[e] - srcCs[s]) / (e - s))); yy.push(ys[i]);
    }
    if (xs.length < 50) return -2;
    let mx = 0, my = 0; for (let i = 0; i < xs.length; i++) { mx += xs[i]; my += yy[i]; }
    mx /= xs.length; my /= xs.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { const a = Math.max(xs[i], -70) - mx, b = yy[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy + 1e-12);
  };
  let best = -3, bc = ct0;
  const sc = [];
  for (let d = -range; d <= range + 1e-9; d += stepS) { const s = score(ct0 + d); sc.push(s); if (s > best) { best = s; bc = ct0 + d; } }
  const bi = sc.indexOf(best), p = parabolic(sc, bi);
  return { ct0: ct0 - range + p.x * stepS, r: best, n: use.length, raw: bc };
}
export function cumsumSq(y) { const cs = new Float64Array(y.length + 1); for (let i = 0; i < y.length; i++) cs[i + 1] = cs[i] + y[i] * y[i]; return cs; }

/** Sample-level click-train match: device PCM around file span [t0, t1] (predicted with ct0) vs the source span resampled to the device rate. */
export async function pcmRefine(seg, srcY, srcSr, ct0, t0, t1, { resampleClip, slack = 0.12 } = {}) {
  const P = seg.pcm;
  if (!P) return null;
  const sr = P.sr;
  let tmpl = srcY.subarray(Math.round(t0 * srcSr), Math.round(t1 * srcSr));
  if (srcSr !== sr) tmpl = resampleClip(tmpl, srcSr, sr);
  const a = Math.round((ct0 + t0 - slack - P.startCt) * sr), b = Math.round((ct0 + t1 + slack - P.startCt) * sr);
  if (a < 0 || b > P.y.length) return null;
  const win = P.y.subarray(a, b);
  const r = ncc(win, tmpl);
  let bi = 0; for (let i = 1; i < r.length; i++) if (r[i] > r[bi]) bi = i;
  const p = parabolic(r, bi);
  // device time of file t0
  const ctAtT0 = P.startCt + (a + p.x) / sr;
  return { ct0: ctAtT0 - t0, r: r[bi] };
}

/**
 * Full alignment of one occurrence. man = the sound's manifest; srcY at man.sr.
 * Returns { ct0, k (device seconds per file second), fileToCt, ctToFile, method, anchors, envOnly }.
 */
export async function alignOccurrence(seg, srcY, man, coarse, { resampleClip } = {}) {
  const srcSr = man.sr, cs = cumsumSq(srcY), D = man.durS;
  const A = refineChunks(seg, cs, srcSr, coarse.ct0, { from: 0, to: 60 });
  const B = refineChunks(seg, cs, srcSr, coarse.ct0, { from: D - 60, to: D });
  const tA = 30, tB = D - 30;
  const env = { A, B, k: 1 + (B.ct0 - A.ct0) / (tB - tA) };
  let ct0 = A.ct0, k = env.k, method = "envelope";
  let pcm = null;
  if (seg.pcm && resampleClip) {
    const ca = man.clicks.A[0], cb = man.clicks.B[0], dur = man.clickPattern.at(-1) + 0.05;
    const pa = await pcmRefine(seg, srcY, srcSr, A.ct0, ca - 0.05, ca + dur, { resampleClip });
    const pb = await pcmRefine(seg, srcY, srcSr, B.ct0, cb - 0.05, cb + dur, { resampleClip });
    if (pa && pb && pa.r > 0.3 && pb.r > 0.3) {
      // pa.ct0 is the device time of file 0 assuming k = 1 near click A; the same near B
      const ctA = pa.ct0 + ca, ctB = pb.ct0 + cb;
      k = (ctB - ctA) / (cb - ca);
      ct0 = ctA - ca * k;
      method = "pcm-clicks";
      pcm = { A: pa, B: pb, k };
    }
  }
  const envCt0At = (t) => env.A.ct0 + (t - tA) * (env.k - 1) + 0; // envelope map's ct0 term at file time t
  return {
    ct0, k, method, env, pcm, coarse,
    fileToCt: (t) => ct0 + t * k,
    ctToFile: (ct) => (ct - ct0) / k,
    envFileToCt: (t) => envCt0At(t) + t,
  };
}

/** Offset between two captures of the same sound from their envelopes alone (no source): ctA = ctB + offset. Template = the middle span of B. */
export function crossOffset(segA, segB, { spanS = 120 } = {}) {
  const a = deviceEnv(segA), b = deviceEnv(segB);
  const n = Math.min(b.env.length, Math.round(spanS / b.step)), i0 = Math.max(0, Math.floor((b.env.length - n) / 2));
  const { r, lag0 } = nccPartial(a.env, b.env.subarray(i0, i0 + n), Math.ceil(0.9 * n));
  let bi = 0; for (let i = 1; i < r.length; i++) if (r[i] > r[bi]) bi = i;
  const p = parabolic(r, bi);
  // A time of the template's first bin - B time of it
  return { offset: a.t0 + (p.x - lag0) * a.step - (b.t0 + i0 * b.step), r: r[bi] };
}
