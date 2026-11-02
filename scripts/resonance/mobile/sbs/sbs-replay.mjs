// sbs-replay.mjs — replay one device's logged capture (pcm.f32, the exact
// chunks its workers got: same lengths, same contextTimes) through the REAL
// workers in Node and compare with what that device's resonance worker posted
// live (the logger's state rows). Any capture rate (the fake desktop device
// runs at 44.1 kHz, a Pixel at 48 kHz).
//
//   node scripts/resonance/mobile/sbs/sbs-replay.mjs --dev=<run folder>/<phone|desktop> [--seg=<index, default the longest>]
//        [--hints=node|live] [--src=build/resonance-mobile/sbs/tree] [--chain] [--json=<out>]
//        [--ct0=<s> --ct1=<s>] [--shift-ms=<ms>] [--gain-db=<dB>] [--fir=<taps.json at the capture rate>] [--posts-out=<json>]
//
//   1. pitch: the REAL pitch worker (src/dsp/pitch-worker.js, FireRedVAD via
//      the local model copy, as chain.mjs) over the logged chunks, from the
//      first one the live resonance worker received (its first post's __tm:
//      nCh, ct);
//   2. the REAL resonance worker (src/resonance/resonance-worker.js, assets
//      from <src>/public/resonance-lab), each chunk followed by the hints the
//      hook relays for it (gate on: voiced false on a "no voice" hop);
//      --hints=node  the hints from step 1 (a full replay: the Node pitch
//                    chain decides voicing, as chain.mjs does);
//      --hints=live  the device's own logged pitch messages, relayed after the
//                    chunk dispatched just before they arrived (isolates the
//                    resonance worker);
//   3. every replayed post is matched to the live post of the same chunk
//      (__tm.ct): |du| (median, p95, max), equal-null share, and the same for
//      uPlain.
//   --chain: additionally runs scripts/resonance/mobile/chain.mjs (its 48 kHz
//   runner) on the capture resampled to 48 kHz (a temp .f32 and chain's
//   output in <run folder>/replay-tmp/, deleted afterwards: it is the
//   captured voice) and matches its posts to the live ones by audio time
//   (nearest within 0.15 s).
//   A realization of the same capture (the analysis's noise band): --ct0 /
//   --ct1 replay only that audio-clock span, from fresh workers; --shift-ms
//   moves every chunk boundary by that much (the first samples dropped, the
//   chunk length kept) and --gain-db scales the samples: the chunk phase and
//   level two real devices never share; --fir passes the capture through those
//   taps first (centred), e.g. the boom's capture through the measured phone /
//   boom response: the phone's meter the response predicts on the same
//   sound. --posts-out writes the replayed posts
//   [{ ct, u, uPlain, fill }].
// Workers are imported from --src (default the clean origin/main tree that
// sbs-validate.mjs extracts, else this worktree), so a work-in-progress src/
// never leaks in when that tree exists.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadDevice } from "./sbs-load.mjs";
import { quant, median, firFilter } from "./sbs-dsp.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const turn = () => new Promise((r) => setImmediate(r));

