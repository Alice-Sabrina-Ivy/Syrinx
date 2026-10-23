// worker-test.js — the REAL src/voice-preview/vp-worker.js in Node under a fake `self`,
// with simulated capture chunks (a fake port) and forwarded posted pitch messages, as the
// controller sends them. record -> analysed -> render gives the same bytes as
// parity-test.js (the spike's renders) for the same input; too-short, cancel, the 8 s cap,
// no-voice, the track timeout, the hum flag, load errors with the SIMD -> non-SIMD retry,
// render before analysis and a forced memory error give the right replies; noise reduction
// (RNNoise) for a recording, switched on / off with a preview, and a module that cannot load.
// measurements/voice-preview-phase1-2026-10-19.md §3, §4, §14 item 6.
//
//   node tests/voice-preview/worker-test.js
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PARITY_JSON, GLUE_URL, WASM_URLS, RNNOISE_URL, REPO, cellKey, makeInput, chunkFor, sha256, makeChecker, installFileFetch } from "./vp-test-lib.js";
import { createRnnoise, denoiseClip } from "../../src/voice-preview/denoise.js";

const T = makeChecker();
installFileFetch();
const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const WORKER = pathToFileURL(path.join(REPO, "src/voice-preview/vp-worker.js")).href;
const OOM_GLUE = pathToFileURL(path.join(REPO, "tests/voice-preview/fixtures/oom-glue.mjs")).href;
const BASE_CT = 123.456; // the capture clock when the recording starts (listening for a while)

