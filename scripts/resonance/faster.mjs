// faster.mjs — the resonance responsiveness study's chain runs
// (measurements/resonance-faster-2026-10-26.md, pre-registration
// measurements/resonance-faster-prereg-2026-10-26.md).
//
//   node scripts/resonance/faster.mjs pitch --tag=dev [--set=main|calib] [--shard=i/n]
//   node scripts/resonance/faster.mjs bins  --tag=dev [--set=...] [--worker] [--trail=N] [--shard=i/n] [--out=<jsonl>]
//
// Streams (readers-<tag>.json from faster-streams.mjs; 48 kHz float32):
//   control   <reader>__<V>          one variant, 54 s (WORLD render of the reader's speech)
//   switch    <reader>__<A>-<B>-<A>  segments 0-18 / 18-36 / 36-54 s from variants A, B, A
//                                    (10 ms crossfades at the joins, as switch-asymmetry.mjs)
//   long      <reader>__L            the reader's own 150 s recording (unchanged voice)
//
// pitch: the REAL pitch worker (src/dsp/pitch-worker.js, fake self) with the
//   real FireRedVAD model (frozen clock, as start-reference.mjs), 1200-sample
//   chunks; per chunk the posted pitch messages [voiced, pitch, contextTime,
//   vad.voice] -> <out>/pitch/<stream>.json.
// bins: the resonance worker's chain replayed exactly as resonance-worker.js
//   runs it (startEngine / onChunk / onPitchHint: lab engine "frames" mode,
//   narrowband detector on voiced grid frames, resonanceCue as shipped), fed
//   the hint the hook relays with the voice gate on (voiced: false where the
//   detector says no voice; the app's default). Order per chunk as the app:
//   the audio chunk (the worker posts inside onChunk), then the pitch hints
//   relayed for it. Logged per stream: every vtln bin [te, stampS, value,
//   admitted, chunk index when stamped, ct when stamped], and every 0.2 s post
//   [k, binCount, u, raw, uPlain, shownStartU, startU, fill, voicedS, verdict,
//   sinceResumeS, nb.on, nb.decided, voiced, holding] (voiced = the newest
//   relayed hint, holding = a voiced hint within 5 s — the hook's silence
//   hold, as start-reference.mjs). --worker also runs the REAL resonance
//   worker beside the replica and checks every field of every state post
//   equal (u, raw, uPlain, shownStartU, startU, n, fill, voicedS, clamp,
//   verdict, sinceResumeS, narrowband). --trail=N runs vtln with N trailing
//   voiced frames per bin (a bin-level candidate; default 100 = shipped).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const SR = 48000, CH = 1200;
const mode = process.argv[2];
const OUT = path.resolve(repo, arg("root", "build/resonance-faster"));
const tag = arg("tag", "dev");
const turn = () => new Promise((r) => setImmediate(r));
export const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];