let sink = [];
function installSelf() {
  if (globalThis.__sbsReplaySelf) return;
  globalThis.__sbsReplaySelf = true;
  globalThis.self = { postMessage: (m) => sink.push(m) };
  Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
}
let P = null;
async function loadPitch(srcRoot) {
  if (P) return P;
  installSelf();
  const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
  const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const fr = await import(pathToFileURL(path.join(srcRoot, "src/dsp/firered-vad.js")).href);
  const MD = path.join(repo, "build", "models", "firered");
  if (!existsSync(path.join(MD, "cmvn.ark"))) throw new Error("FireRedVAD model files missing: node scripts/fetch-firered-model.mjs");
  const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
  const cmvn = fr.parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));
  const W = await import(pathToFileURL(path.join(srcRoot, "src/dsp/pitch-worker.js")).href);
  P = { ort, session, cmvn, fr, W, on: self.onmessage };
  return P;
}
let R = null;
async function loadResonance(srcRoot) {
  if (R) return R;
  installSelf();
  const resDir = path.join(srcRoot, "public/resonance-lab");
  globalThis.fetch = async (url) => {
    const file = path.join(resDir, String(url).split("resonance-lab/").pop());
    if (!existsSync(file)) return { ok: false, status: 404 };
    const txt = readFileSync(file, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
  await import(pathToFileURL(path.join(srcRoot, "src/resonance/resonance-worker.js")).href);
  R = { on: self.onmessage };
  return R;
}

/** chunks: [{ x: Float32Array, ct }] at rate sr. Returns per chunk the pitch messages [voiced, pitch, ct, vad(1/0/-1)]. */
export async function pitchReplay(chunks, sr, srcRoot) {
  const { W, fr, ort, session, cmvn, on } = await loadPitch(srcRoot);
  const posts = [];
  sink = posts;
  W.setVadModelLoaderForTests(async () => ({ runner: fr.createFireRedRunner(ort, session), cmvn }));
  on({ data: { type: "init", inputSampleRate: sr, vad: { modelBase: "test:" } } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "vad-status" && m.status === "ready"); i++) await turn();
  if (!posts.some((m) => m.type === "vad-status" && m.status === "ready")) throw new Error("detector not ready");
  const port = {};
  on({ data: { type: "audioPort", port } });
  const by = [];
  let seen = posts.length;
  const pick = (ms) => ms.filter((m) => m.type === "pitch").map((m) => [m.voiced ? 1 : 0, m.pitch, m.contextTime, m.vad ? (m.vad.voice ? 1 : 0) : -1]);
  for (const c of chunks) {
    port.onmessage({ data: { buffer: c.x.slice().buffer, contextTime: c.ct } });
    await turn();
    by.push(pick(posts.slice(seen)));
    seen = posts.length;
  }
  for (let i = 0; i < 50; i++) await turn();
  by[by.length - 1].push(...pick(posts.slice(seen)));
  W.setVadModelLoaderForTests(null);
  return by;
}
/** The REAL resonance worker over the chunks, hintsBy[k] relayed after chunk k (gate on). Returns its state posts with the chunk index. */
export async function resonanceReplay(chunks, sr, hintsBy, srcRoot) {
  const { on } = await loadResonance(srcRoot);
  const posts = [];
  sink = posts;
  on({ data: { type: "init", sampleRate: sr, assetBase: "/", diag: false } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
  if (!posts.some((m) => m.type === "status" && m.status === "ready")) throw new Error("resonance worker not ready");
  const port = {};
  on({ data: { type: "audioPort", port } });
  const out = [];
  for (let k = 0; k < chunks.length; k++) {
    const before = posts.length;
    port.onmessage({ data: { buffer: chunks[k].x.slice().buffer, contextTime: chunks[k].ct } });
    for (const m of posts.slice(before)) if (m.type === "state") out.push({ k, ct: chunks[k].ct, u: m.u, uPlain: m.uPlain, raw: m.raw, n: m.n, fill: m.fill, verdict: m.verdict });
    for (const h of hintsBy[k] ?? []) on({ data: { type: "pitch-hint", voiced: h[3] === 0 ? false : !!h[0], pitch: h[1], contextTime: h[2] } });
  }
  return out;
}

/** The chunks of one capture segment from the logged PCM, from the live resonance worker's first chunk;
 *  with ctRange / shiftSamples / gainDb: re-chunked from the segment's PCM over that span (fresh workers). */
export function segmentChunks(D, segIdx, { ctRange = null, shiftSamples = 0, gainDb = 0, firTaps = null } = {}) {
  const seg = D.segments[segIdx];
  if (!seg?.pcm) throw new Error("no PCM in this segment (run with --pcm=1)");
  if (ctRange || shiftSamples || gainDb || firTaps) {
    const { startCt, sr } = seg.pcm, len = seg.chunkLen, g = 10 ** (gainDb / 20);
    // firTaps: the whole segment through that FIR (centred: no delay) before re-chunking
    const y = firTaps ? firFilter(seg.pcm.y, firTaps) : seg.pcm.y;
    const c0 = ctRange ? Math.max(ctRange[0], seg.ct0) : seg.ct0, c1 = ctRange ? Math.min(ctRange[1], seg.ct1) : seg.ct1;
    const a0 = Math.max(0, Math.round((c0 - startCt) * sr)) + Math.max(0, Math.round(shiftSamples)), a1 = Math.min(y.length, Math.round((c1 - startCt) * sr));
    const chunks = [];
    for (let o = a0; o + len <= a1; o += len) {
      const x = new Float32Array(len);
      for (let i = 0; i < len; i++) x[i] = y[o + i] * g;
      chunks.push({ ct: startCt + (o + len) / sr, x, len });
    }
    const live = D.rows.state.filter((s) => s.tm && s.tm.ct >= c0 - 1e-9 && s.tm.ct <= c1 + 1e-9);
    return { seg, chunks, live, start: 0 };
  }
  const idx = D.pcm.idx.filter((e) => e.ct >= seg.ct0 - 1e-9 && e.ct <= seg.ct1 + 1e-9);
  const chunks = idx.map((e) => ({ ct: e.ct, x: D.pcm.all.subarray(e.off, e.off + e.len), len: e.len }));
  // the live resonance worker of this segment: its posts whose __tm.ct falls in the segment
  const live = D.rows.state.filter((s) => s.tm && s.tm.ct >= seg.ct0 - 1e-9 && s.tm.ct <= seg.ct1 + 1e-9);
  // the worker posts every `period` chunks it processes; chunks that came while it
  // was still loading its assets were not processed (its first post comes after
  // nCh > period chunks): start the replay `period` chunks before its first post
  let start = 0;
  if (live.length) {
    const f = live[0], kAt = chunks.findIndex((c) => Math.abs(c.ct - f.tm.ct) < 1e-6);
    const diffs = live.slice(1, 12).map((x, i) => x.tm.nCh - live[i].tm.nCh).filter((d) => d > 0).sort((a, b) => a - b);
    const period = diffs.length ? diffs[diffs.length >> 1] : f.tm.nCh;
    if (kAt >= 0) start = Math.max(0, kAt - (Math.min(period, f.tm.nCh) - 1));
  }
  return { seg, chunks: chunks.slice(start), live, start };
}

export const DEFAULT_SRC = existsSync(path.join(repo, "build/resonance-mobile/sbs/tree/src")) ? path.join(repo, "build/resonance-mobile/sbs/tree") : repo;
export async function replayDevice(D, { segIdx = null, hints = "node", srcRoot = DEFAULT_SRC, ctRange = null, shiftSamples = 0, gainDb = 0, firTaps = null } = {}) {
  if (segIdx == null) segIdx = D.segments.reduce((b, s, i) => (s.pcm && (!D.segments[b]?.pcm || s.chunks.length > D.segments[b].chunks.length) ? i : b), 0);
  const variant = !!(ctRange || shiftSamples || gainDb || firTaps);
  if (variant && hints !== "node") throw new Error("a re-chunked replay needs --hints=node");
  const { seg, chunks, live, start } = segmentChunks(D, segIdx, { ctRange, shiftSamples, gainDb, firTaps });
  const sr = seg.sr;
  let hintsBy;
  const t0 = Date.now();
  if (hints === "node") hintsBy = await pitchReplay(chunks, sr, srcRoot);
  else {
    // live pitch messages, each after the last chunk dispatched before it arrived
    const walls = seg.chunks.map((c) => c[0]);
    const cts = new Map(seg.chunks.map((c) => [c[1], c[0]]));
    hintsBy = chunks.map(() => []);
    const w0 = chunks.map((c) => cts.get(c.ct));
    let k = 0;
    for (const p of D.rows.pitch.filter((p) => p[1] != null && p[1] >= chunks[0].ct - 1 && p[1] <= seg.ct1 + 1)) {
      while (k + 1 < w0.length && w0[k + 1] <= p[0]) k++;
      if (w0[k] <= p[0]) hintsBy[k].push([p[3], p[4], p[1], p[7]]);
    }
    void walls;
  }
  const msPitch = Date.now() - t0;
  const rep = await resonanceReplay(chunks, sr, hintsBy, srcRoot);
  // match by chunk ct
  const byCt = new Map(rep.map((r) => [r.ct.toFixed(6), r]));
  const nearest = (ct) => { let lo = 0, hi = rep.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rep[m].ct < ct) lo = m; else hi = m; } const c = [rep[lo], rep[hi]].filter(Boolean).sort((x, y) => Math.abs(x.ct - ct) - Math.abs(y.ct - ct))[0]; return c && Math.abs(c.ct - ct) < 0.1 ? c : null; };
  let exactCt = 0;
  const du = [], dup = [];
  let matched = 0, nullBoth = 0, nullMismatch = 0, liveN = 0;
  for (const s of live) {
    let r = byCt.get(s.tm.ct.toFixed(6));
    liveN++;
    if (r) exactCt++; else r = nearest(s.tm.ct);
    if (!r) continue;
    matched++;
    if (s.u == null && r.u == null) { nullBoth++; continue; }
    if ((s.u == null) !== (r.u == null)) { nullMismatch++; continue; }
    du.push(Math.abs(s.u - r.u));
    if (s.uPlain != null && r.uPlain != null) dup.push(Math.abs(s.uPlain - r.uPlain));
  }
  return {
    seg: segIdx, sr, chunks: chunks.length, startChunk: start, hints, msPitch, live: liveN, replay: rep.length, matched, matchedSameChunk: exactCt, nullBoth, nullMismatch,
    du: { n: du.length, median: median(du), p95: quant(du, 0.95), max: du.length ? Math.max(...du) : null, exact: du.filter((x) => x === 0).length, over005: du.length ? du.filter((x) => x > 0.05).length / du.length : null },
    duPlain: { n: dup.length, median: median(dup), p95: quant(dup, 0.95), max: dup.length ? Math.max(...dup) : null },
    hintsBy, chunksCt: chunks.map((c) => c.ct), rep,
  };
}

/** chain.mjs's own 48 kHz runner on the capture resampled to 48 kHz; its posts matched to the live ones by audio time. */
export async function chainCheck(D, segIdx, { tag = "chk" } = {}) {
  const { seg, chunks, live } = segmentChunks(D, segIdx);
  const { resampleClip } = await import(pathToFileURL(path.join(repo, "src/voice-preview/engine/preview.js")).href);
  const n = chunks.reduce((a, c) => a + c.len, 0), y = new Float32Array(n);
  let o = 0; for (const c of chunks) { y.set(c.x, o); o += c.len; }
  const ctStart = chunks[0].ct - chunks[0].len / seg.sr;
  const y48 = seg.sr === 48000 ? y : resampleClip(y, seg.sr, 48000);
  // the captured voice: written inside the run folder and deleted afterwards
  const dir = path.join(path.dirname(path.resolve(D.dir)), "replay-tmp", `${path.basename(D.dir)}-${tag}`);
  mkdirSync(dir, { recursive: true });
  let rec;
  try {
    const f = path.join(dir, `${tag}.f32`);
    writeFileSync(f, Buffer.from(y48.buffer, y48.byteOffset, y48.byteLength));
    const out = path.join(dir, "chain");
    const cond = `sbs-${tag}`;
    const r = spawnSync(process.execPath, ["--max-old-space-size=4096", path.join(repo, "scripts/resonance/mobile/chain.mjs"), "run", `--cond=${cond}`, `--f32=${f}`, `--id=${tag}`, "--gate=on", `--out=${path.relative(repo, out)}`],
      { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`chain.mjs failed: ${r.stderr || r.stdout}`);
    rec = readFileSync(path.join(out, cond, "runs-0of1.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.id === tag && x.gate === "on");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // chain post p: k = chunk index (1200 samples at 48 kHz from ctStart); its audio time = ctStart + (k + 1) * 0.025
  const cp = rec.posts.map((p) => ({ t: ctStart + (p[0] + 1) * 0.025, u: p[2] }));
  // chain's posts are 1200-sample chunks (another post phase than the live 0.2 s grid when the capture was not 48 kHz):
  // nearest post, and the value linearly interpolated between the two chain posts around the live post's time
  const du = [], duI = [];
  let j = 0;
  for (const s of live) {
    if (s.u == null) continue;
    while (j + 1 < cp.length && cp[j + 1].t <= s.tm.ct) j++;
    const a = cp[j], b = cp[j + 1];
    const near = !b || Math.abs(a.t - s.tm.ct) <= Math.abs(b.t - s.tm.ct) ? a : b;
    if (Math.abs(near.t - s.tm.ct) <= 0.15 && near.u != null) du.push(Math.abs(near.u - s.u));
    if (b && a.u != null && b.u != null && a.t <= s.tm.ct && s.tm.ct <= b.t) duI.push(Math.abs(a.u + ((s.tm.ct - a.t) / (b.t - a.t)) * (b.u - a.u) - s.u));
  }
  return { resampledFrom: seg.sr, posts: cp.length, n: du.length, median: median(du), p95: quant(du, 0.95), max: du.length ? Math.max(...du) : null,
    interpolated: { n: duI.length, median: median(duI), p95: quant(duI, 0.95) } };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const D = loadDevice(path.resolve(arg("dev", "")));
  const segIdx = arg("seg", "") === "" ? null : Number(arg("seg", ""));
  const src = arg("src", "") ? path.resolve(repo, arg("src", "")) : DEFAULT_SRC;
  const ct0 = arg("ct0", ""), ct1 = arg("ct1", "");
  const segI = segIdx ?? D.segments.reduce((b, s, i) => (s.pcm && (!D.segments[b]?.pcm || s.chunks.length > D.segments[b].chunks.length) ? i : b), 0);
  const res = await replayDevice(D, { segIdx: segI, hints: arg("hints", "node"), srcRoot: src, ctRange: ct0 !== "" && ct1 !== "" ? [Number(ct0), Number(ct1)] : null,
    shiftSamples: Math.round((Number(arg("shift-ms", "0")) / 1000) * (D.segments[segI]?.sr || 48000)), gainDb: Number(arg("gain-db", "0")),
    firTaps: arg("fir", "") ? Float64Array.from(JSON.parse(readFileSync(path.resolve(arg("fir", "")), "utf8"))) : null });
  const { hintsBy, chunksCt, rep, ...summary } = res;
  if (arg("posts-out", "")) writeFileSync(arg("posts-out", ""), JSON.stringify({ seg: res.seg, sr: res.sr, chunks: res.chunks, posts: rep.map((r) => ({ ct: r.ct, u: r.u, uPlain: r.uPlain, fill: r.fill })) }));
  console.log(JSON.stringify(summary, null, 1));
  let chain = null;
  if (process.argv.includes("--chain")) { chain = await chainCheck(D, res.seg, { tag: arg("tag", "replay") }); console.log("chain.mjs (48 kHz):", JSON.stringify(chain)); }
  if (arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify({ ...summary, chain }, null, 1));
  process.exit(0);
}
