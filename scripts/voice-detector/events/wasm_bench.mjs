// wasm_bench.mjs — V4 CPU measurement for the YAMNet candidate (voice-detector
// benchmark, 2026-10-06, audio-event candidate): the full streaming detector
// as a browser would run it — JS log-mel front end (periodic Hann 400, hop 160,
// FFT 512, the TF mel matrix 125-7500 Hz x 64, log(mel + 0.001), 95 frames of
// silence history) + the ONNX core with onnxruntime-web's WASM backend,
// 1 thread, one 96-frame patch every H mel frames — on real benchmark
// streams. Reports the CPU per 25 ms of audio (front end + inference, i.e.
// what a worker pays) and checks the WASM voice probabilities against the
// files run_yamnet.py wrote (onnxruntime CPU EP).
//
//   node scripts/voice-detector/events/wasm_bench.mjs --ort=<dir with node_modules/onnxruntime-web>
//        [--model=build/vad/events/model/yamnet_core_pw8d16.onnx] [--hops=2,6,12,14,16] [--T=96]
//        [--per-set=2] [--mode=node|chrome] [--chrome=PATH] [--json=OUT] [--dump-probs=OUT]
// --dump-probs writes the WASM voice probabilities (sum of the vocal scores,
// unclipped) per "H|set/id" for wasm_parity.py.
//
// mode=chrome launches a headless Chrome with its own --user-data-dir (temp),
// serves the page + ort files + model + audio from 127.0.0.1, and on exit
// closes ONLY that browser (browser.close(), then taskkill /pid <its PID> /T /F
// if it is still alive) — never a name-based kill (CLAUDE.md hard rule 2).
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const MODEL = A.model ?? join(ROOT, "events", "model", "yamnet_core_pw8d16.onnx");
const MELF = A.mel ?? join(ROOT, "events", "model", "mel_257x64.f32");
const ORT_DIR = resolve(A.ort ?? ".", "node_modules", "onnxruntime-web");
const MODE = A.mode ?? "node";
const PER_SET = Number(A["per-set"] ?? 2);
const HOPS = (A.hops ?? "2,6,12,14,16").split(",").map(Number);
const T = Number(A.T ?? 96);
const BENCH_SETS = ["noise", "noiseho", "vin0", "vocalset", "pvqd", "hil", "voiced"]; // 16 kHz sets
// yamnet_lib.VOCAL (the human-vocal classes, summed into the voice probability)
const VOCAL = [0, 1, 2, 3, 4, ...Array.from({ length: 29 }, (_, i) => 6 + i), 65, 213, 233, 249, 250, 261, 266];

function pickStreams() {
  const out = [];
  for (const s of BENCH_SETS) {
    const ms = listStreams(ROOT, [s]);
    for (let k = 0; k < PER_SET && ms.length; k++) out.push(ms[Math.floor((k * ms.length) / PER_SET)]);
  }
  return out;
}

