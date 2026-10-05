// wav.mjs — 16-bit PCM WAV reader (first channel) for the session oracle.
import { readFileSync } from "node:fs";
export function readWav(p) {
  const b = readFileSync(p);
  let o = 12, ds = 0, dz = 0, sr = 0, ch = 1, bits = 16;
  while (o < b.length - 8) {
    const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === "data") { ds = o + 8; dz = Math.min(sz, b.length - ds); break; }
    o += 8 + sz + (sz & 1);
  }
  if (bits !== 16) throw new Error(`${p}: only 16-bit PCM supported`);
  const n = Math.floor(dz / 2 / ch), s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(ds + i * 2 * ch) / 32768;
  return { samples: s, sr };
}
