// sbs-load.mjs — read one device's run folder of the phone-vs-headset kit
// (sbs-session.mjs / sbs-phone.mjs / sbs-desktop.mjs) into arrays, split
// into capture segments (one per getUserMedia start: contextTime runs on
// within a segment), with each segment's audio-clock -> page-wall map and
// its PCM.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { linfit } from "./sbs-dsp.mjs";

const jl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

export function loadDevice(dir) {
  const meta = existsSync(path.join(dir, "meta.json")) ? JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) : {};
  const pulls = jl(path.join(dir, "log.jsonl"));
  const rows = { chunk: [], pitch: [], dsp: [], state: [], wstat: [], worker: [], dom: [], samp: [], lt: [], gum: [], err: [] };
  const docs = [];
  for (const p of pulls) {
    if (!docs.includes(p.id)) docs.push(p.id);
    for (const k of Object.keys(rows)) for (const r of p.rows[k] ?? []) rows[k].push(Array.isArray(r) ? r : { ...r, doc: p.id });
  }
  const drops = pulls.length ? pulls[pulls.length - 1].drops : {};
  const pcmDropped = pulls.length ? pulls[pulls.length - 1].pcmDropped : 0;
  const clock = jl(path.join(dir, "clock.jsonl"));
  // PCM: chunk index + samples
  let pcm = null;
  const pf = path.join(dir, "pcm.f32");
  if (existsSync(pf)) {
    const b = readFileSync(pf);
    const all = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
    const idx = [];
    for (const e of jl(path.join(dir, "pcm.jsonl"))) { let o = e.off; for (const [ct, len] of e.idx) { idx.push({ ct, len, off: o }); o += len; } }
    pcm = { all, idx };
  }
  // sort by page wall
  rows.chunk.sort((a, b) => a[0] - b[0]);
  for (const k of ["pitch", "dsp", "dom", "samp", "lt"]) rows[k].sort((a, b) => a[0] - b[0]);
  rows.state.sort((a, b) => a.a - b.a);
  return { dir, meta, pulls: pulls.length, docs, rows, drops, pcmDropped, clock, pcm, segments: segmentCaptures(rows.chunk, pcm) };
}

/** Capture segments: a new one whenever contextTime goes back or jumps > 2 s. */
export function segmentCaptures(chunks, pcm) {
  const segs = [];
  let cur = null;
  for (const c of chunks) {
    const [wall, ct, ms, len] = c;
    if (!cur || ct < cur.lastCt - 1e-6 || ct - cur.lastCt > 2) { cur = { chunks: [], lastCt: ct }; segs.push(cur); }
    cur.chunks.push(c); cur.lastCt = ct;
  }
  for (const s of segs) {
    const C = s.chunks;
    s.ct0 = C[0][1]; s.ct1 = C[C.length - 1][1];
    s.wall0 = C[0][0]; s.wall1 = C[C.length - 1][0];
    // sample rate from lengths over contextTime
    const lens = C.map((c) => c[3]);
    s.chunkLen = lens.sort((a, b) => a - b)[lens.length >> 1];
    const span = s.ct1 - s.ct0, nS = C.slice(1).reduce((a, c) => a + c[3], 0);
    s.sr = span > 1 ? Math.round(nS / span / 50) * 50 : null;
    // holes: contextTime steps > 1.5 chunk durations
    const dur = s.sr ? s.chunkLen / s.sr : 0.025;
    s.holes = [];
    for (let i = 1; i < C.length; i++) { const d = C[i][1] - C[i - 1][1]; if (d > 1.5 * dur) s.holes.push({ ct: C[i - 1][1], gapS: d - dur }); }
    // audio clock -> page wall: the lower envelope of (wall - ct*1000) (the fastest dispatch), per 10 s window, fitted by a line
    const xs = [], ys = [];
    const win = 10;
    for (let t = s.ct0; t <= s.ct1; t += win) {
      let m = Infinity;
      for (const c of C) if (c[1] >= t && c[1] < t + win) m = Math.min(m, c[0] - c[1] * 1000);
      if (Number.isFinite(m)) { xs.push(t + win / 2); ys.push(m); }
    }
    const f = xs.length >= 2 ? linfit(xs, ys) : { a: ys[0] ?? 0, b: 0 };
    s.wallOfCt = (ct) => ct * 1000 + f.a + f.b * ct;
    s.ctOfWall = (w) => (w - f.a) / (1000 + f.b);
    s.clockFit = { a: f.a, bPpm: f.b * 1000, windows: xs.length };
    // dispatch lag over the floor (ms)
    s.dispatchLag = C.map((c) => c[0] - s.wallOfCt(c[1]));
    // PCM of this segment (contiguous float32, zero-filled holes), aligned to chunk end times
    if (pcm && pcm.idx.length) {
      const P = pcm.idx.filter((e) => e.ct >= s.ct0 - 1e-9 && e.ct <= s.ct1 + 1e-9);
      if (P.length && s.sr) {
        const startCt = P[0].ct - P[0].len / s.sr; // the first sample's audio time
        const n = Math.round((P[P.length - 1].ct - startCt) * s.sr);
        const y = new Float32Array(n);
        for (const e of P) {
          const o = Math.round((e.ct - startCt) * s.sr) - e.len;
          for (let i = 0; i < e.len; i++) if (o + i >= 0 && o + i < n) y[o + i] = pcm.all[e.off + i];
        }
        s.pcm = { y, startCt, sr: s.sr, chunks: P.length };
      }
    }
    delete s.lastCt;
  }
  return segs;
}

/** Device page wall -> PC wall (ms), from the clock syncs (linear between start and end). */
export function pcOfDevWall(clock) {
  const c = clock.filter((x) => x && Number.isFinite(x.offset)).sort((a, b) => a.pc - b.pc);
  if (!c.length) return (w) => w;
  if (c.length === 1) return (w) => w - c[0].offset;
  const a = c[0], b = c[c.length - 1];
  const slope = (b.offset - a.offset) / (b.pc - a.pc || 1);
  return (w) => { const pc0 = w - a.offset; return w - (a.offset + slope * (pc0 - a.pc)); };
}
export function loadSession(dir) {
  const s = JSON.parse(readFileSync(path.join(dir, "session.json"), "utf8"));
  const devices = {};
  for (const n of ["phone", "desktop"]) if (existsSync(path.join(dir, n, "log.jsonl"))) devices[n] = loadDevice(path.join(dir, n));
  return { session: s, devices };
}
