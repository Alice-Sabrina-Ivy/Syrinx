// chain.mjs — the resonance cue's real chain under a perturbation of the
// captured audio (mobile resonance diagnosis, 2026-10-27).
//
//   node scripts/resonance/mobile/chain.mjs run --cond=<name> [--pert=<spec>] [--gate=on|off|both]
//        [--streams=build/resonance-mobile/streams] [--tag=dev] [--set=mobile] [--kinds=ctl,sw,long]
//        [--only=<stream ids or reader ids>] [--shard=i/n] [--out=build/resonance-mobile/runs]
//        [--hint-delay=<chunks>] [--worker] [--f32=<path> --id=<id> --sex=m|f]
//
// What runs (the chain of scripts/resonance/faster.mjs, unchanged, with an
// optional perturbation in front of it):
//   1. the stream (48 kHz float32; faster.mjs streamItems: controls, the N-X-N
//      switch streams spliced at 18 / 36 s, the reader's 150 s stream) is
//      perturbed as a whole (perturb.mjs; --pert compact or JSON spec). The
//      perturbed audio feeds BOTH workers, as a microphone / channel would.
//   2. pitch: the REAL pitch worker (src/dsp/pitch-worker.js, fake self, frozen
//      performance clock) with the real FireRedVAD model, 1200-sample chunks;
//      per chunk the posted pitch messages [voiced, pitch, contextTime, vad.voice
//      (1 / 0 / -1 = no decision)] — identical code to `faster.mjs pitch`.
//      Cached per condition in <out>/<cond>/pitch/<id>.json (faster.mjs's
//      format plus extra keys; reused only when the perturbation matches).
//   3. bins: the resonance worker's chain replayed exactly as faster.mjs bins
//      (lab engine "frames" mode, narrowband detector, resonanceCue as shipped),
//      fed the hint the hook relays:
//        --gate=on  (the app's default): voiced: false on hops the detector
//                   decided "no voice" (useAudioPipeline handlePitchMessage)
//        --gate=off (setting off, or detector unavailable / slow): the posted
//                   voicing, unmasked
//      Order per chunk as the app: the audio chunk (the worker posts inside
//      onChunk), then the pitch hints relayed for it. --hint-delay=N relays a
//      chunk's hints after chunk k+N instead (main-thread / message latency;
//      0 = faster.mjs). --worker runs the REAL resonance worker beside the
//      replica and checks every field of every state post.
//
// Output: one JSON line per (stream, gate) in <out>/<cond>/runs-<i>of<n>.jsonl
// (resumable: (id, gate) pairs already there are skipped). The record is
// faster.mjs's (id, reader, sex, kind, variant, seq, joins, trail, n, nbResets,
// bins, posts, worker?) — bins [te, stampS, value, admitted, chunk, ct] and
// posts [k, binCount, u, raw, uPlain, shownStartU, startU, fill, voicedS,
// verdictIdx, sinceResumeS, nb.on, nb.decided, voiced, holding] are
// field-for-field faster.mjs's — plus: cond, gate, pert, pertInfo, hintDelay,
// nbF (nb.f per post), nbFinal, pitchStats {hops, voiced, hidden, vadVoice,
// vadMissing}, level {inActiveDb, outActiveDb, voicedHopRmsMedDb,
// voicedHopRmsP10Db}, ms {pert, pitch, bins}.
// Summaries: summarize.mjs. Verification: verify.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const turn = () => new Promise((r) => setImmediate(r));
if (process.argv[2] === "pitch" || process.argv[2] === "bins") throw new Error("chain.mjs: use the 'run' mode (faster.mjs's modes would start on import)");
const { streamItems, VERD } = await imp("scripts/resonance/faster.mjs");
const { parsePert, pertLabel, applyPert, activeLevelDb } = await import("./perturb.mjs");

