// timing-wav.mjs — the fake-mic WAV for the browser timing runs (timing-run.mjs).
//
//   node scripts/resonance/mobile/timing-wav.mjs --readers=dev__174,dev__84 --out=build/resonance-mobile/timing/wav/set1.wav
//
// Per reader five 54 s blocks spliced from the shared WORLD renders
// (build/resonance-mobile/streams/v/<id>__{N,U10,D10}.f32, 48 kHz float32,
// time-aligned renders of the same reading), 10 ms crossfades at every join
// (faster.mjs splice: ±5 ms linear):
//   A  N 0-18 | U10 18-36 | N 36-54          long up @18, long down @36
//   E  N 0-18 | D10 18-36 | N 36-54          long down @18, long up @36
//   B  N | U10 18-21 | N | D10 34-39 | N      3 s up excursion, 5 s down excursion
//   C  N | D10 18-21 | N | U10 34-39 | N      3 s down, 5 s up
//   D  N | U10 18-26 | N | D10 38-46 | N      8 s up, 8 s down
// Written as 48 kHz 16-bit mono PCM (Chrome's --use-file-for-fake-audio-capture
// plays it and loops it). A manifest <out>.json lists every event in file time.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000;
const ids = arg("readers", "dev__174,dev__84").split(",");
const out = path.resolve(repo, arg("out", "build/resonance-mobile/timing/wav/set1.wav"));
const L = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8"));
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

const BLOCKS = {
  A: [["N", 0], ["U10", 18], ["N", 36]],
  E: [["N", 0], ["D10", 18], ["N", 36]],
  B: [["N", 0], ["U10", 18], ["N", 21], ["D10", 34], ["N", 39]],
  C: [["N", 0], ["D10", 18], ["N", 21], ["U10", 34], ["N", 39]],
  D: [["N", 0], ["U10", 18], ["N", 26], ["D10", 38], ["N", 46]],
};
const ORDER = ["A", "B", "C", "D", "E"];
const BLOCK_S = 54;

function spliceBlock(vars, segs) {
  const n = BLOCK_S * SR, y = new Float32Array(n), X = Math.round(0.005 * SR);
  const joins = segs.slice(1).map((s) => Math.round(s[1] * SR));
  for (let i = 0; i < n; i++) {
    // segment index by joins, crossfade within ±X of a join
    let k = 0;
    while (k < joins.length && i >= joins[k] + X) k++;
    if (k < joins.length && i >= joins[k] - X) {
      const a = (i - (joins[k] - X)) / (2 * X);
      y[i] = (1 - a) * vars[segs[k][0]][i] + a * vars[segs[k + 1][0]][i];
    } else y[i] = vars[segs[k][0]][i];
  }
  return y;
}

const parts = [], events = [], blocks = [];
let t0 = 0;
for (const id of ids) {
  const r = L.readers.find((x) => x.id === id);
  if (!r) throw new Error(`reader ${id} not in readers-dev.json`);
  const vars = Object.fromEntries(["N", "U10", "D10"].map((v) => [v, readF32(r.variants[v])]));
  for (const b of ORDER) {
    const segs = BLOCKS[b];
    parts.push(spliceBlock(vars, segs));
    blocks.push({ reader: id, sex: r.sex, block: b, t0, segs: segs.map(([v, s], i) => ({ v, s: t0 + s, e: t0 + (segs[i + 1]?.[1] ?? BLOCK_S) })) });
    // events: every join; long = the A / E 18 s segments, exc = the shorter ones
    for (let i = 1; i < segs.length; i++) {
      const [v, s] = segs[i], [pv] = segs[i - 1];
      const e = segs[i + 1]?.[1] ?? BLOCK_S;
      const level = (x) => (x === "U10" ? 1 : x === "D10" ? -1 : 0);
      const dir = level(v) > level(pv) ? "up" : "down";
      if (b === "A" || b === "E") events.push({ reader: id, sex: r.sex, block: b, kind: "long", dir, from: pv, to: v, ts: t0 + s, te: t0 + e });
      else if (v !== "N") events.push({ reader: id, sex: r.sex, block: b, kind: "exc", dir, to: v, dur: e - s, ts: t0 + s, te: t0 + e, after: t0 + e + 3 });
    }
    t0 += BLOCK_S;
  }
}
const n = parts.reduce((a, p) => a + p.length, 0);
const pcm = Buffer.alloc(44 + n * 2);
let peak = 0, clipped = 0, o = 44;
for (const p of parts) for (let i = 0; i < p.length; i++) {
  const v = p[i];
  peak = Math.max(peak, Math.abs(v));
  let q = Math.round(v * 32767);
  if (q > 32767) { q = 32767; clipped++; } else if (q < -32768) { q = -32768; clipped++; }
  pcm.writeInt16LE(q, o); o += 2;
}
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(n * 2, 40);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, pcm);
writeFileSync(out.replace(/\.wav$/, ".json"), JSON.stringify({ wav: out, sr: SR, durS: n / SR, readers: ids, blocks, events }, null, 1));
console.log(`${out}: ${(n / SR).toFixed(1)} s, peak ${peak.toFixed(3)}, clipped ${clipped}, ${events.length} events`);
