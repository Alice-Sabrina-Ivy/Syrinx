// timing.js — the voice-preview timing page (§P5 of
// measurements/voice-preview-spike-2026-10-12.md). Main-thread clock (performance.now)
// for the end-to-end quantities; the Worker reports per-stage times.
//
//   C0  new Worker -> "ready" (glue + .wasm fetch, compile, instantiate; lab replica for F-L),
//       with a unique query string per run and no-store responses, so no cache helps
//   G1  post "analyse" (48 kHz PCM, transferred) -> AudioBuffer of the first render ready
//   G2  post "render" -> AudioBuffer ready (warm Worker)
// ?auto=1 runs the matrix (matrix.js) and sets window.__vpResult / window.__vpDone (read
// through CDP by run-desktop.mjs; nothing is downloaded). ?mode=identity hashes the output
// PCM of the identity cases for the browser-vs-Node bit-identity check.
import { buildMatrix, cfgFromParams, FIRST, G2_SETTINGS, G2_CYCLES, WARM_G1, IDENTITY_CASES, IDENTITY_CELLS } from "./matrix.js";

const qs = new URLSearchParams(location.search);
const cfg = cfgFromParams(qs);
const WORKER_URL = new URL("../worker/vp-worker.js", import.meta.url);
const WASM_BASE = new URL("/vp-cache/wasm/", location.origin).href;
const CLIP_BASE = new URL(`/vp-cache/clips/${cfg.clipset}/`, location.origin).href;
const SR_IN = 48000;

const $ = (id) => document.getElementById(id);
const logLines = [];
function log(s) {
  logLines.push(s);
  if (logLines.length > 400) logLines.shift();
  $("log").textContent = logLines.join("\n");
}
const status = (s) => { $("status").textContent = s; };
const r2 = (v) => Math.round(v * 100) / 100;
const roundAll = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v]));

let index = null;
const clipCache = new Map();
async function fetchF32(name) {
  const r = await fetch(CLIP_BASE + name, { cache: "no-store" });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return new Float32Array(await r.arrayBuffer());
}
async function clipData(clip, length) {
  const key = `${clip}/${length}`;
  if (!clipCache.has(key)) {
    if (!index) index = await (await fetch(CLIP_BASE + "index.json", { cache: "no-store" })).json();
    const c = index.clips.find((e) => e.name === clip);
    if (!c) throw new Error(`no clip ${clip}`);
    const e = c.lengths[String(length)];
    clipCache.set(key, { pcm: await fetchF32(e.pcm), posted: e.posted ? await fetchF32(e.posted) : null });
  }
  return clipCache.get(key);
}

function toAudioBuffer(pcm, rate) {
  const b = new AudioBuffer({ length: pcm.length, numberOfChannels: 1, sampleRate: rate });
  b.copyToChannel(pcm, 0);
  return b;
}

function workerClient(nonce) {
  const w = new Worker(new URL(`${WORKER_URL.href}?v=${encodeURIComponent(nonce)}`), { type: "module" });
  let id = 0;
  const pending = new Map();
  w.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.type === "error") p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  w.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(`worker error: ${e.message}`)); pending.clear(); };
  return {
    call(msg, transfer = []) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        w.postMessage({ ...msg, id: mid }, transfer);
      });
    },
    terminate: () => w.terminate(),
  };
}

const needWorld = (engine, fe) => engine === "world" || fe === "H" || fe === "D";