// the streaming detector, shared verbatim by node mode and the chrome page
const LOOP_SRC = `
function makeFront(mel) {
  const N = 512, W = 400, NB = 257, NM = 64;
  const win = new Float64Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W);
  const re = new Float64Array(N), im = new Float64Array(N);
  const rev = new Uint16Array(N);
  for (let i = 0, j = 0; i < N; i++) { rev[i] = j; let b = N >> 1; while (j & b) { j ^= b; b >>= 1; } j |= b; }
  const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = -Math.sin(2 * Math.PI * i / N); }
  const mag = new Float64Array(NB);
  // sparse mel: per mel band the nonzero bin range
  const lo = new Int32Array(NM), hi = new Int32Array(NM);
  for (let m = 0; m < NM; m++) { lo[m] = NB; hi[m] = -1; for (let k = 0; k < NB; k++) if (mel[k * NM + m] !== 0) { lo[m] = Math.min(lo[m], k); hi[m] = k; } }
  return function frame(buf, off, out, outOff) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < W; i++) re[rev[i]] = buf[off + i] * win[i];
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let k = 0; k < half; k++) {
        const c = cosT[k * step], d = sinT[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let k = 0; k < NB; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    for (let m = 0; m < NM; m++) { let s = 0; for (let k = lo[m]; k <= hi[m]; k++) s += mag[k] * mel[k * NM + m]; out[outOff + m] = Math.log(s + 0.001); }
  };
}
async function yamnetStream(ort, sess, x, H, T, mel, VOCAL) {
  // x: 16 kHz samples. Delivered in 25 ms chunks (400 samples) as the app's capture does.
  const PAD = 95 * 160, W = 400, HOP = 160, NM = 64;
  const front = makeFront(mel);
  const pcm = new Float32Array(PAD + x.length); pcm.set(x, PAD);   // zeros = silence history
  const ring = new Float32Array(T * NM);                            // last T log-mel rows (oldest first)
  const patch = new Float32Array(T * NM);
  const row = new Float32Array(NM);
  let rows = 0, nextRowStart = 0, tMel = 0, tInf = 0, nInf = 0;
  const probs = [];
  // the 95 history rows are pure silence except the last two, which overlap the first samples:
  // compute every row from the padded buffer; time only what happens once audio arrives
  let avail = PAD;
  const pushRow = () => { ring.copyWithin(0, NM); ring.set(row, (T - 1) * NM); rows++; };
  while (nextRowStart + W <= avail) { front(pcm, nextRowStart, row, 0); pushRow(); nextRowStart += HOP; }
  for (let c = 0; c + 400 <= x.length; c += 400) {
    avail = PAD + c + 400;
    while (nextRowStart + W <= avail) {
      const t0 = performance.now();
      front(pcm, nextRowStart, row, 0); pushRow(); nextRowStart += HOP;
      const t1 = performance.now(); tMel += t1 - t0;
      const j = rows - 1;  // padded row index
      if (j >= 95 && (j - 95) % H === 0) {
        patch.set(ring);
        const out = await sess.run({ patches: new ort.Tensor("float32", patch.slice(), [1, T, NM]) });
        const sc = out.scores.data;
        let v = 0; for (const k of VOCAL) v += sc[k];
        probs.push(v);
        tInf += performance.now() - t1; nInf++;
      }
    }
  }
  return { probs, tMel, tInf, nInf, n25: Math.floor(x.length / 400) };
}`;