// ---- the stream sets (fixed in the pre-registration)
const SETS = {
  // step-size calibration: controls only
  calib: { ctl: ["N", "C-12", "C-6", "C+6", "C+12"], sw: [], long: false },
  // the study: controls of every variant, the switch sequences, the long stream
  main: {
    ctl: ["N", "U05", "D05", "U10", "D10", "U10m", "D10m"],
    sw: ["N/U05", "N/D05", "N/U10", "N/D10", "N/U10m", "N/D10m"],
    long: true,
  },
};
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
function splice(parts, joins) {
  const n = Math.min(...parts.map((p) => p.length)), y = new Float32Array(n), X = Math.round(0.005 * SR);
  const j1 = Math.round(joins[0] * SR), j2 = Math.round(joins[1] * SR);
  for (let i = 0; i < n; i++) {
    let w;
    if (i < j1 - X) w = [1, 0, 0];
    else if (i < j1 + X) { const a = (i - (j1 - X)) / (2 * X); w = [1 - a, a, 0]; }
    else if (i < j2 - X) w = [0, 1, 0];
    else if (i < j2 + X) { const a = (i - (j2 - X)) / (2 * X); w = [0, 1 - a, a]; }
    else w = [0, 0, 1];
    y[i] = w[0] * parts[0][i] + w[1] * parts[1][i] + w[2] * parts[2][i];
  }
  return y;
}
export function streamItems(L, set) {
  const S = SETS[set];
  const items = [];
  for (const r of L.readers) {
    const v = (name) => { const p = r.variants[name]; if (!p) throw new Error(`${r.id}: variant ${name} missing`); return p; };
    for (const V of S.ctl) items.push({ id: `${r.id}__${V}`, reader: r.id, sex: r.sex, kind: "ctl", variant: V, load: () => readF32(v(V)) });
    for (const sw of S.sw) {
      const [A, B] = sw.split("/");
      items.push({ id: `${r.id}__${A}-${B}-${A}`, reader: r.id, sex: r.sex, kind: "sw", seq: [A, B, A], joins: [18, 36], load: () => splice([readF32(v(A)), readF32(v(B)), readF32(v(A))], [18, 36]) });
    }
    if (S.long) items.push({ id: `${r.id}__L`, reader: r.id, sex: r.sex, kind: "long", variant: "L", load: () => readF32(v("L")) });
  }
  return items;
}

