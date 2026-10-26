// start-reference.mjs — when does the resonance cue find "your start"?
// (measurements/resonance-start-reference-2026-10-26.md)
//
//   node scripts/resonance/start-reference.mjs pitch --jobs=<jobs.json> [--speakers=a,b] [--shard=i/n]
//        [--out=build/rstart/pitch]          REAL pitch worker + REAL FireRedVAD per reader stream
//   node scripts/resonance/start-reference.mjs pitch --wav=<48 kHz wav> --id=<name> [--out=...]
//   node scripts/resonance/start-reference.mjs cue --pitch=build/rstart/pitch [--arm=gated|ungated]
//        [--worker] [--only=<id,...>] [--log=<id>] [--out=<rows.jsonl>]
//
// pitch: one stream per LibriSpeech reader, built like the cue-strip smoke's
// speech-*.wav (scripts/cue-strip-smoke-wavs.mjs: the reader's utterances in
// stream order with 0.3 s gaps, x3 to 48 kHz, peak 0.5), run through the
// REAL pitch worker (src/dsp/pitch-worker.js, fake `self`) with the real
// FireRedVAD model (test seam setVadModelLoaderForTests, as
// voice-gate-resonance.mjs), 1200-sample chunks. Per chunk the posted pitch
// messages { voiced, pitch, contextTime, vad.voice } are cached with the
// stream (float32) so the cue arms below replay them without the detector.
//
// cue: per stream, the resonance worker's chain fed exactly as the worker
// feeds it (resonance-worker.js startEngine / onChunk / onPitchHint: lab
// engine "frames" mode, the narrowband detector on voiced grid frames, the
// resonance cue), with the hint the hook relays (useAudioPipeline.js
// handlePitchMessage): arm "gated" = voiced: false on hops the voice gate
// hides (setting on, the app's default), "ungated" = the posted hint
// (setting off, or the cue before 2026-10-21). --worker also runs the REAL
// resonance worker on the gated arm and checks that its posted startU /
// fill / voicedS equal the replica's at every 0.2 s post.
// Logged per stream: the time (audio s) of fill = 1, of startU, startU, the
// reader's long-run value (median of the plain 5 s readout over the stream's
// last half), every dropped bin's reason (sustained / warming / latch after
// sustained / narrowband), resumes, restarts, and (--log) a per-post trace.
//
// Start rules (pre-registered, measurements/resonance-start-prereg-2026-10-26.md):
// the cue runs as shipped; its start collection is replicated from its
// snapshot (checked against its startU on every bin) and every candidate's
// shown start is put through the row's real logic (cueStripModel.js
// resonanceRowState / resonanceHeader) on each 0.2 s post: voiced = the
// newest relayed hint, holding = a voiced hint within the last 5 s (the
// hook's silence hold). Per candidate: the first start-relative word, every
// word post (about / brighter-darker), the switch jump (Pk), the final start.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000, CH = 1200;
const mode = process.argv[2];
const turn = () => new Promise((r) => setImmediate(r));

function readWav48(file) {
  const b = readFileSync(file);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), s = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      if (fmt.sr !== SR || fmt.bits !== 16 || fmt.ch !== 1) throw new Error(`${file}: needs 48 kHz 16-bit mono`);
      const n = Math.floor(Math.min(s, b.length - o - 8) / 2), x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + 2 * i) / 32768;
      return x;
    }
    o += 8 + s + (s & 1);
  }
  throw new Error(`${file}: no data`);
}

