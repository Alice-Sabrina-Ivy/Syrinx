// wasm_bench.mjs — V4 CPU measurement for the Silero VAD candidate
// (voice-detector benchmark, 2026-10-06): the same streaming protocol as
// run_silero.py (16 kHz, 512-sample chunks + 64-sample past context, LSTM
// state carried), run with onnxruntime-web's WASM backend, 1 thread, on real
// benchmark streams. Reports ms per 32 ms chunk (session.run + tensor
// creation, i.e. the per-chunk cost a worker would pay) and ms per 25 ms of
// audio, and checks the WASM probabilities against the reference files
// run_silero.py wrote (onnxruntime CPU EP).
//
//   node scripts/voice-detector/silero/wasm_bench.mjs --ort=<dir with node_modules/onnxruntime-web>
//        [--model=PATH] [--root=build/vad] [--cand=build/vad/cand/silero]
//        [--mode=node|chrome] [--chrome=PATH] [--per-set=3] [--json=OUT]
//
// mode=chrome launches a headless Chrome with its own --user-data-dir (temp),
// serves the page + ort files + model + audio from 127.0.0.1, and on exit
// closes ONLY that browser (browser.close(), then taskkill /pid <its PID> /T /F
// if it is still alive) — never a name-based kill (CLAUDE.md hard rule 2).
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { tmpdir, cpus } from "node:os";
import { spawnSync } from "node:child_process";
import { listStreams, loadAudio } from "../lib/streams.mjs";

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? "1"];
}));
const ROOT = A.root ?? "build/vad";
const CAND = A.cand ?? join(ROOT, "cand", "silero");
const MODEL = A.model ?? join(ROOT, "silero", "dl", "silero-vad-6.2.3", "src", "silero_vad", "data", "silero_vad.onnx");
const ORT_DIR = resolve(A.ort ?? ".", "node_modules", "onnxruntime-web");
const MODE = A.mode ?? "node";
const PER_SET = Number(A["per-set"] ?? 3);
const CHUNK = 512, CTX = 64;
const BENCH_SETS = ["noise", "noiseho", "vin0", "vocalset", "pvqd", "hil", "voiced"]; // 16 kHz sets: no resampling in the loop

function pickStreams() {
  const out = [];
  for (const s of BENCH_SETS) {
    const ms = listStreams(ROOT, [s]);
    // deterministic spread over the set
    for (let k = 0; k < PER_SET && ms.length; k++) out.push(ms[Math.floor((k * ms.length) / PER_SET)]);
  }
  return out;
}

// the streaming loop, shared verbatim by node mode and the chrome page
const LOOP_SRC = `
async function sileroStream(ort, sess, x) {
  const CHUNK = ${CHUNK}, CTX = ${CTX};
  const n = Math.floor(x.length / CHUNK);
  const probs = new Float32Array(n);
  const buf = new Float32Array(CTX + CHUNK);
  let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    buf.set(x.subarray(i * CHUNK, (i + 1) * CHUNK), CTX);
    const input = new ort.Tensor("float32", buf.slice(), [1, CTX + CHUNK]);
    const out = await sess.run({ input, state, sr });
    probs[i] = out.output.data[0];
    state = out.stateN;
    buf.copyWithin(0, CHUNK, CHUNK + CTX);
    times[i] = performance.now() - t0;
  }
  return { probs, times };
}`;

function summarize(times) {
  const a = Float64Array.from(times).sort();
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { chunks: a.length, mean_ms: mean, median_ms: q(0.5), p95_ms: q(0.95), p99_ms: q(0.99) };
}

function parity(stream, probs) {
  const fp = join(CAND, stream.set, `${stream.id}.f32`);
  if (!existsSync(fp)) return null;
  const b = readFileSync(fp);
  const ref = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  let mx = 0;
  const n = Math.min(ref.length, probs.length);
  for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(ref[i] - probs[i]));
  return { n, len_ref: ref.length, len_wasm: probs.length, max_abs_diff: mx };
}