if (mode === "pitch" || mode === "bins") {
  const L = JSON.parse(readFileSync(path.join(OUT, `readers-${tag}.json`), "utf8"));
  let items = streamItems(L, arg("set", "main"));
  const only = new Set(arg("only", "").split(",").filter(Boolean));
  if (only.size) items = items.filter((it) => only.has(it.id) || only.has(it.reader));
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);
  const frozen = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
  Object.defineProperty(globalThis, "performance", { value: frozen, configurable: true, writable: true });

  if (mode === "pitch") {
    const dir = path.join(OUT, "pitch");
    mkdirSync(dir, { recursive: true });
    const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
    const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
    const { createFireRedRunner, parseKaldiCmvn } = await imp("src/dsp/firered-vad.js");
    const { LOCAL_MODEL_DIR: MD, LOCAL_MODEL_HINT } = await imp("scripts/firered/local-model.mjs");
    if (!existsSync(path.join(MD, "cmvn.ark"))) { console.error(`model files missing: ${LOCAL_MODEL_HINT}`); process.exit(2); }
    const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
    const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));
    let target = [];
    globalThis.self = { postMessage: (m) => target.push(m) };
    const W = await imp("src/dsp/pitch-worker.js");
    const pitchOn = self.onmessage;
    const t0 = Date.now();
    let audioS = 0;
    for (const it of items) {
      const js = path.join(dir, `${it.id}.json`);
      if (existsSync(js)) continue;
      const y = it.load();
      const posts = [];
      target = posts;
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
      writeFileSync(js, JSON.stringify({ id: it.id, dur: y.length / SR, byChunk }));
      audioS += y.length / SR;
      console.log(`${it.id} [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
    }
    process.exit(0);
  }

  // ---- bins
  const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
  const { createNarrowbandDetector } = await imp("src/resonance/narrowband.js");
  const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
  const resDir = path.join(repo, "public/resonance-lab");
  const VTLN = JSON.parse(readFileSync(path.join(resDir, "vtln_warp.json"), "utf8"));
  const REF = JSON.parse(readFileSync(path.join(resDir, "reference.json"), "utf8"));
  const trail = Number(arg("trail", "100"));
  const withWorker = process.argv.includes("--worker");
  if (withWorker && trail !== 100) throw new Error("--worker checks the shipped chain only");
  let resOn = null, wposts = null;
  if (withWorker) {
    globalThis.self = { postMessage: (m) => wposts.push(m) };
    globalThis.fetch = async (url) => {
      const file = path.join(resDir, String(url).split("resonance-lab/").pop());
      if (!existsSync(file)) return { ok: false, status: 404 };
      const txt = readFileSync(file, "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(txt) };
    };
    await imp("src/resonance/resonance-worker.js");
    resOn = self.onmessage;
  }
  const out = path.resolve(repo, arg("out", `build/resonance-faster/bins-${tag}-${arg("set", "main")}${trail !== 100 ? `-t${trail}` : ""}-${si}of${sn}.jsonl`));
  mkdirSync(path.dirname(out), { recursive: true });
  if (existsSync(out)) {
    const txt = readFileSync(out, "utf8");
    const cut = txt.lastIndexOf("\n") + 1;
    if (cut < txt.length) writeFileSync(out, txt.slice(0, cut));
  }
  const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const F = ["u", "raw", "uPlain", "shownStartU", "startU", "n", "fill", "voicedS", "clamp", "verdict", "sinceResumeS"];
  const t0 = Date.now();
  let audioS = 0, totMis = 0, totChk = 0;
  for (const it of items) {
    if (done.has(it.id)) continue;
    const meta = JSON.parse(readFileSync(path.join(OUT, "pitch", `${it.id}.json`), "utf8"));
    const y = it.load();
    const hint = (m) => ({ voiced: m[3] === 0 ? false : !!m[0], pitch: m[1], contextTime: m[2] });
    const cue = createResonanceCue({ reference: REF });
    const nb = createNarrowbandDetector();
    const bins = [];
    const nbResets = [];
    let curK = 0, curCt = 0, nbWasOn = false;
    const engine = createLabEngine({
      sampleRate: SR, models: { vtln: VTLN }, reference: REF, pitchSource: "frames", vtln: trail !== 100 ? { trail } : {},
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
    if (resOn) {
      wposts = [];
      resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: false } });
      for (let i = 0; i < 200 && !wposts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
      if (!wposts.some((m) => m.type === "status" && m.status === "ready")) throw new Error("resonance worker not ready");
      wport = {};
      resOn({ data: { type: "audioPort", port: wport } });
    }
    let sincePost = 0, lastVoiced = false, lastVoicedT = -Infinity, mis = 0, chk = 0;
    const posts = [];
    const nC = meta.byChunk.length;
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
      }
      if (wport) {
        const before = wposts.length;
        wport.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
        const st = wposts.slice(before).filter((m) => m.type === "state");
        if (wposts.slice(before).some((m) => m.type === "status")) throw new Error("worker status change");
        if (st.length !== (rep ? 1 : 0)) mis++;
        for (const m of st) {
          chk++;
          if (!rep || F.some((f) => m[f] !== rep[f]) || m.narrowband.on !== rep.nb.on || m.narrowband.decided !== rep.nb.decided) mis++;
        }
      }
      curCt = ct;
      for (const m of meta.byChunk[k]) {
        const h = hint(m);
        if (wport) resOn({ data: { type: "pitch-hint", ...h } });
        if (typeof h.contextTime === "number" && Number.isFinite(h.contextTime)) {
          cue.notePitchHint(h);
          engine.pushPitchFrame(h.contextTime, h.voiced ? h.pitch : 0);
        }
        lastVoiced = h.voiced;
        if (h.voiced) lastVoicedT = h.contextTime;
      }
    }
    const rec = {
      id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null,
      trail, n: nC, nbResets,
      bins: bins.map((b) => [+b[0].toFixed(4), b[1], b[2], b[3], b[4], +b[5].toFixed(4)]),
      posts,
      ...(resOn ? { worker: { checked: chk, mismatch: mis } } : {}),
    };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    audioS += nC * CH / SR; totMis += mis; totChk += chk;
    console.log(`${it.id} bins ${bins.length} posts ${posts.length}${resOn ? ` worker ${chk - mis}/${chk}` : ""} [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
  }
  if (resOn) console.log(`worker parity: ${totChk - totMis}/${totChk} posts equal`);
  process.exit(0);
}