async function runOne(spec) {
  const { pcm: src, posted } = await clipData(spec.clip, spec.length);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const out = { ...spec, startedAt: new Date().toISOString() };
  const tW = performance.now();
  const W = workerClient(nonce);
  try {
    const ready = await W.call({
      type: "init", engine: spec.engine, build: spec.build, needWorld: needWorld(spec.engine, spec.fe),
      needLab: spec.fe === "L", wasmBase: WASM_BASE, nonce,
    });
    out.c0 = r2(performance.now() - tW);
    out.ready = { build: ready.build, simd: ready.simd, ms: roundAll(ready.ms) };
    const analyse = async () => {
      const pcm = src.slice(); // copied before the clock starts; transferred below
      const t = performance.now();
      const r = await W.call({
        type: "analyse", pcm, srIn: SR_IN, rate: spec.rate, frontEnd: spec.fe,
        posted: spec.fe === "S" ? posted : null, framePeriod: spec.fp, first: FIRST,
      }, [pcm.buffer]);
      toAudioBuffer(r.pcm, r.rate);
      return { ms: r2(performance.now() - t), stages: roundAll(r.ms), n: r.pcm.length, memBytes: r.memBytes };
    };
    out.g1cold = await analyse();
    out.g2 = [];
    for (let c = 0; c < G2_CYCLES; c++) {
      for (const [st, a] of G2_SETTINGS) {
        const t = performance.now();
        const r = await W.call({ type: "render", st, a });
        toAudioBuffer(r.pcm, r.rate);
        out.g2.push({ st, a, ms: r2(performance.now() - t), stages: roundAll(r.ms) });
      }
    }
    out.g1warm = [];
    for (let k = 0; k < WARM_G1; k++) out.g1warm.push(await analyse());
    out.memBytes = Math.max(out.g1cold.memBytes, ...out.g1warm.map((g) => g.memBytes));
  } catch (err) {
    out.error = String((err && err.stack) || err);
  } finally {
    W.terminate();
  }
  return out;
}

async function sha256Hex(arr) {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function identity() {
  const rows = [];
  for (const build of cfg.builds) {
    for (const c of IDENTITY_CASES) {
      const { pcm: src } = await clipData(c.clip, c.length);
      const W = workerClient(`id-${build}-${Date.now()}`);
      try {
        await W.call({ type: "init", engine: c.engine, build, needWorld: needWorld(c.engine, c.fe), needLab: c.fe === "L", wasmBase: WASM_BASE });
        const [first, ...rest] = IDENTITY_CELLS;
        const pcm = src.slice();
        let r = await W.call({ type: "analyse", pcm, srIn: SR_IN, rate: c.rate, frontEnd: c.fe, framePeriod: 5, first: { st: first[0], a: first[1] } }, [pcm.buffer]);
        rows.push({ build, ...c, st: first[0], a: first[1], n: r.pcm.length, sha256: await sha256Hex(r.pcm) });
        for (const [st, a] of rest) {
          r = await W.call({ type: "render", st, a });
          rows.push({ build, ...c, st, a, n: r.pcm.length, sha256: await sha256Hex(r.pcm) });
        }
      } catch (err) {
        rows.push({ build, ...c, error: String(err) });
      } finally {
        W.terminate();
      }
      log(`identity ${build} ${c.engine} ${c.clip} ${c.rate} ${c.fe}: ${rows.slice(-3).map((x) => (x.sha256 || x.error).slice(0, 12)).join(" ")}`);
    }
  }
  return rows;
}

async function main() {
  const meta = {
    date: new Date().toISOString(), href: location.href, userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? null, cfg,
  };
  const result = { meta, runs: [], identity: null };
  window.__vpResult = result;
  window.__vpDone = false;
  try {
    if (cfg.mode === "identity") {
      status("identity check…");
      result.identity = await identity();
    } else {
      const plan = buildMatrix(cfg);
      const todo = cfg.run === null ? plan : plan.filter((s) => s.i === cfg.run);
      window.__vpProgress = { done: 0, total: todo.length };
      for (const spec of todo) {
        status(`run ${spec.i + 1} / ${plan.length}: ${spec.block} ${spec.engine} ${spec.fe} ${spec.rate} Hz ${spec.length} s ${spec.clip}`);
        const r = await runOne(spec);
        result.runs.push(r);
        window.__vpProgress = { done: result.runs.length, total: todo.length };
        log(r.error ? `#${spec.i} ERROR ${r.error.split("\n")[0]}`
          : `#${spec.i} ${spec.block} ${spec.engine}/${r.ready.build || "js"} ${spec.fe} ${spec.rate} ${spec.length}s ${spec.clip} fp${spec.fp}: ` +
            `C0 ${r.c0} ms, G1 ${r.g1cold.ms} ms, G2 med ${[...r.g2.map((g) => g.ms)].sort((a, b) => a - b)[r.g2.length >> 1]} ms`);
      }
    }
    status("done");
  } catch (err) {
    result.error = String((err && err.stack) || err);
    status("error");
    log(result.error);
  }
  window.__vpDone = true;
  document.title = "vp-done";
}

$("go").addEventListener("click", () => main());
if (qs.get("auto") === "1") main();