async function runNode(streams) {
  const ort = await import(pathToFileURL(join(ORT_DIR, "dist", "ort.node.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  const sess = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const sileroStream = new Function(`${LOOP_SRC}; return sileroStream;`)();
  // warm-up
  await sileroStream(ort, sess, new Float32Array(CHUNK * 50));
  const all = [], par = [];
  let audioS = 0;
  const t0 = performance.now();
  for (const m of streams) {
    const { samples } = loadAudio(m);
    const { probs, times } = await sileroStream(ort, sess, samples);
    all.push(...times);
    audioS += samples.length / 16000;
    par.push({ stream: `${m.set}/${m.id}`, ...parity(m, probs) });
  }
  const wall = performance.now() - t0;
  return { runtime: `node ${process.version}, onnxruntime-web ${ort.env.versions?.web ?? "?"} (ort.node.min.mjs, wasm EP, 1 thread)`, wall_ms: wall, audio_s: audioS, per_chunk: summarize(all), parity: par };
}

async function runChrome(streams) {
  const puppeteer = (await import(pathToFileURL(resolve("node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "puppeteer-core.js")).href)).default;
  const chromePath = A.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const audio = streams.map((m) => loadAudio(m).samples);
  const page = `<!doctype html><meta charset="utf-8"><title>silero bench</title><script type="module">
    import * as ort from "/ort/ort.wasm.min.mjs";
    ${LOOP_SRC}
    window.__run = async (nStreams) => {
      ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = "/ort/";
      const model = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
      const sess = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      await sileroStream(ort, sess, new Float32Array(${CHUNK} * 50));
      const res = [];
      const t0 = performance.now();
      for (let k = 0; k < nStreams; k++) {
        const x = new Float32Array(await (await fetch("/audio/" + k)).arrayBuffer());
        const { probs, times } = await sileroStream(ort, sess, x);
        res.push({ probs: Array.from(probs), times: Array.from(times) });
      }
      return { res, wall: performance.now() - t0, ua: navigator.userAgent, ver: ort.env.versions };
    };
    window.__ready = true;
  </script>`;
  const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" };
  const server = createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    try {
      if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
      if (u === "/model.onnx") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(readFileSync(MODEL)); }
      if (u.startsWith("/audio/")) { const x = audio[Number(u.slice(7))]; res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); }
      if (u.startsWith("/ort/")) {
        const f = join(ORT_DIR, "dist", u.slice(5).replace(/\.\./g, ""));
        res.writeHead(200, { "content-type": types[f.slice(f.lastIndexOf("."))] ?? "application/octet-stream" });
        return res.end(readFileSync(f));
      }
    } catch (e) { /* fall through */ }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "silero-bench-chrome-"));
  let browser = null, pid = null;
  const cleanup = () => {
    if (pid) { try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } pid = null; }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
  };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(1); });
  process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
  try {
    browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ["--no-first-run", "--no-default-browser-check"] });
    pid = browser.process()?.pid ?? null;
    const pg = await browser.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`);
    await pg.waitForFunction("window.__ready === true", { timeout: 30000 });
    const out = await pg.evaluate((n) => window.__run(n), audio.length);
    const all = [], par = [];
    let audioS = 0;
    out.res.forEach((r, k) => { all.push(...r.times); audioS += audio[k].length / 16000; par.push({ stream: `${streams[k].set}/${streams[k].id}`, ...parity(streams[k], r.probs) }); });
    return { runtime: `${out.ua}; onnxruntime-web ${out.ver?.web ?? "?"} (ort.wasm.min.mjs, wasm EP, 1 thread)`, wall_ms: out.wall, audio_s: audioS, per_chunk: summarize(all), parity: par };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* fall back to the PID kill */ } }
    cleanup();
    server.close();
  }
}

const streams = pickStreams();
const r = MODE === "chrome" ? await runChrome(streams) : await runNode(streams);
const perChunk = r.wall_ms / r.per_chunk.chunks;
r.mode = MODE;
r.cpu = cpus()[0]?.model;
r.model = MODEL;
r.model_bytes = readFileSync(MODEL).length;
r.ms_per_chunk_wall = perChunk;
r.ms_per_25ms = perChunk * 25 / 32;
r.max_parity_diff = Math.max(...r.parity.filter((p) => p.max_abs_diff != null).map((p) => p.max_abs_diff));
const short = { ...r, parity: `${r.parity.length} streams, max |p_wasm - p_ref| = ${r.max_parity_diff}` };
console.log(JSON.stringify(short, null, 1));
if (A.json) writeFileSync(A.json, JSON.stringify(r, null, 1));