export const SR = 48000, CH = 1200;
export const SETS = {
  // the mobile diagnosis: controls N / U10 / D10, the 1.0 u switch streams, the long stream
  mobile: { ctl: ["N", "U10", "D10"], sw: [["N", "U10"], ["N", "D10"]] },
};
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };

export function selectItems({ streamsDir, tag = "dev", set = "mobile", kinds = ["ctl", "sw", "long"], only = [] }) {
  const L = JSON.parse(readFileSync(path.join(streamsDir, `readers-${tag}.json`), "utf8"));
  const S = SETS[set];
  if (!S) throw new Error(`unknown set ${set}`);
  let items = streamItems(L, "main").filter((it) =>
    (it.kind === "ctl" && S.ctl.includes(it.variant)) ||
    (it.kind === "sw" && S.sw.some(([a, b]) => it.seq[0] === a && it.seq[1] === b)) ||
    it.kind === "long");
  items = items.filter((it) => kinds.includes(it.kind));
  if (only.length) { const o = new Set(only); items = items.filter((it) => o.has(it.id) || o.has(it.reader)); }
  return items;
}

// ---- the workers (imported once per process)
let sink = [];
let W = null, pitchOn = null, ort = null, session = null, cmvn = null, createFireRedRunner = null;
let resOn = null, wposts = null;
function installSelf() {
  if (globalThis.__mobileChainSelf) return;
  globalThis.__mobileChainSelf = true;
  globalThis.self = { postMessage: (m) => sink.push(m) };
  const frozen = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
  Object.defineProperty(globalThis, "performance", { value: frozen, configurable: true, writable: true });
}
async function loadPitch() {
  if (W) return;
  installSelf();
  const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
  ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const fr = await imp("src/dsp/firered-vad.js");
  createFireRedRunner = fr.createFireRedRunner;
  const { LOCAL_MODEL_DIR: MD, LOCAL_MODEL_HINT } = await imp("scripts/firered/local-model.mjs");
  if (!existsSync(path.join(MD, "cmvn.ark"))) throw new Error(`FireRedVAD model files missing: ${LOCAL_MODEL_HINT}`);
  session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
  cmvn = fr.parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));
  W = await imp("src/dsp/pitch-worker.js");
  pitchOn = self.onmessage;
}
const resDir = path.join(repo, "public/resonance-lab");
async function loadWorker() {
  if (resOn) return;
  installSelf();
  globalThis.fetch = async (url) => {
    const file = path.join(resDir, String(url).split("resonance-lab/").pop());
    if (!existsSync(file)) return { ok: false, status: 404 };
    const txt = readFileSync(file, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
  await imp("src/resonance/resonance-worker.js");
  resOn = self.onmessage;
}

/** The REAL pitch worker over y (identical to `faster.mjs pitch`). Returns byChunk. */
export async function pitchPass(y) {
  await loadPitch();
  const posts = [];
  sink = posts;
  W.setVadModelLoaderForTests(async () => ({ runner: createFireRedRunner(ort, session), cmvn }));
  pitchOn({ data: { type: "init", inputSampleRate: SR, vad: { modelBase: "test:" } } });
  for (let i = 0; i < 200 && !posts.some((m) => m.type === "vad-status" && m.status === "ready"); i++) await turn();
  if (!posts.some((m) => m.type === "vad-status" && m.status === "ready")) throw new Error("detector not ready");
  const port = {};
  pitchOn({ data: { type: "audioPort", port } });
  const byChunk = [];
  let seen = posts.length;
  const pick = (ms) => ms.filter((m) => m.type === "pitch").map((m) => [m.voiced ? 1 : 0, m.pitch, m.contextTime, m.vad ? (m.vad.voice ? 1 : 0) : -1]);
  const nC = Math.ceil(y.length / CH);
  for (let k = 0; k < nC; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
    await turn();
    for (const m of posts.slice(seen)) {
      if (m.type === "vad-status" && m.status !== "ready") throw new Error(`detector ${m.status}`);
      if (m.type === "status" && m.status === "error") throw new Error(`pitch worker error: ${m.message}`);
    }
    byChunk.push(pick(posts.slice(seen)));
    seen = posts.length;
  }
  for (let i = 0; i < 50; i++) await turn();
  byChunk[byChunk.length - 1].push(...pick(posts.slice(seen)));
  W.setVadModelLoaderForTests(null);
  return byChunk;
}

/**
 * The resonance worker's chain replayed over y with the hints of byChunk
 * (identical to `faster.mjs bins` for gate "on" and hintDelay 0).
 */
export async function binsPass(y, byChunk, { gate = "on", hintDelay = 0, worker = false } = {}) {
  const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
  const { createNarrowbandDetector } = await imp("src/resonance/narrowband.js");
  const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
  const VTLN = JSON.parse(readFileSync(path.join(resDir, "vtln_warp.json"), "utf8"));
  const REF = JSON.parse(readFileSync(path.join(resDir, "reference.json"), "utf8"));
  if (worker) await loadWorker();
  const F = ["u", "raw", "uPlain", "shownStartU", "startU", "n", "fill", "voicedS", "clamp", "verdict", "sinceResumeS"];
  // the hint the hook relays (useAudioPipeline handlePitchMessage)
  const hint = gate === "on"
    ? (m) => ({ voiced: m[3] === 0 ? false : !!m[0], pitch: m[1], contextTime: m[2] })
    : (m) => ({ voiced: !!m[0], pitch: m[1], contextTime: m[2] });
  const cue = createResonanceCue({ reference: REF });
  const nb = createNarrowbandDetector();
  const bins = [];
  const nbResets = [];
  let curK = 0, curCt = 0, nbWasOn = false;
  const engine = createLabEngine({
    sampleRate: SR, models: { vtln: VTLN }, reference: REF, pitchSource: "frames", vtln: {},
    onStamped: (name, te, stampS, value) => {
      if (name !== "vtln") return;
      const adm = cue.onStamped(te, stampS, value);
      bins.push([te, stampS, value, adm ? 1 : 0, curK, curCt]);
    },
    onGridFrame: (j, f0, ring16) => {
      if (!(f0 > 0)) return;
      const st = nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000));
      if (st.on && !nbWasOn) nbResets.push(bins.length);
      nbWasOn = st.on;
      cue.noteNarrowband(st.on);
    },
  });
  let wport = null;
  if (worker) {
    wposts = [];
    sink = wposts;
    resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: false } });
    for (let i = 0; i < 200 && !wposts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
    if (!wposts.some((m) => m.type === "status" && m.status === "ready")) throw new Error("resonance worker not ready");
    wport = {};
    resOn({ data: { type: "audioPort", port: wport } });
  }
  let sincePost = 0, lastVoiced = false, lastVoicedT = -Infinity, mis = 0, chk = 0;
  const posts = [], nbF = [];
  const relay = (list) => {
    for (const m of list) {
      const h = hint(m);
      if (wport) resOn({ data: { type: "pitch-hint", ...h } });
      if (typeof h.contextTime === "number" && Number.isFinite(h.contextTime)) {
        cue.notePitchHint(h);
        engine.pushPitchFrame(h.contextTime, h.voiced ? h.pitch : 0);
      }
      lastVoiced = h.voiced;
      if (h.voiced) lastVoicedT = h.contextTime;
    }
  };
  const nC = byChunk.length;
  for (let k = 0; k < nC; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    curK = k; curCt = ct;
    // replica of onChunk
    cue.noteChunk(ct);
    engine.pushChunk(x, null, ct);
    sincePost += x.length / SR;
    let rep = null;
    if (sincePost >= 0.2) {
      sincePost = 0;
      const s = cue.snapshot();
      const pos = nb.state.decided;
      rep = { u: pos ? s.u : null, raw: pos ? s.raw : null, uPlain: pos ? s.uPlain : null, shownStartU: s.shownStartU, startU: s.startU, n: s.n,
        fill: s.fill, voicedS: s.voicedS, clamp: pos ? s.clamp : 0, verdict: s.verdict, sinceResumeS: s.sinceResumeS, nb: { ...nb.state } };
      const holding = !lastVoiced && ct - lastVoicedT <= 5;
      posts.push([k, bins.length, rep.u, rep.raw, rep.uPlain, rep.shownStartU, rep.startU, rep.fill, rep.voicedS, VERD.indexOf(rep.verdict),
        rep.sinceResumeS, rep.nb.on ? 1 : 0, rep.nb.decided ? 1 : 0, lastVoiced ? 1 : 0, holding ? 1 : 0]);
      nbF.push(rep.nb.f == null ? null : +rep.nb.f.toFixed(3));
    }
    if (wport) {
      const before = wposts.length;
      wport.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
      const st = wposts.slice(before).filter((m) => m.type === "state");
      if (wposts.slice(before).some((m) => m.type === "status")) throw new Error("worker status change");
      if (st.length !== (rep ? 1 : 0)) mis++;
      for (const m of st) {
        chk++;
        if (!rep || F.some((f) => m[f] !== rep[f]) || m.narrowband.on !== rep.nb.on || m.narrowband.decided !== rep.nb.decided || m.narrowband.f !== rep.nb.f) mis++;
      }
    }
    curCt = ct;
    if (k - hintDelay >= 0) relay(byChunk[k - hintDelay]);
  }
  for (let k = Math.max(0, nC - hintDelay); k < nC; k++) relay(byChunk[k]); // delayed tail (no further posts)
  return {
    n: nC, nbResets,
    bins: bins.map((b) => [+b[0].toFixed(4), b[1], b[2], b[3], b[4], +b[5].toFixed(4)]),
    posts, nbF, nbFinal: { ...nb.state },
    ...(worker ? { worker: { checked: chk, mismatch: mis } } : {}),
  };
}