function loadMel() {
  const b = readFileSync(MELF);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

function report(name, streams, runs, rt) {
  const res = { runtime: rt, cpu: cpus()[0]?.model, model: MODEL, model_bytes: readFileSync(MODEL).length, T, hops: {} };
  for (const H of HOPS) {
    let tMel = 0, tInf = 0, nInf = 0, n25 = 0;
    for (const r of runs[H]) { tMel += r.tMel; tInf += r.tInf; nInf += r.nInf; n25 += r.n25; }
    res.hops[H] = {
      hop_ms: H * 10, streams: runs[H].length, audio_s: n25 * 0.025, inferences: nInf,
      ms_per_inference: tInf / nInf, frontend_ms_per_25ms: tMel / n25, infer_ms_per_25ms: tInf / n25,
      ms_per_25ms: (tMel + tInf) / n25,
    };
  }
  return res;
}

async function runNode(streams, mel) {
  const ort = await import(pathToFileURL(join(ORT_DIR, "dist", "ort.node.min.mjs")).href);
  ort.env.wasm.numThreads = 1;
  const sess = await ort.InferenceSession.create(readFileSync(MODEL), { executionProviders: ["wasm"], graphOptimizationLevel: "all", extra: { session: { disable_quant_qdq: "1" } } });
  const yamnetStream = new Function(`${LOOP_SRC}; return yamnetStream;`)();
  await yamnetStream(ort, sess, new Float32Array(16000 * 2), 2, T, mel, VOCAL); // warm-up
  const runs = {}, probs = {};
  for (const H of HOPS) {
    runs[H] = [];
    for (const m of streams) {
      const { samples } = loadAudio(m);
      const r = await yamnetStream(ort, sess, samples, H, T, mel, VOCAL);
      runs[H].push(r);
      probs[`${H}|${m.set}/${m.id}`] = r.probs;
    }
  }
  return { rt: `node ${process.version}, onnxruntime-web ${ort.env.versions?.web ?? "?"} (ort.node.min.mjs, wasm EP, 1 thread, SIMD)`, runs, probs };
}

async function runChrome(streams, mel) {
  const puppeteer = (await import(pathToFileURL(resolve(A.ort ?? ".", "node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "puppeteer-core.js")).href)).default;
  const chromePath = A.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const audio = streams.map((m) => loadAudio(m).samples);
  const page = `<!doctype html><meta charset="utf-8"><title>yamnet bench</title><script type="module">
    import * as ort from "/ort/ort.wasm.min.mjs";
    ${LOOP_SRC}
    window.__run = async (nStreams, hops, T, VOCAL) => {
      ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = "/ort/";
      const model = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
      const mel = new Float32Array(await (await fetch("/mel")).arrayBuffer());
      const sess = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all", extra: { session: { disable_quant_qdq: "1" } } });
      await yamnetStream(ort, sess, new Float32Array(32000), 2, T, mel, VOCAL);
      const xs = [];
      for (let k = 0; k < nStreams; k++) xs.push(new Float32Array(await (await fetch("/audio/" + k)).arrayBuffer()));
      const out = {};
      for (const H of hops) { out[H] = []; for (const x of xs) out[H].push(await yamnetStream(ort, sess, x, H, T, mel, VOCAL)); }
      return { out, ua: navigator.userAgent, ver: ort.env.versions };
    };
    window.__ready = true;
  </script>`;
  const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" };
  const server = createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    try {
      if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
      if (u === "/model.onnx") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(readFileSync(MODEL)); }
      if (u === "/mel") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(readFileSync(MELF)); }
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
  const profile = mkdtempSync(join(tmpdir(), "yamnet-bench-chrome-"));
  let browser = null, pid = null;
  const cleanup = () => {
    if (pid) { try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } pid = null; }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
  };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(1); });
  process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
  try {
    browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, protocolTimeout: 1800000, args: ["--no-first-run", "--no-default-browser-check"] });
    pid = browser.process()?.pid ?? null;
    const pg = await browser.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`);
    await pg.waitForFunction("window.__ready === true", { timeout: 30000 });
    const out = await pg.evaluate((n, hops, T, VOCAL) => window.__run(n, hops, T, VOCAL), audio.length, HOPS, T, VOCAL);
    const runs = {}, probs = {};
    for (const H of HOPS) {
      runs[H] = out.out[H];
      out.out[H].forEach((r, k) => { probs[`${H}|${streams[k].set}/${streams[k].id}`] = r.probs; });
    }
    return { rt: `${out.ua}; onnxruntime-web ${out.ver?.web ?? "?"} (ort.wasm.min.mjs, wasm EP, 1 thread, SIMD)`, runs, probs };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* fall back to the PID kill */ } }
    cleanup();
    server.close();
  }
}

const streams = pickStreams();
const mel = loadMel();
const t0 = Date.now();
const r = MODE === "chrome" ? await runChrome(streams, mel) : await runNode(streams, mel);
const out = report(MODE, streams, r.runs, r.rt);
out.mode = MODE;
out.wall_s = (Date.now() - t0) / 1000;
out.streams = streams.map((m) => `${m.set}/${m.id}`);
console.log(JSON.stringify(out, null, 1));
if (A["dump-probs"]) writeFileSync(A["dump-probs"], JSON.stringify(r.probs));
if (A.json) writeFileSync(A.json, JSON.stringify(out, null, 1));
