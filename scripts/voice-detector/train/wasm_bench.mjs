// wasm_bench.mjs — V4 CPU measurement of the custom voice detector
// (2026-10-06): the exported streaming ONNX model (export.py) run with
// onnxruntime-web's WASM backend, 1 thread, the way a deployed gate would run
// it: one session.run per 25 ms capture chunk = 400 new 16 kHz samples = 2
// frames, state carried run to run. Reports ms per 25 ms of audio (session.run
// + tensor creation) and checks the WASM probabilities against the reference
// files the Python runner wrote (onnxruntime CPU EP, infer.py --engine onnx).
// Streams: 16 kHz VALIDATION streams only (vneg + LibriSpeech val voice), so
// no evaluation stream is touched before the model is frozen.
//
//   node scripts/voice-detector/train/wasm_bench.mjs --ort=<dir with node_modules/onnxruntime-web> --model=FILE.onnx
//        [--val=build/vad-train/val] [--ref=<candidate dir with vneg/ vvoice/ .f32>] [--mode=node|chrome]
//        [--chrome=PATH] [--n=6] [--sec=60] [--json=OUT]
//
// mode=chrome launches a headless Chrome with its own temporary --user-data-dir,
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
const VAL = A.val ?? "build/vad-train/val";
const MODEL = A.model;
const REF = A.ref ?? null;
const ORT_DIR = resolve(A.ort ?? ".", "node_modules", "onnxruntime-web");
const MODE = A.mode ?? "node";
const N = Number(A.n ?? 6), SEC = Number(A.sec ?? 60);
const HOP = 200, CTX = 312, PADEXTRA = 4; // stream = 4 zeros + samples after a 312-sample zero context (tcommon.PAD = 316)

function pickStreams() {
  const neg = listStreams(VAL, ["vneg"]);
  const voi = listStreams(VAL, ["vvoice"]).filter((m) => m.sr === 16000);
  const out = [];
  for (let k = 0; k < N / 2; k++) out.push(neg[Math.floor((k * neg.length) / (N / 2))]);
  for (let k = 0; k < N / 2 && voi.length; k++) out.push(voi[Math.floor((k * voi.length) / (N / 2))]);
  return out.filter(Boolean);
}

// the streaming loop, shared verbatim by node mode and the chrome page
const LOOP_SRC = `
async function vdStream(ort, sess, x, shapes) {
  const HOP = ${HOP}, CTX = ${CTX}, PADEXTRA = ${PADEXTRA}, PER = 2;
  const xs = new Float32Array(PADEXTRA + x.length); xs.set(x, PADEXTRA);
  const n = Math.floor(xs.length / HOP);
  const probs = new Float32Array(n);
  const st = {};
  for (const [name, shape] of Object.entries(shapes)) st[name] = new ort.Tensor("float32", new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
  const times = [];
  for (let i = 0; i + PER <= n; i += PER) {
    const t0 = performance.now();
    const chunk = new ort.Tensor("float32", xs.slice(i * HOP, (i + PER) * HOP), [1, PER * HOP]);
    const out = await sess.run({ chunk, ...st });
    probs.set(out.p.data, i);
    st.ctx = out.ctx_out; st.s0 = out.s0_out; st.s1 = out.s1_out; st.s2 = out.s2_out; st.h = out.h_out;
    times.push(performance.now() - t0);
  }
  return { probs: probs.subarray(0, Math.floor(n / PER) * PER), times };
}`;

function shapesOf(sess) {
  // state shapes from the model's input metadata (dims are static except chunk)
  const out = {};
  for (const name of sess.inputNames) {
    if (name === "chunk") continue;
    const md = sess.inputMetadata?.find?.((m) => m.name === name);
    out[name] = md?.shape ?? null;
  }
  return out;
}

function summarize(times) {
  const a = Float64Array.from(times).sort();
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { runs: a.length, mean_ms: mean, median_ms: q(0.5), p95_ms: q(0.95), p99_ms: q(0.99) };
}

function parity(stream, probs) {
  if (!REF) return null;
  const fp = join(REF, stream.set, `${stream.id}.f32`);
  if (!existsSync(fp)) return null;
  const b = readFileSync(fp);
  const ref = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  let mx = 0;
  const n = Math.min(ref.length, probs.length);
  for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(ref[i] - probs[i]));
  return { n, max_abs_diff: mx };
}

