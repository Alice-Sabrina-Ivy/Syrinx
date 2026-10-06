// noise-floor-guard.js — learned-background voicing veto for the pitch worker
// (2026-10-05, measurements/realnoise-false-voicing-attribution-2026-10-05.md).
//
// Why: on real machine / room noise the detector finds periodicity on about
// half of all noise-only frames, and the harmonic guard passes stacked machine
// harmonics by construction (they ARE harmonic). The persistent-peak notch
// removes only narrow lines it tracks for >= 5 s at >= 90 % duty; wobbling,
// flickering, many-line and above-460-Hz periodicity reach the display (real
// noise-only clips: 14 % of frames posted voiced, 24 % painted incl. the
// pitch-hold bridge). What a voice adds that a stationary background does not
// is ENERGY AT ITS HARMONICS ABOVE WHAT THE ROOM HAS RECENTLY SHOWN at those
// frequencies. A decoded frame whose harmonic comb (h f0, h = 1..8) nowhere
// rises >= excessDb above the learned background spectrum is the background
// itself.
//
// Background spectrum (minimum statistics, Martin 2001 in spirit):
//   P_k     power spectrum of the analysis buffer of chunk k (the post-notch
//           80 ms frame the detector sees), Hann, fftSize-point FFT, 0-4 kHz
//   SF_k    mean of P over the last smoothFrames frames
//   N(b)    minimum of SF over the last windowFrames frames (60 s, block
//           minima of 1 s)
// Only background windows enter the minimum: SF is fed when all smoothFrames
// frames it averages were posted UNVOICED (the frames the worker itself called
// background, before this guard). A voice therefore never becomes its own
// background by being voiced — repeated holds with short breaths and holds
// longer than the window keep the background learned between phonations.
// Two more ways a voice could teach itself are closed:
//   - frames this guard vetoes do not count as background (a vetoed voice
//     would otherwise become its own background and stay vetoed);
//   - the floor is USED only while the window holds at least one "anchor"
//     window: frames unvoiced already BEFORE the harmonic guard (the tracker
//     decoded them unvoiced, or they decoded above range / at a notched
//     line). Frames only the harmonic guard removed — e.g. a breathy note
//     sung from the stream start whose H1 the notch took — may join the
//     minimum once the room has been heard, never found it.
// Until a background is known the guard passes everything (fail open), also
// in the stream's first warmFrames.
//
// check(f0) for a decoded frame: count h = 1..8 (h f0 <= maxHarmHz) whose
// peak power within +-min(3 % h f0, 0.2 f0) is >= excessDb over N; the frame
// passes when count >= minHarmonics. Like the harmonic guard, voicing is
// vetoed only after `debounce` CONSECUTIVE failing checks (unvoiced frames
// neither advance nor reset the streak).
//
// Cost per chunk: one fftSize-point real FFT + O(bins) updates; check() is
// O(bins x blocks) only on decoded-voiced frames.

export const NOISE_FLOOR_GUARD_DEFAULTS = {
  fftSize: 2048,        // 7.8 Hz bins at 16 kHz (the 80 ms frame zero-padded)
  maxHz: 4000,          // spectrum kept 0-4 kHz
  maxHarmHz: 3800,      // harmonics checked up to here
  harmonics: 8,
  smoothFrames: 16,     // SF = 400 ms moving average of P
  windowFrames: 2400,   // background minimum over the last 60 s (20 s measured
                        //   worse for voice: a voice the detector misses at
                        //   0 dB SNR is "unvoiced" and can enter the background
                        //   once the pre-voice background ages out)
  blockFrames: 40,      // minimum statistics in 1 s blocks
  warmFrames: 80,       // fail open for the first 2 s of a stream
  excessDb: 14,
  minHarmonics: 1,
  debounce: 4,
};

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vRe = re[b] * cRe - im[b] * cIm;
        const vIm = re[b] * cIm + im[b] * cRe;
        re[b] = re[a] - vRe; im[b] = im[a] - vIm;
        re[a] += vRe; im[a] += vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