export function pitchStats(byChunk) {
  let hops = 0, voiced = 0, hidden = 0, vadVoice = 0, vadMissing = 0;
  for (const c of byChunk) for (const m of c) {
    hops++;
    if (m[0]) voiced++;
    if (m[0] && m[3] === 0) hidden++;
    if (m[3] === 1) vadVoice++;
    if (m[3] === -1) vadMissing++;
  }
  return { hops, voiced, hidden, vadVoice, vadMissing };
}
const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
/** RMS (dBFS) of the 25 ms of y ending at each voiced hop's contextTime — the diag's voiced-frame inputRms scale. */
export function voicedHopRms(y, byChunk) {
  const out = [];
  for (const c of byChunk) for (const m of c) {
    if (!m[0] || typeof m[2] !== "number") continue;
    const e = Math.min(y.length, Math.round(m[2] * SR)), b = Math.max(0, e - CH);
    if (e - b < CH / 2) continue;
    let s = 0; for (let i = b; i < e; i++) s += y[i] * y[i];
    out.push(10 * Math.log10(s / (e - b) + 1e-20));
  }
  return { med: pct(out, 0.5), p10: pct(out, 0.1), n: out.length };
}

// ---- CLI
if (process.argv[2] === "run" && process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  installSelf(); // frozen performance clock for the whole run, as faster.mjs
  const cond = arg("cond", "");
  if (!cond) throw new Error("--cond=<name> is required");
  const pertList = parsePert(arg("pert", ""));
  const gates = arg("gate", "on") === "both" ? ["on", "off"] : [arg("gate", "on")];
  for (const g of gates) if (g !== "on" && g !== "off") throw new Error(`--gate=${g}`);
  const hintDelay = Number(arg("hint-delay", "0"));
  const withWorker = process.argv.includes("--worker");
  const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/runs"), cond);
  const streamsDir = path.resolve(repo, arg("streams", "build/resonance-mobile/streams"));
  let items;
  if (arg("f32", "")) {
    const p = path.resolve(arg("f32", ""));
    const id = arg("id", path.basename(p).replace(/\.f32$/, ""));
    items = [{ id, reader: id, sex: arg("sex", "?"), kind: "ext", variant: null, load: () => readF32(p) }];
  } else {
    items = selectItems({ streamsDir, tag: arg("tag", "dev"), set: arg("set", "mobile"), kinds: arg("kinds", "ctl,sw,long").split(","), only: arg("only", "").split(",").filter(Boolean) });
  }
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);
  mkdirSync(path.join(OUT, "pitch"), { recursive: true });
  const out = path.join(OUT, `runs-${si}of${sn}.jsonl`);
  if (existsSync(out)) { // drop a partial last line from an interrupted run
    const txt = readFileSync(out, "utf8"), cut = txt.lastIndexOf("\n") + 1;
    if (cut < txt.length) writeFileSync(out, txt.slice(0, cut));
  }
  const done = new Set();
  for (const f of readdirSync(OUT).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(OUT, f), "utf8").split("\n")) {
      if (!l) continue;
      try { const r = JSON.parse(l); done.add(`${r.id}|${r.gate}`); } catch { /* partial line of another shard */ }
    }
  }
  const pertKey = JSON.stringify(pertList);
  writeFileSync(path.join(OUT, `cond-${si}of${sn}.json`), JSON.stringify({ cond, pert: pertList, label: pertLabel(pertList), gates, hintDelay, argv: process.argv.slice(2) }, null, 1));
  const t0 = Date.now();
  let audioS = 0, totMis = 0, totChk = 0;
  for (const it of items) {
    const todo = gates.filter((g) => !done.has(`${it.id}|${g}`));
    if (!todo.length) continue;
    const tp0 = Date.now();
    const y0 = it.load();
    const { y, info } = await applyPert(pertList, y0, SR, { id: it.id, reader: it.reader, sex: it.sex, kind: it.kind });
    const msPert = Date.now() - tp0;
    const pf = path.join(OUT, "pitch", `${it.id}.json`);
    let meta = null, msPitch = 0;
    if (existsSync(pf)) {
      meta = JSON.parse(readFileSync(pf, "utf8"));
      if (meta.pertKey !== pertKey) throw new Error(`${pf}: cached for another perturbation (${meta.pertKey}); use another --cond or delete it`);
    } else {
      const t1 = Date.now();
      const byChunk = await pitchPass(y);
      msPitch = Date.now() - t1;
      const hr = voicedHopRms(y, byChunk);
      meta = { id: it.id, dur: y.length / SR, byChunk, pertKey, pertInfo: info, msPitch,
        level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
      writeFileSync(pf, JSON.stringify(meta));
    }
    for (const gate of todo) {
      const t2 = Date.now();
      const r = await binsPass(y, meta.byChunk, { gate, hintDelay, worker: withWorker });
      const msBins = Date.now() - t2;
      const rec = {
        id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null,
        trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts, ...(r.worker ? { worker: r.worker } : {}),
        cond, gate, pert: pertList, pertInfo: meta.pertInfo, hintDelay, nbF: r.nbF, nbFinal: r.nbFinal,
        pitchStats: pitchStats(meta.byChunk), level: meta.level, ms: { pert: msPert, pitch: msPitch || meta.msPitch, pitchCached: !msPitch, bins: msBins },
      };
      appendFileSync(out, JSON.stringify(rec) + "\n");
      if (r.worker) { totMis += r.worker.mismatch; totChk += r.worker.checked; }
      console.log(`${it.id} gate ${gate} bins ${r.bins.length} posts ${r.posts.length}${r.worker ? ` worker ${r.worker.checked - r.worker.mismatch}/${r.worker.checked}` : ""} pitch ${(msPitch / 1000).toFixed(1)} s bins ${(msBins / 1000).toFixed(1)} s`);
    }
    audioS += y.length / SR;
    console.log(`  [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
  }
  if (withWorker) console.log(`worker parity: ${totChk - totMis}/${totChk} posts equal`);
  process.exit(0);
}