let inst = 0;
/** A fresh worker module instance with its own fake `self`. */
async function freshWorker() {
  const posted = [];
  const fake = { postMessage(m, transfer) { posted.push({ m, transfer: transfer ?? [] }); } };
  globalThis.self = fake;
  await import(`${WORKER}?i=${++inst}`);
  const handler = fake.onmessage;
  return {
    posted,
    send: (data) => handler({ data }),
    types: () => posted.map((p) => p.m.type),
    last: (type) => [...posted].reverse().find((p) => p.m.type === type),
    async waitFor(type, timeoutMs = 30000) {
      const t0 = Date.now();
      for (;;) {
        const hit = posted.find((p) => p.m.type === type);
        if (hit) return hit;
        const err = posted.find((p) => p.m.type === "error");
        if (err && type !== "error") throw new Error(`worker error: ${err.m.stage} ${err.m.kind} ${err.m.message}`);
        if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${type} (got ${posted.map((p) => p.m.type)})`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

async function ready(w, glueUrl = GLUE_URL, wasmUrls = WASM_URLS, rnnoiseUrl = RNNOISE_URL) {
  w.send({ type: "init", glueUrl, wasmUrls, rnnoiseUrl });
  return w.waitFor("ready").catch(() => null);
}

const fakePort = () => ({ onmessage: null, closed: false, close() { this.closed = true; }, start() {} });
const ctOf = (k, C, rate) => BASE_CT + (k + 1) * C / rate;

/**
 * Feed `nChunks` chunks of pcm (cycled) to a recording and forward the posted track with
 * the decode lag (value for chunk k after chunk k + lag). Returns the port and the chunk count fed.
 */
function feed(w, pcm, rate, track, { nChunks, lag = 2, pitchOf = (k) => (track[k % track.length] > 0 ? track[k % track.length] : null), notchedAt = new Set(), ctJitter = () => 0, denoise }) {
  const C = chunkFor(rate);
  const port = fakePort();
  w.send({ type: "record", port, sampleRate: rate, maxS: 8, minS: 3, ...(denoise === undefined ? {} : { denoise }) });
  // a pre-recording posted message (chunk -1, notched): ignored
  w.send({ type: "pitch", contextTime: ctOf(-1, C, rate), pitch: 200, notched: true });
  const nAvail = pcm.length / C;
  for (let k = 0; k < nChunks; k++) {
    const kk = k % nAvail;
    const buf = Float32Array.from(pcm.subarray(kk * C, (kk + 1) * C)).buffer;
    if (port.onmessage) port.onmessage({ data: { buffer: buf, contextTime: ctOf(k, C, rate) } });
    const j = k - lag;
    if (j >= 0) w.send({ type: "pitch", contextTime: ctOf(j, C, rate) + ctJitter(j), pitch: pitchOf(j), notched: notchedAt.has(j) });
  }
  return { port, C };
}
const flushPitch = (w, rate, track, from, to, opts = {}) => {
  const C = chunkFor(rate);
  const pitchOf = opts.pitchOf ?? ((k) => (track[k] > 0 ? track[k] : null));
  for (let j = from; j < to; j++) w.send({ type: "pitch", contextTime: ctOf(j, C, rate), pitch: pitchOf(j), notched: false });
};

// ---------------------------------------------------------------------------
console.log("load: SIMD build in Node; a broken SIMD file falls back to non-SIMD; nothing loadable -> error");
{
  const w = await freshWorker();
  const r = await ready(w);
  T.check("ready with the SIMD build", r && r.m.build === "simd" && r.m.memBytes > 0, r ? `${r.m.build}, ${r.m.ms.toFixed(0)} ms` : String(w.types()));
}
{
  const w = await freshWorker();
  const r = await ready(w, GLUE_URL, { simd: pathToFileURL(path.join(REPO, "tests/voice-preview/no-such.wasm")).href, nosimd: WASM_URLS.nosimd });
  T.check("SIMD build fails to load -> retried with the non-SIMD build", r && r.m.build === "nosimd", r ? r.m.build : String(w.types()));
}
{
  const w = await freshWorker();
  const bad = pathToFileURL(path.join(REPO, "tests/voice-preview/no-such.wasm")).href;
  w.send({ type: "init", glueUrl: GLUE_URL, wasmUrls: { simd: bad, nosimd: bad } });
  const e = await w.waitFor("error");
  T.check("no build loads -> error { stage: load, kind: other }", e.m.stage === "load" && e.m.kind === "other" && !w.types().includes("ready"), `${e.m.stage}/${e.m.kind}`);
}

// ---------------------------------------------------------------------------
console.log("\nrecord -> analysed -> render: the spike's bytes (ls_woman_high, 16 kHz)");
{
  const f = fx.inputs.find((i) => i.name === "ls_woman_high@16000");
  const { pcm, rate } = makeInput({ clip: "ls_woman_high", rate: 16000 });
  const track = Float32Array.from(f.track);
  const n = pcm.length / chunkFor(rate);
  const w = await freshWorker();
  await ready(w);
  w.send({ type: "render", id: 0, st: 2, pct: 3 });
  const early = w.last("error");
  T.check("render before any analysis -> error { stage: render }", early && early.m.stage === "render" && early.m.id === 0);
  w.posted.length = 0;
  // posted values: exact contextTime, except every 7th hop 4 ms off (nearest within half a chunk)
  const { port } = feed(w, pcm, rate, track, { nChunks: n, notchedAt: new Set([50]), ctJitter: (j) => (j % 7 === 3 ? 0.004 : 0) });
  const levels = w.posted.filter((p) => p.m.type === "level");
  T.check("level every 4th chunk (100 ms)", levels.length === Math.floor(n / 4) && Math.abs(levels.at(-1).m.seconds - 4 * Math.floor(n / 4) * 0.025) < 1e-9, `${levels.length} level messages`);
  w.send({ type: "stop" });
  const rec = w.last("recorded");
  T.check("stop -> recorded { reason: user, seconds }", rec && rec.m.reason === "user" && rec.m.seconds === n * chunkFor(rate) / rate, rec ? `${rec.m.seconds} s` : "");
  T.check("the capture port is closed when the recording ends", port.closed && port.onmessage === null);
  T.check("no analysis before the last chunk's posted value", !w.types().includes("analysed"));
  flushPitch(w, rate, track, n - 2, n);
  // a duplicate and a late message after completion: ignored
  flushPitch(w, rate, track, n - 1, n, { pitchOf: () => 999 });
  const a = await w.waitFor("analysed");
  const m = a.m;
  T.check("analysed: engine and capture rate, seconds", m.rate === 16000 && m.captureRate === 16000 && m.seconds === 5);
  T.check("analysed: every hop's posted value matched", m.hops.recorded === n && m.hops.received === n, JSON.stringify(m.hops));
  T.check("rebuild = the spike's (0 st, 0 %) render, bit for bit", sha256(m.rebuild) === f.expected.simd[cellKey(0, 0)]);
  T.check("original = the recording, unchanged", sha256(m.original) === f.pcmSha256 && m.original.length === pcm.length);
  T.check("original and rebuild are transferred", a.transfer.includes(m.original.buffer) && a.transfer.includes(m.rebuild.buffer));
  T.check("check: hum flagged from the forwarded notch flag (recorded chunks only)", m.check.hum === true);
  T.check("check: level margin of a clean clip, no noise flag", m.check.noise === false && m.check.marginDb > 30, `${m.check.marginDb.toFixed(1)} dB`);
  T.check("check: voiced seconds", m.check.voicedS === f.voicedHops * 25 / 1000, `${m.check.voicedS} s`);
  T.check("pitch: median / p5 and limits", m.pitch.medianHz > 150 && m.pitch.p5Hz >= 75 && m.limits.stMax === 12 && m.limits.stMin <= 0
    && m.limits.pctMin === -21 && m.limits.pctMax === 26, `median ${m.pitch.medianHz.toFixed(1)}, p5 ${m.pitch.p5Hz.toFixed(1)}, min ${m.limits.stMin}`);
  T.check("analysed: per-stage ms and memory", m.ms.d4c > 0 && m.ms.total > 0 && m.memBytes > 16e6);
  const bad = [];
  for (const [st, pct] of [[2, 3], [-12, -21], [0, 6], [2, 3]]) {
    w.posted.length = 0;
    w.send({ type: "render", id: `${st}/${pct}`, st, pct });
    const r = w.last("rendered");
    if (!r || r.m.id !== `${st}/${pct}` || r.m.rate !== 16000 || !r.transfer.includes(r.m.pcm.buffer)) bad.push(`${st}/${pct} reply`);
    else if (sha256(r.m.pcm) !== f.expected.simd[cellKey(st, pct)]) bad.push(`${st}/${pct} bytes`);
  }
  T.check("render { id, st, pct } -> rendered: the spike's bytes, transferred", bad.length === 0, bad.join(", "));
  w.posted.length = 0;
  w.send({ type: "record", port: fakePort(), sampleRate: 16000 });
  T.check("a second recording in the same worker is refused (the app starts a fresh worker)", w.last("error")?.m.stage === "record");
}

console.log("\nrecord at 44.1 kHz (1102-sample chunks): the spike's rebuild");
{
  const f = fx.inputs.find((i) => i.name === "ls_man_low@44100");
  const { pcm, rate } = makeInput({ clip: "ls_man_low", rate: 44100 });
  const track = Float32Array.from(f.track);
  const n = pcm.length / chunkFor(rate);
  const w = await freshWorker();
  await ready(w);
  feed(w, pcm, rate, track, { nChunks: n });
  w.send({ type: "stop" });
  flushPitch(w, rate, track, n - 2, n);
  const a = await w.waitFor("analysed");
  T.check("rebuild bit-identical to the spike at 44.1 kHz", sha256(a.m.rebuild) === f.expected.simd[cellKey(0, 0)] && a.m.rate === 44100, `${a.m.seconds.toFixed(4)} s`);
}

// ---------------------------------------------------------------------------
console.log("\nshort, cancelled, capped, voiceless, timed-out recordings");
const clip16 = makeInput({ clip: "ls_man_low", rate: 16000 });
const track16 = Float32Array.from(fx.inputs.find((i) => i.name === "ls_man_low@16000").track);
{
  const w = await freshWorker();
  await ready(w);
  feed(w, clip16.pcm, 16000, track16, { nChunks: 119 }); // 2.975 s
  w.send({ type: "stop" });
  const s = w.last("too-short");
  T.check("2.975 s -> too-short (no analysis)", s && Math.abs(s.m.seconds - 2.975) < 1e-9 && !w.types().includes("recorded"));
  w.posted.length = 0;
  feed(w, clip16.pcm, 16000, track16, { nChunks: 120 }); // 3.000 s: long enough
  w.send({ type: "stop" });
  T.check("the same worker records again after too-short; 3.000 s is accepted", w.last("recorded")?.m.seconds === 3);
  w.send({ type: "cancel" });
  T.check("cancel while waiting for the track -> cancelled", w.last("cancelled") !== undefined);
  await new Promise((r) => setTimeout(r, 650));
  T.check("nothing is analysed after a cancel", !w.types().includes("analysed"));
}
{
  const w = await freshWorker();
  await ready(w);
  const { port } = feed(w, clip16.pcm, 16000, track16, { nChunks: 40 });
  w.send({ type: "cancel" });
  T.check("cancel while recording -> cancelled, port closed", w.last("cancelled") !== undefined && port.closed);
}
{
  const w = await freshWorker();
  await ready(w);
  const { port } = feed(w, clip16.pcm, 16000, track16, { nChunks: 360 }); // 9 s offered
  const recs = w.posted.filter((p) => p.m.type === "recorded");
  T.check("the 8 s cap: one recorded { reason: max } at 8.000 s, later chunks dropped", recs.length === 1 && recs[0].m.reason === "max" && recs[0].m.seconds === 8 && port.closed,
    recs.map((r) => `${r.m.reason} ${r.m.seconds}`).join());
  flushPitch(w, 16000, track16, 318, 320, { pitchOf: (k) => (track16[k % track16.length] > 0 ? track16[k % track16.length] : null) });
  const a = await w.waitFor("analysed");
  T.check("8 s recording analysed (320 hops)", a.m.seconds === 8 && a.m.hops.recorded === 320 && a.m.rebuild.length === 128000);
}
{
  const w = await freshWorker();
  await ready(w);
  feed(w, clip16.pcm, 16000, track16, { nChunks: 160, pitchOf: (k) => (k % 5 === 0 ? 180 : null) }); // voiced hops k = 0, 5, ..., 155
  w.send({ type: "stop" });
  flushPitch(w, 16000, track16, 158, 160, { pitchOf: () => null });
  const nv = await w.waitFor("no-voice");
  T.check("32 voiced hops (< 40) -> no-voice", nv.m.voicedS === 0.8 && !w.types().includes("analysed"), `${nv.m.voicedS} s`);
}
{
  const w = await freshWorker();
  await ready(w);
  const C = chunkFor(16000);
  const p = fakePort();
  w.send({ type: "record", port: p, sampleRate: 16000, maxS: 8, minS: 3, trackTimeoutMs: 150 });
  for (let k = 0; k < 160; k++) {
    p.onmessage({ data: { buffer: Float32Array.from(clip16.pcm.subarray(k * C, (k + 1) * C)).buffer, contextTime: ctOf(k, C, 16000) } });
    // the posted values stop 10 hops before the end (never arrive)
    if (k >= 2 && k - 2 < 150) w.send({ type: "pitch", contextTime: ctOf(k - 2, C, 16000), pitch: track16[k - 2] > 0 ? track16[k - 2] : null, notched: false });
  }
  w.send({ type: "stop" });
  const t0 = Date.now();
  const a = await w.waitFor("analysed");
  T.check("missing posted values: analysed after the track timeout, missing hops = 0", a.m.hops.received === 150 && a.m.hops.recorded === 160 && Date.now() - t0 >= 100,
    `${a.m.hops.received}/${a.m.hops.recorded} after ${Date.now() - t0} ms`);
}

// ---------------------------------------------------------------------------
console.log("\nnoise reduction (RNNoise; ls_man_hi8_f105 at 48 kHz with white noise at 10 dB SNR)");
{
  const f = fx.inputs.find((i) => i.name === "ls_man_hi8_f105@48000");
  const { pcm: clean, rate } = makeInput({ clip: "ls_man_hi8_f105", rate: 48000 });
  let s = 3;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const noise = Float32Array.from({ length: clean.length }, rnd);
  const g = rms(clean) / rms(noise) / Math.sqrt(10);
  const pcm = clean.map((v, i) => v + g * noise[i]);
  const track = Float32Array.from(f.track);
  const n = pcm.length / chunkFor(rate);
  const run = async (w, denoise) => {
    feed(w, pcm, rate, track, { nChunks: n, denoise });
    w.send({ type: "stop" });
    flushPitch(w, rate, track, n - 2, n);
    return (await w.waitFor("analysed")).m;
  };
  const wOff = await freshWorker();
  await ready(wOff);
  const off = await run(wOff);
  T.check("noise reduction off (the default): denoised false, no RNNoise time", off.denoised === false && off.ms.denoise === undefined && off.take === 1);
  // (the worker module replies through the global `self`: one worker in use at a time)
  wOff.send({ type: "render", id: 7, st: 2, pct: 3 });
  const offRender = sha256(wOff.last("rendered").m.pcm);

  const wOn = await freshWorker();
  await ready(wOn);
  const on = await run(wOn, true);
  const expected = denoiseClip(createRnnoise(readFileSync(new URL(RNNOISE_URL))), pcm, rate);
  const eng = new (await import("../../src/voice-preview/engine/preview.js")).PreviewEngine(await (await import("./vp-test-lib.js")).loadWorld("simd"));
  T.check("record { denoise: true } -> analysed { denoised: true } with RNNoise time", on.denoised === true && on.ms.denoise > 0, `${on.ms.denoise?.toFixed(0)} ms`);
  T.check("…its rebuild = the engine's rebuild of denoiseClip(recording), bit for bit", sha256(on.rebuild) === sha256(eng.analyse(expected, rate, track).rebuild));
  T.check("…original, the recording check and the pitch stay the recording's as captured",
    sha256(on.original) === sha256(off.original) && sha256(on.original) === sha256(pcm)
    && JSON.stringify(on.check) === JSON.stringify(off.check) && on.pitch.medianHz === off.pitch.medianHz && on.limits.stMin === off.limits.stMin);
  T.check("…the noise flag came from the noisy recording", on.check.noise === true, `margin ${on.check.marginDb.toFixed(1)} dB`);

  // the same take switched off and on again with the preview on screen
  wOn.posted.length = 0;
  wOn.send({ type: "denoise", on: false });
  const a2 = await wOn.waitFor("analysed");
  T.check("denoise { on: false } with a preview -> analysed again: same take, denoised false, no original",
    a2.m.take === 1 && a2.m.denoised === false && a2.m.original === undefined && !a2.transfer.some((b) => b === undefined));
  T.check("…its rebuild = the rebuild without noise reduction, bit for bit", sha256(a2.m.rebuild) === sha256(off.rebuild));
  wOn.posted.length = 0;
  wOn.send({ type: "render", id: 7, st: 2, pct: 3 });
  T.check("…renders after the re-analysis = the same renders without noise reduction", sha256(wOn.last("rendered")?.m.pcm ?? new Float32Array(1)) === offRender);
  wOn.posted.length = 0;
  wOn.send({ type: "denoise", on: true });
  wOn.send({ type: "denoise", on: false }); // changed back while it runs: applied right after
  const seen = [];
  for (let t0 = Date.now(); seen.length < 2 && Date.now() - t0 < 30000;) {
    seen.splice(0, seen.length, ...wOn.posted.filter((p) => p.m.type === "analysed"));
    await new Promise((r) => setTimeout(r, 5));
  }
  T.check("on then off before the first finishes -> two analyses, the last without noise reduction",
    seen.length === 2 && seen[0].m.denoised === true && seen[1].m.denoised === false && sha256(seen[1].m.rebuild) === sha256(off.rebuild),
    seen.map((p) => p.m.denoised).join(","));
  wOn.send({ type: "denoise", on: false });
  await new Promise((r) => setTimeout(r, 50));
  T.check("a setting equal to the current one does nothing", wOn.posted.filter((p) => p.m.type === "analysed").length === 2);
}
{
  const { pcm, rate } = makeInput({ clip: "ls_man_low", rate: 16000 });
  const track = Float32Array.from(fx.inputs.find((i) => i.name === "ls_man_low@16000").track);
  const n = pcm.length / chunkFor(rate);
  const w = await freshWorker();
  await ready(w, GLUE_URL, WASM_URLS, pathToFileURL(path.join(REPO, "tests/voice-preview/no-such.wasm")).href);
  feed(w, pcm, rate, track, { nChunks: n, denoise: true });
  w.send({ type: "stop" });
  flushPitch(w, rate, track, n - 2, n);
  const a = await w.waitFor("analysed");
  const f = fx.inputs.find((i) => i.name === "ls_man_low@16000");
  T.check("RNNoise cannot load -> denoise-error, then analysed without it (the spike's rebuild)",
    w.types().indexOf("denoise-error") >= 0 && w.types().indexOf("denoise-error") < w.types().indexOf("analysed")
    && a.m.denoised === false && sha256(a.m.rebuild) === f.expected.simd[cellKey(0, 0)], w.types().filter((t) => t !== "level").join(","));
  w.posted.length = 0;
  w.send({ type: "denoise", on: true });
  await new Promise((r) => setTimeout(r, 50));
  T.check("…switching it on again answers denoise-error and re-analyses nothing", w.types().join() === "denoise-error", w.types().join());
}

// ---------------------------------------------------------------------------
console.log("\nmemory");
{
  const w = await freshWorker();
  const r = await ready(w, OOM_GLUE, { simd: WASM_URLS.simd, nosimd: WASM_URLS.nosimd });
  T.check("test glue loads", !!r);
  globalThis.__vpFailMallocOver = 2_000_000; // the envelope (1001 frames x 513 bins x 8 B) does not fit
  feed(w, clip16.pcm, 16000, track16, { nChunks: 200 });
  w.send({ type: "stop" });
  flushPitch(w, 16000, track16, 198, 200);
  const e = await w.waitFor("error");
  globalThis.__vpFailMallocOver = 0;
  T.check("a failed WebAssembly allocation -> error { stage: analyse, kind: memory }", e.m.stage === "analyse" && e.m.kind === "memory", `${e.m.stage}/${e.m.kind}`);
  w.posted.length = 0;
  w.send({ type: "render", id: 1, st: 2, pct: 3 });
  T.check("no render after a failed analysis", w.last("error")?.m.stage === "render" && !w.types().includes("rendered"));
}

T.done();
