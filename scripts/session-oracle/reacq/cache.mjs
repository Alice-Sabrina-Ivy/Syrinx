// cache.mjs — run the REAL pitch + DSP workers once per stream and cache the
// per-chunk worker outputs, so display-gate variants can be replayed through
// the REAL hook without re-running the worker (the hook only consumes the
// pitch messages + DSP intensity).
// Usage: node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/reacq/cache.mjs
//   --set=sessions [--sessions=a,b] | --set=corpus --corpus=fda|ptdb|hil|voc [--shard=i/n]
//   | --set=wav --wav=PATH --name=NAME [--group=G]
//   [--src=src] [--out=build/reacq/cache]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readWav } from "../lib/wav.mjs";
import { loadSrc, DET_COLS } from "../lib/chain.mjs";

// runWorkers of lib/chain.mjs + octave-ambiguity margins of the DECODED
// candidate (observation only): for frame f decoded at d, ambH = r(d) -
// max r of candidates within +-1 st of d/2 (0 if none), ambD = r(d) - max r
// within +-1 st of 2d. Indexed like dec (detection index). msgKK[k] = the
// detection index the message consumed at chunk k describes.
function runWorkers(S, samples, sr, { chunkMs = 25 } = {}) {
  const C = Math.round(sr * chunkMs / 1000);
  const n = Math.floor(samples.length / C);
  const col = {};
  for (const c of DET_COLS) col[c] = new Float32Array(n);
  col.inten = new Float32Array(n).fill(NaN);
  const extra = { ambH: new Float32Array(n).fill(NaN), ambD: new Float32Array(n).fill(NaN), msgKK: new Float32Array(n).fill(-1) };
  const msgPitch = new Float32Array(n).fill(NaN);
  const msgConf = new Float32Array(n).fill(NaN);
  const { P, D } = S;
  const frameChunk = []; const frameCands = []; let L = null; let curK = -1;
  const near = (cands, f, tol) => { let b = -Infinity; for (const c of cands) if (Math.abs(12 * Math.log2(c.freq / f)) <= tol && c.r > b) b = c.r; return b; };
  globalThis.__SO_TAP = {
    tracker(t) { L = t.config.lookback; },
    cand(fc) {
      const v = fc.voiced;
      col.fl[curK] = v.length && v[0].strength > fc.unvoicedStrength ? v[0].freq : 0;
      col.c0f[curK] = v.length ? v[0].freq : 0;
      col.uv[curK] = fc.unvoicedStrength;
      frameChunk.push(curK);
      frameCands.push(v.map((c) => ({ freq: c.freq, r: c.r ?? c.strength })));
      if (frameCands.length > 8) frameCands[frameCands.length - 9] = null;
    },
    emit(d) {
      const fi = frameChunk.length - 1;
      if (L !== null && fi >= L) {
        const kk = frameChunk[fi - L];
        col.dec[kk] = d > 0 ? d : 0;
        const cs = frameCands[fi - L];
        if (d > 0 && cs) {
          const rd = near(cs, d, 0.5);
          const h = near(cs, d / 2, 1), dd = near(cs, d * 2, 1);
          extra.ambH[kk] = (Number.isFinite(rd) ? rd : 0) - (Number.isFinite(h) ? h : 0);
          extra.ambD[kk] = (Number.isFinite(rd) ? rd : 0) - (Number.isFinite(dd) ? dd : 0);
        }
      }
    },
  };
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  if (L === null) L = S.defaultLookback;
  globalThis.self = D; D.posts = [];
  D.onmessage({ data: { type: "init", sampleRate: sr } });
  const dp = {}; D.onmessage({ data: { type: "port", port: dp } });
  let busyNs = 0n, frames = 0;
  for (let k = 0; k < n; k++) {
    const ct = (k + 1) * C / sr;
    globalThis.self = P; curK = k; P.posts.length = 0;
    const a = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    const t0 = process.hrtime.bigint();
    pp.onmessage({ data: { buffer: a.buffer, contextTime: ct } });
    busyNs += process.hrtime.bigint() - t0;
    for (const m of P.posts) {
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker: ${m.message}`);
      if (m.type !== "pitch") continue;
      frames++;
      const kk = Math.round(m.contextTime * sr / C) - 1;
      col.post[kk] = m.pitch !== null ? m.pitch : 0;
      col.conf[kk] = m.confidence;
      col.nnotch[kk] = m.notchedFreqs ? m.notchedFreqs.length : 0;
      msgPitch[k] = m.pitch !== null ? m.pitch : 0; msgConf[k] = m.confidence; extra.msgKK[k] = kk;
    }
    globalThis.self = D; D.posts.length = 0;
    const b = Float32Array.from(samples.subarray(k * C, (k + 1) * C));
    dp.onmessage({ data: { buffer: b.buffer, contextTime: ct } });
    for (const m of D.posts) {
      if (m.type === "worker-error") throw new Error(`dsp worker: ${m.message}`);
      if (m.type === "analysis") col.inten[k] = m.data.intensity;
    }
  }
  globalThis.__SO_TAP = null;
  return { n, C, sr, L, col, extra, msgPitch, msgConf, cpu: { pitchMsPerChunk: Number(busyNs) / 1e6 / n, frames } };
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const OUT = resolve(args.out ?? "build/reacq/cache");
const S = await loadSrc(args.src ?? "src");
const COLS = ["msgPitch", "msgConf", "inten", ...DET_COLS, ...(globalThis.__SO_EXTRA_COLS || [])];

export function pack(W) {
  const cols = { msgPitch: W.msgPitch, msgConf: W.msgConf, inten: W.col.inten };
  for (const c of DET_COLS) cols[c] = W.col[c];
  for (const c of Object.keys(W.extra || {})) cols[c] = W.extra[c];
  const names = Object.keys(cols);
  const tbl = new Float32Array(W.n * names.length);
  names.forEach((c, i) => tbl.set(cols[c], i * W.n));
  return { names, buf: Buffer.from(tbl.buffer) };
}

function save(dir, name, W, meta = {}) {
  mkdirSync(dir, { recursive: true });
  const { names, buf } = pack(W);
  writeFileSync(resolve(dir, `${name}.bin`), buf);
  writeFileSync(resolve(dir, `${name}.json`), JSON.stringify({ name, n: W.n, C: W.C, sr: W.sr, L: W.L, cols: names, cpu: W.cpu, ...meta }));
}

const t0 = Date.now();
if (args.set === "sessions") {
  const ROOT = args["sessions-root"] ?? process.env.SYRINX_SESSIONS_DIR;
  if (!ROOT) throw new Error("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)");
  for (const s of (args.sessions ?? "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")) {
    const { samples, sr } = readWav(`${ROOT}/${s}/session.wav`);
    const W = runWorkers(S, samples, sr);
    save(resolve(OUT, "sessions"), s, W, { wav: `${ROOT}/${s}/session.wav` });
    console.log(`${s}: ${W.n} hops ${(Date.now() - t0) / 1000}s`);
  }
} else if (args.set === "corpus") {
  const { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } = await import("../../../tests/dsp/data/corpora.js");
  const SETS = { fda: [loadFda, 0], ptdb: [loadPtdbTug, 20], hil: [loadHillenbrand, 0], voc: [loadVocadito, 0] };
  const corpus = args.corpus; const [loader, off] = SETS[corpus];
  const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
  const tracks = loader().filter((_, i) => i % shN === shI);
  const dir = resolve(OUT, "corpus", corpus);
  for (const [i, tr] of tracks.entries()) {
    const W = runWorkers(S, tr.samples, tr.sampleRate);
    const gs = corpus === "voc" ? (tr.trackId === "vocadito_34" ? ["voc", "v34"] : ["voc"]) : [`${corpus}_${tr.gender === "w" ? "f" : tr.gender}`];
    const name = `${shI}of${shN}_${String(i).padStart(4, "0")}`;
    save(dir, name, W, { groups: gs, off, refHopMs: tr.ref.hopMs, ref: Array.from(tr.ref.f0), id: tr.trackId ?? tr.id ?? tr.file ?? null });
  }
  console.log(`${corpus} ${shI}/${shN}: ${tracks.length} tracks ${(Date.now() - t0) / 1000}s`);
} else if (args.set === "dir") {
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(args.dir).filter((f) => f.endsWith(".wav")).sort();
  const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
  for (const [i, f] of files.entries()) {
    if (i % shN !== shI) continue;
    const { samples, sr } = readWav(resolve(args.dir, f));
    const W = runWorkers(S, samples, sr);
    save(resolve(OUT, args.group), f.slice(0, -4), W, { wav: resolve(args.dir, f) });
  }
  console.log(`dir ${args.dir} ${shI}/${shN}: ${(Date.now() - t0) / 1000}s`);
} else if (args.set === "wav") {
  const { samples, sr } = readWav(args.wav);
  const W = runWorkers(S, samples, sr);
  save(resolve(OUT, args.group ?? "wav"), args.name, W, { wav: args.wav });
  console.log(`${args.name}: ${W.n} hops ${(Date.now() - t0) / 1000}s`);
}
