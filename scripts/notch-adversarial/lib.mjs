// lib.mjs — drive the REAL pitch worker (2026-10-04 notch iteration round 1,
// adversarial suite). Each tree under build/notch-adv/trees/<name>/src
// (built by setup.sh) is a copy of src/ whose dsp/noise-notch.js is:
//   bc42 = bc42ad0's module, head = 6f8be18's (the in-sound latch, reverted
//   in round 1), r1 = cb00425's (round 1, N13), cand2 = cand2-notch.js
//   (round 2 option flags), cand3 = cand3-notch.js (2026-10-05 line-coherence
//   candidate flags), cand = cand-notch.js (option flags; globalThis.__NOTCH_OPTS
//   selects the variant), and SRC = the repo's src/ (the shipped module).
// Every pitch-worker.js copy is otherwise byte-identical to production.
import { pathToFileURL, fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../../src/audio/pitchSmoothing.js";
import { createPaintGate } from "../../src/audio/pitchPaintGate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
const H = {}, NOTCH = {}, RESAMP = {};
// NOTCH_ADV_TREES=name=path[,name=path...] (paths relative to the repo root)
// REPLACES the fixed tree list below: run the suite on any src trees, e.g.
// another work item's candidate trees (build/rnfv-trees/{base0,fgA}/src).
// Every listed name is also a variant { tree: name } (variants.mjs).
const TREES = process.env.NOTCH_ADV_TREES
  ? process.env.NOTCH_ADV_TREES.split(",").map((s) => s.split("=")).map(([k, p]) => [k, path.resolve(ROOT, p)])
  : [["bc42", "../../build/notch-adv/trees/bc42/src"], ["head", "../../build/notch-adv/trees/head/src"], ["cand", "../../build/notch-adv/trees/cand/src"], ["r1", "../../build/notch-adv/trees/r1/src"], ["cand2", "../../build/notch-adv/trees/cand2/src"], ["cand3", "../../build/notch-adv/trees/cand3/src"], ["src", "../../src"]].map(([k, p]) => [k, path.resolve(HERE, p)]);
for (const [k, p] of TREES) {
  await import(pathToFileURL(path.join(p, "dsp/pitch-worker.js")).href);
  H[k] = globalThis.self.onmessage;
  // the SAME module instances the worker imported (memo below)
  NOTCH[k] = await import(pathToFileURL(path.join(p, "dsp/noise-notch.js")).href);
  RESAMP[k] = await import(pathToFileURL(path.join(p, "ml/audio-utils.js")).href);
}

// ---- notch-level memo (2026-10-05 follow-up) --------------------------------
// The pitch worker is a deterministic function of what its notch hands it:
// per chunk the notched 16 kHz samples (-> the AC buffer), activeLines() (the
// ghost veto) and activeFreqs() (posted as notchedFreqs). notchSignature()
// runs ONLY the variant's notch, exactly as the worker drives it (the tree's
// streaming resampler, 25 ms chunks), and hashes those three per chunk. Two
// variants with the same signature on the same audio get byte-identical worker
// messages, so runWorker() runs the full worker once per distinct signature
// (a notch-only pass is ~25 % of a worker run). NOTCH_MEMO=0 disables it;
// memo-check.mjs verifies memo == no memo message for message.
const MEMO = process.env.NOTCH_MEMO !== "0";
function mix32(h, v) { h ^= v; h = Math.imul(h, 0x01000193) >>> 0; return h; }
const memo = new WeakMap(); // x -> Map(signature -> msgs)
// (the source is hashed without CRs: bc42's module comes from `git show`, LF,
// the others are CRLF working copies of the same function — 2026-10-06)
const VETO = Object.fromEntries(Object.entries(NOTCH).map(([k, m]) => [k, [...String(m.isNearNotch).replace(/\r/g, "")].reduce((h, ch) => mix32(h, ch.charCodeAt(0)), 0x811c9dc5).toString(16)]));
// onChunk(tEnd, activeFreqs) (optional, 2026-10-06): called after every chunk
// with the chunk's end time (s) and the notch's active frequencies — exactly
// the worker's notchedFreqs for that chunk (offsets.mjs: per-line notch times)
export function notchSignature(variant, x, sr, onChunk = null) {
  globalThis.__NOTCH_OPTS = variant.opts;
  const nt = NOTCH[variant.tree].createNoiseNotch(16000);
  const rs = RESAMP[variant.tree].createStreamingResampler(sr, 16000);
  globalThis.__NOTCH_OPTS = undefined;
  const C = Math.round(0.025 * sr);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  const f64 = new Float64Array(1), u64 = new Uint32Array(f64.buffer);
  for (let c = 0; c + C <= x.length; c += C) {
    const out = nt.process(rs(Float32Array.from(x.subarray(c, c + C))));
    const u = new Uint32Array(out.buffer, out.byteOffset, out.length);
    for (let i = 0; i < u.length; i++) { h1 = mix32(h1, u[i]); h2 = mix32(h2, u[i] ^ i); }
    for (const ln of nt.activeLines()) for (const v of [ln.freq, ln.dev]) { f64[0] = v; h1 = mix32(h1, u64[0]); h1 = mix32(h1, u64[1]); h2 = mix32(h2, u64[1] ^ 0x5bd1e995); h2 = mix32(h2, u64[0]); }
    for (const f of nt.activeFreqs()) { f64[0] = f; h1 = mix32(h1, u64[0] ^ 0xa5a5a5a5); h2 = mix32(h2, u64[1]); }
    if (onChunk) onChunk((c + C) / sr, nt.activeFreqs());
    h1 = mix32(h1, 0xffffffff); h2 = mix32(h2, c);
  }
  // + the tree's ghost-veto test (isNearNotch), which the worker also imports
  return `${sr}:${h1.toString(16)}:${h2.toString(16)}:${x.length}:${VETO[variant.tree]}`;
}

// NOTCH_SCAN=A:B (scan mode, 2026-10-05 follow-up): runWorker() runs NO
// worker; it compares the notch signatures of variants A and B on the audio
// it was given, appends {argv, call, sr, n, same} to NOTCH_SCAN_OUT and
// returns one dummy message (the calling script's rows are meaningless). Cells where the
// two notches agree have byte-identical worker messages, so a family with no
// differing cell needs no worker run to compare A and B. NOTCH_SCAN=A:B:C...
// (2026-10-06) compares every later variant with A in one pass: the row also
// carries eq = [B == A, C == A, ...] (same = eq[0]).
const SCAN = process.env.NOTCH_SCAN ? process.env.NOTCH_SCAN.split(":") : null;
let scanCall = 0, scanVars = null;
async function scanInit() { scanVars = (await import("./variants.mjs")).VARIANTS; }
if (SCAN) await scanInit();

// runWorker(variant, x, sr): variant = { tree, opts? }. 25 ms chunks at sr.
export function runWorker(variant, x, sr) {
  if (SCAN) {
    const s0 = notchSignature(scanVars[SCAN[0]], x, sr), eq = SCAN.slice(1).map((v) => notchSignature(scanVars[v], x, sr) === s0);
    appendFileSync(process.env.NOTCH_SCAN_OUT || "notch-scan.jsonl", JSON.stringify({ argv: process.argv.slice(2).join(" "), call: scanCall++, sr, n: x.length, same: eq[0], ...(eq.length > 1 ? { eq, vars: SCAN } : {}) }) + "\n");
    return [{ t: 0, pitch: 0, nf: null }]; // one dummy message: scripts that read the last one keep running
  }
  if (!MEMO) return runWorkerRaw(variant, x, sr);
  const sig = notchSignature(variant, x, sr);
  let m = memo.get(x);
  if (!m) { m = new Map(); memo.set(x, m); }
  if (!m.has(sig)) m.set(sig, runWorkerRaw(variant, x, sr));
  return m.get(sig).map((r) => ({ ...r, nf: r.nf ? [...r.nf] : null }));
}
export function runWorkerRaw(variant, x, sr) {
  posts.length = 0;
  const h = H[variant.tree];
  globalThis.__NOTCH_OPTS = variant.opts;
  h({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  h({ data: { type: "audioPort", port } });
  const C = Math.round(0.025 * sr);
  for (let c = 0; c + C <= x.length; c += C) {
    const chunk = Float32Array.from(x.subarray(c, c + C));
    port.onmessage({ data: { buffer: chunk.buffer, contextTime: (c + C) / sr } });
  }
  globalThis.__NOTCH_OPTS = undefined;
  return posts.filter((p) => p.type === "pitch").map((p) => ({ t: p.contextTime - 0.04, pitch: p.pitch, nf: p.notchedFreqs ?? null }));
}

// display replay (median-3 + paint gate; no hold bridging)
export function displayed(msgs) {
  const sm = []; const gate = createPaintGate();
  return msgs.map((m) => {
    if (!(m.pitch > 0)) { sm.length = 0; gate.resetSegment(); return 0; }
    const v = pushAndMedianPitch(sm, m.pitch, PITCH_SMOOTH_LEN);
    return gate.push(v) ? v : 0;
  });
}
export const parseArgs = () => Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
