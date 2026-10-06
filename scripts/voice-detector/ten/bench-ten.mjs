// bench-ten.mjs — desktop CPU of the official TEN VAD browser build
// (lib/Web/ten_vad.{js,wasm}) for the voice-detector benchmark's V4
// (2026-10-06). Runs the same WASM module on the same 16 kHz audio in
//   (a) Node's V8 WebAssembly, and
//   (b) a headless desktop Chrome (puppeteer-core) — the browser runtime,
// warm-up pass + REPS timed passes, each a fresh VAD instance fed 256-sample
// hops, and reports ms of CPU per 25 ms of audio (median over passes) and
// per-call latency percentiles (Node).
//
//   node scripts/voice-detector/ten/bench-ten.mjs [--stream=vin20/<id>] [--reps=7] [--chrome=PATH] [--no-chrome]
//
// Process contract (CLAUDE.md hard rule 2): the spawned Chrome uses a fresh
// per-run --user-data-dir; cleanup is browser.close(), with a fallback that
// tree-kills ONLY the spawned PID (taskkill /pid <PID> /T /F). Never by name.
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, cpus } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listStreams, loadAudio } from "../lib/streams.mjs";
import { loadTen, to16k, toInt16 } from "./run-ten.mjs";

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v ?? "1"];
}));
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const ROOT = resolve(REPO, A.root ?? "build/vad");
const TEN = resolve(REPO, A.ten ?? "build/vad/ten/src");
const REPS = Number(A.reps ?? 7);
const CHROME = A.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HOP = 256;

function pickAudio() {
  const [set, id] = (A.stream ?? "").split("/");
  const all = listStreams(ROOT, [set || "vin20"]);
  const meta = id ? all.find((m) => m.id === id) : all.find((m) => m.audio.len / m.audio.sr > 45);
  const { samples, sr } = loadAudio(meta);
  return { meta, x16: toInt16(to16k(samples, sr)) };
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const median = (a) => pct(a, 0.5);

async function benchNode(x16) {
  const ten = await loadTen(TEN);
  const nf = Math.floor(x16.length / HOP);
  ten.run(x16); // warm-up (JIT tiers up)
  const per = [];
  for (let r = 0; r < REPS; r++) {
    const t = { ms: 0, frames: 0 };
    ten.run(x16, t);
    per.push((t.ms / (t.frames * 16)) * 25);
  }
  // per-call latency, one pass
  const { M } = ten;
  const hp = M._malloc(4), buf = M._malloc(HOP * 2), pp = M._malloc(4), fp = M._malloc(4);
  M._ten_vad_create(hp, HOP, 0.5);
  const h = M.HEAP32[hp >> 2];
  const calls = new Float64Array(nf);
  for (let i = 0; i < nf; i++) {
    M.HEAP16.set(x16.subarray(i * HOP, (i + 1) * HOP), buf >> 1);
    const t0 = performance.now();
    M._ten_vad_process(h, buf, HOP, pp, fp);
    calls[i] = performance.now() - t0;
  }
  M._ten_vad_destroy(hp);
  return { runtime: `Node ${process.version} V8 WebAssembly`, passes_ms_per_25ms: per, ms_per_25ms: median(per),
    call_us: { p50: pct(calls, 0.5) * 1000, p95: pct(calls, 0.95) * 1000, p99: pct(calls, 0.99) * 1000, max: Math.max(...calls) * 1000 } };
}

async function benchChrome(x16) {
  const puppeteer = (await import("puppeteer-core")).default;
  const http = await import("node:http");
  const web = join(TEN, "lib", "Web");
  // serve the official module + wasm + the audio from 127.0.0.1 (a blob: module
  // cannot resolve the glue code's relative wasm URL)
  const files = {
    "/": ["text/html", Buffer.from("<!doctype html><meta charset=utf-8><title>ten bench</title>")],
    "/ten_vad.js": ["text/javascript", readFileSync(join(web, "ten_vad.js"))],
    "/ten_vad.wasm": ["application/wasm", readFileSync(join(web, "ten_vad.wasm"))],
    "/audio.i16": ["application/octet-stream", Buffer.from(x16.buffer, x16.byteOffset, x16.byteLength)],
  };
  const server = http.createServer((req, res) => {
    const f = files[req.url.split("?")[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": f[0] });
    res.end(f[1]);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profileDir = mkdtempSync(join(tmpdir(), "ten-vad-bench-"));
  let browser = null, pid = null;
  const cleanup = () => {
    if (pid) { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); pid = null; }
    try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* ignore */ }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });
  process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profileDir,
      args: ["--no-first-run", "--no-default-browser-check"] });
    pid = browser.process()?.pid ?? null;
    const version = await browser.version();
    const page = await browser.newPage();
    await page.goto(base + "/");
    const res = await page.evaluate(async (base, reps, HOP) => {
      const create = (await import(base + "/ten_vad.js")).default;
      const M = await create();
      const x = new Int16Array(await (await fetch(base + "/audio.i16")).arrayBuffer());
      const nf = Math.floor(x.length / HOP);
      const hp = M._malloc(4), buf = M._malloc(HOP * 2), pp = M._malloc(4), fp = M._malloc(4);
      const pass = () => {
        M._ten_vad_create(hp, HOP, 0.5);
        const h = M.HEAP32[hp >> 2];
        let sum = 0;
        const t0 = performance.now();
        for (let i = 0; i < nf; i++) {
          M.HEAP16.set(x.subarray(i * HOP, (i + 1) * HOP), buf >> 1);
          M._ten_vad_process(h, buf, HOP, pp, fp);
          sum += M.HEAPF32[pp >> 2];
        }
        const ms = performance.now() - t0;
        M._ten_vad_destroy(hp);
        return { ms, sum };
      };
      pass();
      const per = [];
      let chk = 0;
      for (let r = 0; r < reps; r++) { const o = pass(); per.push((o.ms / (nf * 16)) * 25); chk = o.sum; }
      return { per, nf, meanP: chk / nf };
    }, base, REPS, HOP);
    await browser.close();
    pid = null;
    return { runtime: `desktop Chrome ${version} headless, official ten_vad.{js,wasm} over http, main thread`, passes_ms_per_25ms: res.per,
      ms_per_25ms: median(res.per), frames: res.nf, mean_p: res.meanP };
  } finally {
    cleanup();
    server.close();
  }
}

const { meta, x16 } = pickAudio();
const out = { stream: `${meta.set}/${meta.id}`, audio_s: x16.length / 16000, reps: REPS, cpu: cpus()[0]?.model, threads: cpus().length,
  node: await benchNode(x16) };
console.log(JSON.stringify(out.node));
if (!A["no-chrome"]) {
  out.chrome = await benchChrome(x16);
  console.log(JSON.stringify(out.chrome));
}
const d = join(ROOT, "ten");
mkdirSync(d, { recursive: true });
writeFileSync(join(d, "bench.json"), JSON.stringify(out, null, 1));
console.log(`wrote ${join(d, "bench.json")}`);
