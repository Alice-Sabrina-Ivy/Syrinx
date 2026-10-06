// replay.mjs — re-drive the REAL main-thread display decision
// (useAudioPipeline.js handleAnalysisResult) of any src tree over the worker
// columns of existing attr.mjs dumps (2026-10-05). The display layer
// (pitchGate.js / pitchSmoothing.js / pitchPaintGate.js / the hook) feeds
// nothing back to the workers, so a display candidate's painted trace is
// exactly what the full chain would paint — checked by replaying the dumps'
// own src tree (--parity: paint / ro / style must match bit for bit).
//
// Messages are rebuilt as lib/chain.mjs runWorkers posts them: once the
// detector runs (uv > 0 from frame f0), the pitch worker posts one message
// per chunk from chunk f0 + L on, describing frame k - L (pitch = post[k - L],
// confidence = conf[k - L]).
//
//   node --import ./scripts/realnoise-fv/lib/register.mjs scripts/realnoise-fv/replay.mjs \
//        --from=TAG --set=noise --src=<tree>/src --tag=NEWTAG [--parity] [--attr=build/realnoise-fv/attr] [--ids=a,b]
//        [--in=<attr root>/<TAG> --out=<attr root>/<NEWTAG>]  (instead of --attr/--from/--tag)
// Writes <attr>/<NEWTAG>/<set>/ dumps: every column copied from TAG, display
// columns (msg / paint / ro / style) replaced. Gender column gv is copied
// unchanged (the display does not feed the gender worker). The DSP worker's
// cpp / hnr / tilt columns, when the dump has them, reach the hook as in
// production (2026-10-06).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const ATTR = resolve(args.attr ?? "build/realnoise-fv/attr");
const SET = args.set ?? "noise";
const IN = args.in ? resolve(args.in, SET) : resolve(ATTR, args.from, SET);
const OUT = args.out ? resolve(args.out, SET) : resolve(ATTR, args.tag ?? `${args.from}_replay`, SET);
const S = await loadSrc(args.src ?? "src");
mkdirSync(OUT, { recursive: true });
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const only = args.ids ? new Set(args.ids.split(",")) : null; // --ids=a,b: these streams only
const names = readdirSync(IN).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort()
  .filter((nm) => !only || only.has(nm)).filter((_, i) => i % shN === shI);
let mism = 0;
for (const nm of names) {
  const m = JSON.parse(readFileSync(resolve(IN, `${nm}.json`), "utf8"));
  const buf = readFileSync(resolve(IN, `${nm}.f32`));
  const tbl = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const n = m.n, col = {};
  m.cols.forEach((c, i) => { col[c] = tbl.subarray(i * n, (i + 1) * n); });
  const L = m.L;
  let f0 = -1;
  for (let k = 0; k < n; k++) if (col.uv[k] > 0) { f0 = k; break; }
  const msgPitch = new Float32Array(n).fill(NaN), msgConf = new Float32Array(n).fill(NaN);
  if (f0 >= 0) for (let k = f0 + L; k < n; k++) { msgPitch[k] = col.post[k - L]; msgConf[k] = col.conf[k - L]; }
  const sr = m.sr ?? ({ fda: 20000, ptdb: 48000, voc: 44100 }[SET] ?? 16000), C = Math.round(sr * 0.025);
  const W = { n, C, sr, L, col: { inten: col.inten, cpp: col.cpp, hnr: col.hnr, tilt: col.tilt }, msgPitch, msgConf };
  const D = await driveHook(S.hookPath, buildFrames(W), n);
  if (args.parity) {
    for (const c of ["paint", "ro", "style"]) for (let k = 0; k < n; k++) if (col[c][k] !== D[c][k]) { mism++; break; }
  }
  for (const c of ["msg", "paint", "ro", "style"]) col[c].set(D[c]);
  // paintF (final trace entry value; = paint unless the display fills
  // entries late) is appended when the source dump has no such column.
  const cols = m.cols.includes("paintF") ? m.cols : [...m.cols, "paintF"];
  const out = new Float32Array(n * cols.length);
  cols.forEach((c, i) => out.set(c === "paintF" ? D.paintF : col[c], i * n));
  writeFileSync(resolve(OUT, `${nm}.f32`), Buffer.from(out.buffer));
  writeFileSync(resolve(OUT, `${nm}.json`), JSON.stringify({ ...m, cols, replayFrom: args.from ?? args.in, src: args.src ?? "src" }));
}
console.log(`replay ${args.from ?? args.in} -> ${args.tag ?? args.out} ${SET}: ${names.length} streams${args.parity ? `, ${mism} column mismatches` : ""}`);
