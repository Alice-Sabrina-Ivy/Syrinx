// valdump.mjs — custom voice detector (2026-10-06): run the app's production
// chain over the VALIDATION streams of valsets.py (or the training negatives
// of mine.py) and write per-hop dumps in exactly the format of
// scripts/voice-detector/dump.mjs (same COLS, same hop / reference / label
// conventions), so the selection tool reads them with lib/streams.py.
//
// Stream specs: <val>/streams/<set>.json, items
//   { id, gender, audio: { path, fmt: "wav", sr, start, len }, crop?, holds,
//     ref: { kind: "praat", path, t0, hop } | { kind: "mix", layers: [{ at, len, from, ref: { path, t0, hop } }] } | { kind: "none" },
//     meta }
// The Praat tracks (.f32, 10 ms) are read with atPraat() of lib/sets.mjs;
// a mix reference is vinItems' truthMix (each voice layer's Praat F0 on the mix
// timeline, -1 outside every voice layer).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/train/valdump.mjs \
//        --set=vvoice|vmix20|vmix0|vneg|tneg [--val=build/vad-train/val] [--src=src] [--shard=i/n] [--skip-existing]
import { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { readWav } from "../../notch-adversarial/realdata/realdata.mjs";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../../session-oracle/lib/chain.mjs";

const COLS = ["paint", "ro", "style", "inten", "refd", "lab", "seg", "held"];
const LAB = { none: 0, correct: 1, false: 2, wrong: 3, edge: 4 };
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SET = args.set, SRC = args.src ?? "src";
const VALROOT = resolve(args.val ?? "build/vad-train/val");
if (!SET) throw new Error("--set=<name> required");
const OUT = resolve(VALROOT, "dumps", SET);
mkdirSync(OUT, { recursive: true });
let items = JSON.parse(readFileSync(join(VALROOT, "streams", `${SET}.json`), "utf8"));
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
items = items.filter((_, i) => i % shN === shI);
const S = await loadSrc(SRC);

const trackCache = new Map();
function track(r) {
  if (!trackCache.has(r.path)) {
    const b = readFileSync(r.path);
    trackCache.set(r.path, { t0: r.t0, hop: r.hop, f0: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) });
    if (trackCache.size > 64) trackCache.delete(trackCache.keys().next().value);
  }
  return trackCache.get(r.path);
}
const atPraat = (r, t) => { const i = Math.round((t - r.t0) / r.hop); return i >= 0 && i < r.f0.length ? r.f0[i] : 0; };
function refFn(it) {
  const R = it.ref;
  if (R.kind === "none") return () => -1;
  if (R.kind === "praat") { const f = track(R); return (t) => atPraat(f, t); }
  const crop = it.crop ?? 0;
  const layers = R.layers.map((L) => ({ L, f: track(L.ref) }));
  return (t) => {
    const tm = t + crop;
    let out = -1;
    for (const { L, f } of layers) {
      if (tm < L.at || tm > L.at + L.len) continue;
      out = atPraat(f, tm - L.at + (L.from ?? 0));
    }
    return out;
  };
}

// = dump.mjs labelCols
function labelCols(item, ref, col, n, hop, L) {
  const holds = item.holds ?? [];
  const v0 = item.meta.voice_t0, v1 = item.meta.voice_t1;
  for (let k = 0; k < n; k++) {
    const tk = (k + 1) * hop;
    const td = tk - 0.040 - L * hop - 0.030;
    const r = td >= 0 ? ref(td) : -1;
    col.refd[k] = r; col.seg[k] = 0; col.held[k] = 0;
    if (v0 !== undefined) col.seg[k] = td >= v0 && td <= v1 ? 2 : td > v1 + 0.5 ? 3 : (td >= 1.5 && td < v0 - 0.1 ? 1 : 0);
    for (const [h0, h1] of holds) if (td >= h0 + 0.3 && td <= h1 - 0.1) { col.held[k] = 1; break; }
    const p = col.paint[k];
    if (!(p > 0) || td < 0) { col.lab[k] = LAB.none; continue; }
    if (r > 0) { col.lab[k] = Math.abs(p / r - 1) < 0.05 ? LAB.correct : LAB.wrong; continue; }
    let near = false;
    for (let d = -0.1; d <= 0.1001 && !near; d += 0.025) { const t = td + d; if (t >= 0 && ref(t) > 0) near = true; }
    col.lab[k] = near ? LAB.edge : LAB.false;
  }
}

const t0 = Date.now();
let done = 0;
for (const item of items) {
  const fp = resolve(OUT, `${item.id}.f32`), jp = resolve(OUT, `${item.id}.json`);
  if (args["skip-existing"] && existsSync(fp) && existsSync(jp)) continue;
  const a = item.audio;
  const w = readWav(a.path);
  if (w.sampleRate !== a.sr) throw new Error(`${a.path}: ${w.sampleRate} Hz, spec says ${a.sr}`);
  const x = w.samples.subarray(a.start, a.start + a.len);
  if (x.length !== a.len) throw new Error(`${a.path}: shorter than the spec`);
  const W = runWorkers(S, x, a.sr);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const n = W.n, hop = W.C / a.sr, L = W.L;
  const col = Object.fromEntries(COLS.map((c) => [c, new Float32Array(n)]));
  col.paint.set(D.paint); col.ro.set(D.ro); col.style.set(D.style); col.inten.set(W.col.inten);
  labelCols(item, refFn(item), col, n, hop, L);
  const tbl = new Float32Array(n * COLS.length);
  COLS.forEach((c, i) => tbl.set(col[c], i * n));
  writeFileSync(fp + ".tmp", Buffer.from(tbl.buffer)); renameSync(fp + ".tmp", fp);
  writeFileSync(jp, JSON.stringify({
    set: SET, id: item.id, n, hop_s: hop, C: W.C, sr: a.sr, L, gender: item.gender, cols: COLS,
    audio: { ...a, len: n * W.C }, src: resolve(SRC), holds: item.holds ?? [], ...item.meta,
  }));
  done++;
  if (done % 50 === 0) console.log(`${SET} ${shI}/${shN}: ${done} of ${items.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
console.log(`${SET} ${shI}/${shN}: ${done} of ${items.length} streams dumped in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