// =================================================================== pitch
if (mode === "pitch") {
  const out = arg("out", path.join(repo, "build/rstart/pitch"));
  mkdirSync(out, { recursive: true });
  let items = [];
  if (arg("wav", "")) {
    items = [{ id: arg("id", "wav"), sex: arg("sex", "na"), load: () => readWav48(arg("wav", "")) }];
  } else {
    const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
    const jobs = JSON.parse(readFileSync(arg("jobs", ""), "utf8"));
    let spk = [...new Set(jobs.map((j) => j.speaker))];
    const want = arg("speakers", "").split(",").filter(Boolean);
    if (want.length) spk = spk.filter((s) => want.includes(s));
    const maxS = Number(arg("max-s", "0"));
    items = spk.map((s) => ({
      id: s, sex: jobs.find((j) => j.speaker === s).sex,
      load: () => {
        // scripts/cue-strip-smoke-wavs.mjs pick(): utterances + 0.3 s gaps, x3, peak 0.5
        const parts = jobs.filter((j) => j.speaker === s).map((j) => { const b = readFileSync(j.audio); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); });
        const gap = 16000 * 0.3;
        let n = parts.reduce((a, p) => a + p.length + gap, 0);
        const x = new Float32Array(n); let o = 0;
        for (const p of parts) { x.set(p, o); o += p.length + gap; }
        let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
        let y = Float32Array.from(upsample(x)).map((v) => (0.5 * v) / pk);
        if (maxS > 0 && y.length > maxS * SR) y = y.slice(0, maxS * SR);
        return y;
      },
    }));
  }
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);

  const ORT_DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
  const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
  const { createFireRedRunner, parseKaldiCmvn } = await import(pathToFileURL(path.join(repo, "src/dsp/firered-vad.js")).href);
  const { LOCAL_MODEL_DIR: MD, LOCAL_MODEL_HINT } = await import(pathToFileURL(path.join(repo, "scripts/firered/local-model.mjs")).href);
  if (!existsSync(path.join(MD, "cmvn.ark"))) { console.error(`model files missing: ${LOCAL_MODEL_HINT}`); process.exit(2); }
  const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
  const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));
  let target = [];
  globalThis.self = { postMessage: (m) => target.push(m) };
  // Frozen clock: the detector's "slow" switch-off measures wall time; what
  // is measured here is a device that keeps up (as voice-gate-resonance.mjs).
  Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
  const W = await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href);
  const pitchOn = self.onmessage;

  for (const it of items) {
    const f32 = path.join(out, `${it.id}.f32`), js = path.join(out, `${it.id}.json`);
    if (existsSync(js)) continue;
    const t0 = Date.now();
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
    const nChunks = Math.ceil(y.length / CH);
    for (let k = 0; k < nChunks; k++) {
      const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
      port.onmessage({ data: { buffer: x.buffer, contextTime: Math.min(y.length, (k + 1) * CH) / SR } });
      await turn();
      for (const m of posts.slice(seen)) {
        if (m.type === "vad-status" && m.status !== "ready") throw new Error(`detector ${m.status}`);
        if (m.type === "status" && m.status === "error") throw new Error(`pitch worker error: ${m.message}`);
      }
      byChunk.push(posts.slice(seen).filter((m) => m.type === "pitch").map((m) => [m.voiced ? 1 : 0, m.pitch, m.contextTime, m.vad ? (m.vad.voice ? 1 : 0) : -1]));
      seen = posts.length;
    }
    for (let i = 0; i < 50; i++) await turn();
    byChunk[byChunk.length - 1].push(...posts.slice(seen).filter((m) => m.type === "pitch").map((m) => [m.voiced ? 1 : 0, m.pitch, m.contextTime, m.vad ? (m.vad.voice ? 1 : 0) : -1]));
    W.setVadModelLoaderForTests(null);
    writeFileSync(f32, Buffer.from(y.buffer, y.byteOffset, y.byteLength));
    writeFileSync(js, JSON.stringify({ id: it.id, sex: it.sex, dur: y.length / SR, byChunk }));
    console.log(`${it.id} (${it.sex}) ${(y.length / SR).toFixed(1)} s in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  process.exit(0);
}

// =================================================================== cue
if (mode === "cue") {
  const dir = arg("pitch", path.join(repo, "build/rstart/pitch"));
  const armName = arg("arm", "gated");
  const logId = arg("log", "");
  const { createLabEngine } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/lab-engine.js")).href);
  const { createNarrowbandDetector } = await import(pathToFileURL(path.join(repo, "src/resonance/narrowband.js")).href);
  const { createResonanceCue, START_COLLECT_S } = await import(pathToFileURL(path.join(repo, "src/resonance/resonanceCue.js")).href);
  const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
  const resDir = path.join(repo, "public/resonance-lab");
  const vtlnModel = JSON.parse(readFileSync(path.join(resDir, "vtln_warp.json"), "utf8"));
  const reference = JSON.parse(readFileSync(path.join(resDir, "reference.json"), "utf8"));
  const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const only = arg("only", "").split(",").filter(Boolean);
  const out = arg("out", "");
  if (out) mkdirSync(path.dirname(out), { recursive: true });
  const median = (v) => { const a = [...v].sort((x, y) => x - y), h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
  // Start rules (measurements/resonance-start-prereg-2026-10-26.md): S0 the
  // shipped startU; Pk a provisional shown start after k s of collection;
  // C6 a final start after 6 s of collection.
  // "tree": the tree's own snapshot (shownStartU when the cue posts one;
  // after the 2026-10-26 change it must equal P0 post for post).
  const CANDS = ["S0", "P0", "P2", "P4", "P6", "C6", "tree"];
  const WORDS = new Set(["about where you started", "brighter than your start", "darker than your start"]);

  // REAL worker (--worker): fake self + fetch, loaded once
  let resOn = null, wposts = null;
  if (process.argv.includes("--worker")) {
    globalThis.self = { postMessage: (m) => wposts.push(m) };
    globalThis.fetch = async (url) => {
      const file = path.join(resDir, String(url).split("resonance-lab/").pop());
      if (!existsSync(file)) return { ok: false, status: 404 };
      const txt = readFileSync(file, "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(txt) };
    };
    Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
    await import(pathToFileURL(path.join(repo, "src/resonance/resonance-worker.js")).href);
    resOn = self.onmessage;
  }

  for (const id of ids) {
    if (only.length && !only.includes(id)) continue;
    const meta = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8"));
    const b = readFileSync(path.join(dir, `${id}.f32`));
    const y = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const hint = (m) => ({ voiced: armName === "gated" && m[3] === 0 ? false : !!m[0], pitch: m[1], contextTime: m[2] });

    // replica of resonance-worker.js startEngine / onChunk / onPitchHint
    const cue = createResonanceCue({ reference });
    const plain = createResonanceCue({ reference, gate: false, restart: null }); // long-run value only
    const nb = createNarrowbandDetector();
    let verdict = "silent", latch = false, nbOn = false;
    const drop = { sustained: 0, warming: 0, latch: 0, narrowband: 0 };
    const dropS = { sustained: 0, warming: 0, latch: 0, narrowband: 0 };
    let lastStamp = null, admittedS = 0, nbOnEvents = 0;
    // the start collection, replicated from the cue's snapshot (checked
    // against the cue's own startU below)
    const col = { samples: [], vS: 0, final: null, c6: null };
    const engine = createLabEngine({
      sampleRate: SR, models: { vtln: vtlnModel }, reference, pitchSource: "frames",
      onStamped: (name, te, stampS, value) => {
        if (name !== "vtln") return;
        const delta = lastStamp === null ? 0 : Math.max(0, stampS - lastStamp);
        lastStamp = stampS;
        const why = nbOn ? "narrowband" : verdict === "sustained" ? "sustained" : verdict === "warming" ? "warming" : latch ? "latch" : null;
        const ok = cue.onStamped(te, stampS, value);
        if (ok !== (why === null)) throw new Error(`drop-reason bookkeeping out of step at ${te}`);
        if (why) { drop[why]++; dropS[why] += delta; } else {
          admittedS += delta;
          const s = cue.snapshot();
          if (col.final === null && s.fill >= 1 && s.uPlain !== null) {
            if (col.samples.length) col.vS += delta;
            col.samples.push(s.uPlain);
            if (col.c6 === null && col.vS >= 6) col.c6 = median(col.samples);
            if (col.vS >= START_COLLECT_S) col.final = median(col.samples);
          }
          if (col.final !== s.startU) throw new Error(`start replica out of step at ${te}: ${col.final} vs ${s.startU}`);
        }
        plain.onStamped(te, stampS, value);
      },
      onGridFrame: (j, f0, ring16) => {
        if (!(f0 > 0)) return;
        const st = nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000));
        if (st.on && !nbOn) { nbOnEvents++; if (col.final === null) { col.samples = []; col.vS = 0; } }
        nbOn = st.on;
        cue.noteNarrowband(st.on);
      },
    });
    let wstate = null, wmismatch = 0, wchecked = 0;
    if (resOn) {
      wposts = [];
      resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: true } });
      for (let i = 0; i < 200 && !wposts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
      wstate = {};
      resOn({ data: { type: "audioPort", port: wstate } });
    }
    let sincePost = 0;
    const trace = [];
    let tFill = null, tStart = null, tDecided = null, startU = null;
    let lastVoiced = false, lastVoicedT = -Infinity;
    const C = Object.fromEntries(CANDS.map((c) => [c, { first: null, posts: [], jumpPrev: null }]));
    const longRun = [];
    const nC = meta.byChunk.length;
    for (let k = 0; k < nC; k++) {
      const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
      const ct = Math.min(y.length, (k + 1) * CH) / SR;
      verdict = cue.noteChunk(ct);
      if (verdict === "sustained") latch = true; else if (verdict === "score" || verdict === "pause") latch = false;
      engine.pushChunk(x, null, ct);
      if (resOn) {
        const before = wposts.length;
        wstate.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
        for (const m of meta.byChunk[k]) resOn({ data: { type: "pitch-hint", ...hint(m) } });
        for (const m of wposts.slice(before)) {
          if (m.type === "status") throw new Error(`worker status ${m.status} ${m.message ?? ""}`);
          if (m.type === "state") {
            const s = cue.snapshot();
            wchecked++;
            if (m.startU !== s.startU || m.shownStartU !== s.shownStartU || m.fill !== s.fill || m.voicedS !== s.voicedS) wmismatch++;
          }
        }
      }
      for (const m of meta.byChunk[k]) {
        const h = hint(m);
        cue.notePitchHint(h);
        plain.notePitchHint(h);
        engine.pushPitchFrame(h.contextTime, h.voiced ? h.pitch : 0);
        lastVoiced = h.voiced;
        if (h.voiced) lastVoicedT = h.contextTime;
      }
      sincePost += x.length / SR;
      if (sincePost >= 0.2) {
        sincePost = 0;
        const s = cue.snapshot();
        const dec = nb.state.decided;
        if (tFill === null && s.fill >= 1) tFill = ct;
        if (tDecided === null && dec) tDecided = ct;
        if (tStart === null && s.startU !== null) { tStart = ct; startU = s.startU; }
        const p = plain.snapshot();
        if (p.u !== null) longRun.push([ct, p.u]);
        // the row, per candidate start (the worker's post: u withheld until the detector decided)
        const post = { u: dec ? s.u : null, raw: dec ? s.raw : null, fill: s.fill, voicedS: s.voicedS, clamp: dec ? s.clamp : 0, verdict: s.verdict,
          sinceResumeS: s.sinceResumeS, narrowband: { on: nb.state.on, decided: dec } };
        const voiced = lastVoiced, holding = !lastVoiced && ct - lastVoicedT <= 5;
        const state = CS.resonanceRowState({ workerStatus: "ready", snap: post, voiced, holding });
        const prov = col.samples.length ? median(col.samples) : null;
        for (const c of CANDS) {
          let su;
          if (c === "S0") su = s.startU;
          else if (c === "tree") su = CS.shownStart ? CS.shownStart(s) : s.startU;
          else if (c === "C6") su = col.c6;
          else su = s.startU ?? (prov !== null && col.vS >= Number(c.slice(1)) ? prov : null);
          if (c[0] === "P" && s.startU === null) C[c].jumpPrev = su;
          if (c[0] === "P" && s.startU !== null && C[c].jump === undefined) C[c].jump = C[c].jumpPrev === null ? null : Math.abs(C[c].jumpPrev - s.startU);
          const hdr = CS.resonanceHeader(state, { ...post, startU: su });
          const word = (state === "live" || state === "holding") && WORDS.has(hdr);
          if (word && C[c].first === null) C[c].first = ct;
          if (word) C[c].posts.push([+ct.toFixed(2), hdr === "about where you started" ? 0 : 1]);
        }
        if (logId === id) trace.push({ t: +ct.toFixed(2), state, verdict: s.verdict, fill: +s.fill.toFixed(3), voicedS: +s.voicedS.toFixed(2), admittedS: +admittedS.toFixed(2), startProgress: +s.startProgress.toFixed(3), startU: s.startU, u: s.u, nb: nb.state.on ? 1 : 0, nbDecided: dec ? 1 : 0, drop: { ...drop } });
      }
    }
    const dur = nC * CH / SR;
    const half = longRun.filter(([t]) => t >= dur / 2).map(([, u]) => u);
    const ltm = half.length ? median(half) : null;
    const s = cue.snapshot();
    const cands = Object.fromEntries(CANDS.map((c) => [c, {
      first: C[c].first,
      final: c === "C6" ? col.c6 : s.startU,
      ...(c === "tree" ? { samePosts: JSON.stringify(C.tree.posts) === JSON.stringify(C.P0.posts) && C.tree.first === C.P0.first } : {}),
      jump: C[c].jump ?? null,
      posts: C[c].posts,
    }]));
    const row = {
      id, sex: meta.sex, arm: armName, dur, tFill, tDecided, tStart, startU, longRunU: ltm,
      startErr: startU !== null && ltm !== null ? startU - ltm : null,
      binsAdmitted: s.binsAdmitted, binsDropped: s.binsDropped, drop, dropS, admittedS, nbOnEvents,
      resumes: s.resumes, restarts: s.restarts, cands,
      ...(resOn ? { worker: { checked: wchecked, mismatch: wmismatch } } : {}),
    };
    if (out) appendFileSync(out, JSON.stringify(row) + "\n");
    if (logId === id) writeFileSync(arg("trace", path.join(repo, `build/rstart/trace-${id}-${armName}.json`)), JSON.stringify(trace));
    console.log(`${id} ${meta.sex} ${armName}: fill ${tFill?.toFixed(1)} s, start ${tStart?.toFixed(1) ?? "never"} s (u ${startU?.toFixed(2)} vs long-run ${ltm?.toFixed(2)}), first word ${CANDS.map((c) => `${c} ${C[c].first?.toFixed(1)}`).join(" ")}, admitted ${s.binsAdmitted} dropped ${s.binsDropped} ${JSON.stringify(drop)}${resOn ? ` worker ${wmismatch}/${wchecked} mismatches` : ""}`);
  }
  process.exit(0);
}
console.error("usage: start-reference.mjs pitch|cue …");
process.exit(2);