function staticShapes() {
  // read once with onnxruntime-node-free logic: the python exporter fixes them; pass via --shapes or derive by a probe
  return JSON.parse(A.shapes ?? "null");
}

async function runNode(streams) {
  const ort = await import(pathToFileURL(join(ORT_DIR, "dist", "ort.node.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  const sess = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const shapes = staticShapes() ?? shapesOf(sess);
  const vdStream = new Function(`${LOOP_SRC}; return vdStream;`)();
  await vdStream(ort, sess, new Float32Array(16000 * 2), shapes); // warm-up
  const all = [], par = [];
  let audioS = 0;
  const t0 = performance.now();
  for (const m of streams) {
    const x = loadAudio(m).samples.subarray(0, SEC * 16000);
    const { probs, times } = await vdStream(ort, sess, x, shapes);
    all.push(...times);
    audioS += x.length / 16000;
    par.push({ stream: `${m.set}/${m.id}`, ...parity(m, probs) });
  }
  const wall = performance.now() - t0;
  return { runtime: `node ${process.version}, onnxruntime-web ${ort.env.versions?.web ?? "?"} (ort.node.min.mjs, wasm EP, 1 thread)`, wall_ms: wall, audio_s: audioS, per_run: summarize(all), parity: par };
}

async function runChrome(streams) {
  const puppeteer = (await import(pathToFileURL(resolve("node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "puppeteer-core.js")).href)).default;
  const chromePath = A.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const audio = streams.map((m) => loadAudio(m).samples.subarray(0, SEC * 16000));
  const shapes = staticShapes();
  if (!shapes) throw new Error("--shapes=<json> required in chrome mode");
  const page = `<!doctype html><meta charset="utf-8"><title>vd bench</title><script type="module">
    import * as ort from "/ort/ort.wasm.min.mjs";
    ${LOOP_SRC}
    window.__run = async (nStreams, shapes) => {
      ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = "/ort/";
      const model = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
      const sess = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      await vdStream(ort, sess, new Float32Array(16000 * 2), shapes);
      const res = [];
      const t0 = performance.now();
      for (let k = 0; k < nStreams; k++) {
        const x = new Float32Array(await (await fetch("/audio/" + k)).arrayBuffer());
        const { probs, times } = await vdStream(ort, sess, x, shapes);
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
      if (u.startsWith("/audio/")) { const x = Float32Array.from(audio[Number(u.slice(7))]); res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(Buffer.from(x.buffer)); }
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
  const profile = mkdtempSync(join(tmpdir(), "vd-bench-chrome-"));
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
    const out = await pg.evaluate((n, sh) => window.__run(n, sh), audio.length, shapes);
    const all = [], par = [];
    let audioS = 0;
    out.res.forEach((r, k) => { all.push(...r.times); audioS += audio[k].length / 16000; par.push({ stream: `${streams[k].set}/${streams[k].id}`, ...parity(streams[k], r.probs) }); });
    return { runtime: `${out.ua}; onnxruntime-web ${out.ver?.web ?? "?"} (ort.wasm.min.mjs, wasm EP, 1 thread)`, wall_ms: out.wall, audio_s: audioS, per_run: summarize(all), parity: par };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* fall back to the PID kill */ } }
    cleanup();
    server.close();
  }
}

const streams = pickStreams();
const r = MODE === "chrome" ? await runChrome(streams) : await runNode(streams);
r.mode = MODE;
r.cpu = cpus()[0]?.model;
r.model = MODEL;
r.model_bytes = readFileSync(MODEL).length;
r.ms_per_25ms = r.per_run.mean_ms;          // one run = 2 frames = 25 ms of audio
r.ms_per_25ms_wall = r.wall_ms / r.per_run.runs;
const ds = r.parity.map((p) => p.max_abs_diff).filter((v) => v != null);
r.max_parity_diff = ds.length ? Math.max(...ds) : null;
console.log(JSON.stringify({ ...r, parity: `${r.parity.length} streams, max |p_wasm - p_ref| = ${r.max_parity_diff}` }, null, 1));
if (A.json) writeFileSync(A.json, JSON.stringify(r, null, 1));