// createNoiseFloorGuard(sampleRate, opts): one instance per stream.
//   observe(buffer)  every analysed chunk, with the analysis buffer the
//                    detector just ran on (frame index = call count)
//   check(f0)        for the DECODED frame (lagFrames behind the newest
//                    observed frame): true = keep voiced, false = veto
//   decided(voiced, anchor)  for every decoded frame, in order: voiced =
//                    the worker's verdict BEFORE this guard (after the
//                    detector, tracker, ghost veto, range null and harmonic
//                    guard); anchor = the frame was unvoiced already before
//                    the harmonic guard (default: !voiced)
export function createNoiseFloorGuard(sampleRate, opts = {}) {
  const cfg = { ...NOISE_FLOOR_GUARD_DEFAULTS, ...opts };
  const N = cfg.fftSize;
  const binHz = sampleRate / N;
  const NB = Math.min(N / 2, Math.ceil(cfg.maxHz / binHz) + 2);
  const lag = cfg.lagFrames ?? 2;
  const ringLen = cfg.smoothFrames + lag + 2;
  const P = Array.from({ length: ringLen }, () => new Float64Array(NB)); // P of frame j at j % ringLen
  const nBlk = Math.max(1, Math.round(cfg.windowFrames / cfg.blockFrames));
  const blk = new Float64Array(nBlk * NB).fill(Infinity);
  const blkFed = new Uint8Array(nBlk);       // block received a background spectrum
  const blkAnchor = new Uint8Array(nBlk);    // ... from an anchor window
  const floor = new Float64Array(NB);
  const re = new Float64Array(N), im = new Float64Array(N);
  let win = null;
  let frame = -1;          // newest observed frame index
  let blkPos = 0, blkCount = 0;
  let cleanRun = 0;        // consecutive decoded frames unvoiced before this guard
  let anchorRun = 0;       // consecutive decoded frames unvoiced before the harmonic guard
  let decodedIdx = -1;     // index of the last decided frame
  let streak = 0;

  function blockTick() {
    if (++blkCount >= cfg.blockFrames) {
      blkCount = 0;
      blkPos = (blkPos + 1) % nBlk;
      blk.fill(Infinity, blkPos * NB, (blkPos + 1) * NB);
      blkFed[blkPos] = 0;
      blkAnchor[blkPos] = 0;
    }
  }
  function feedFloor(sf, anchor) {
    const o = blkPos * NB;
    for (let b = 0; b < NB; b++) if (sf[b] < blk[o + b]) blk[o + b] = sf[b];
    blkFed[blkPos] = 1;
    if (anchor) blkAnchor[blkPos] = 1;
  }

  function observe(buffer) {
    const n = buffer.length;
    if (!win || win.length !== n) {
      win = new Float64Array(n);
      for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    frame++;
    re.fill(0); im.fill(0);
    const m = Math.min(n, N);
    for (let i = 0; i < m; i++) re[i] = buffer[n - m + i] * win[n - m + i];
    fftInPlace(re, im);
    const cur = P[frame % ringLen];
    for (let b = 0; b < NB; b++) cur[b] = re[b] * re[b] + im[b] * im[b] + 1e-20;
    blockTick();
  }

  function decided(voiced, anchor = !voiced) {
    decodedIdx++;
    cleanRun = voiced ? 0 : cleanRun + 1;
    anchorRun = anchor ? anchorRun + 1 : 0;
    if (cleanRun >= cfg.smoothFrames) {
      // frames decodedIdx - smoothFrames + 1 .. decodedIdx were all background
      const sf = floor; // scratch
      sf.fill(0);
      for (let j = decodedIdx - cfg.smoothFrames + 1; j <= decodedIdx; j++) {
        const p = P[((j % ringLen) + ringLen) % ringLen];
        for (let b = 0; b < NB; b++) sf[b] += p[b];
      }
      for (let b = 0; b < NB; b++) sf[b] /= cfg.smoothFrames;
      feedFloor(sf, anchorRun >= cfg.smoothFrames);
    }
  }

  function check(f0) {
    const fr = frame - lag;               // the decoded frame
    // fail open: warm-up, or no anchored background within the window (a
    // stream voiced throughout, or one whose background windows aged out)
    if (fr < cfg.warmFrames || !(f0 > 0) || !blkAnchor.some((v) => v)) { return pass(); }
    for (let b = 0; b < NB; b++) {
      let mn = Infinity;
      for (let k = 0; k < nBlk; k++) { const v = blk[k * NB + b]; if (v < mn) mn = v; }
      floor[b] = mn;
    }
    const p = P[fr % ringLen];
    const thr = Math.pow(10, cfg.excessDb / 10);
    let count = 0;
    for (let h = 1; h <= cfg.harmonics; h++) {
      const f = h * f0;
      if (f > cfg.maxHarmHz) break;
      const half = Math.min(0.03 * f, 0.2 * f0);
      const lo = Math.max(1, Math.floor((f - half) / binHz)), hi = Math.min(NB - 1, Math.ceil((f + half) / binHz));
      for (let b = lo; b <= hi; b++) {
        if (floor[b] < Infinity && p[b] >= thr * floor[b]) { count++; break; }
      }
      if (count >= cfg.minHarmonics) return pass();
    }
    streak++;
    return streak < cfg.debounce;
  }
  function pass() { streak = 0; return true; }

  return { observe, check, decided, config: cfg };
}
