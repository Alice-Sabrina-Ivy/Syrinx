// pitch-worker-vad-test.js — drives the REAL pitch worker (src/dsp/pitch-worker.js)
// in Node with a fake `self` and a FAKE voice-detector model (try-out branch
// noise-detector-tryout; measurements/noise-detector-tryout-2026-10-20.md).
// The worker's test seam setVadModelLoaderForTests replaces only how the
// model is obtained (fetch + onnxruntime-web session); the in-order chain,
// the lag safeguard, the detector and the gate are the app's code.
//
// Checks
//   - a fast model: never "slow"; decisions on every hop once caught up; the
//     posted pitch is exactly the pitch without the detector;
//   - a model slower than real time (40 ms per hop): the detector switches
//     itself off ("slow") within ~1 s of audio, and every later message
//     carries no decision (the display is not gated) — no message is lost;
//   - a model that is slow but within budget (10 ms per hop): never "slow";
//   - a burst (3 s of chunks delivered at once, as after a main-thread stall):
//     never "slow", every message posted in order;
//   - the model arriving after 20 s: the waiting audio is scored at most 50
//     frames per hop (diag vadMs per hop stays under one hop's 25 ms), never
//     "slow", decisions again within 10 hops;
//   - no `vad` in init (the Node harnesses): no detector, no vad fields.
//
//   node tests/dsp/pitch-worker-vad-test.js

const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
const W = await import("../../src/dsp/pitch-worker.js");
const { CATCHUP_FRAMES } = await import("../../src/dsp/firered-vad.js");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const SR = 48000, CHUNK = 1200; // 25 ms chunks at 48 kHz, as the capture sends them
const nextMacrotask = () => new Promise((r) => setImmediate(r));
const busyWait = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* a slow device */ } };

// A voiced-ish signal: 6 harmonics of a slowly gliding 150-250 Hz F0.
function makeChunks(seconds) {
  const out = [];
  let phase = 0, t = 0;
  for (let c = 0; c < Math.round(seconds / 0.025); c++) {
    const buf = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) {
      const f0 = 200 + 50 * Math.sin(2 * Math.PI * 0.3 * t);
      phase += (2 * Math.PI * f0) / SR; t += 1 / SR;
      let s = 0; for (let k = 1; k <= 6; k++) s += Math.sin(k * phase) / k;
      buf[i] = 0.2 * s;
    }
    out.push({ buf, contextTime: t });
  }
  return out;
}

// Fake model: one probability per frame from its features (no state), an
// optional cost per call / per frame, and a record of call sizes.
function fakeModel({ msPerCall = 0, msPerFrame = 0 } = {}) {
  const calls = [];
  return {
    calls,
    model: {
      cmvn: { mean: new Float64Array(80), istd: new Float64Array(80).fill(1) },
      runner: {
        async run(frames) {
          calls.push(frames.length);
          busyWait(msPerCall + msPerFrame * frames.length);
          return Float32Array.from(frames, (f) => 1 / (1 + Math.exp(-(f[10] - 8) / 2)));
        },
        reset() {},
      },
    },
  };
}

// One worker session. readyAt: the chunk index at which the model loader
// resolves (null: no vad in init). burst: [from, to) chunk indices delivered
// without yielding (a main-thread stall); otherwise every chunk is its own
// macrotask, as port messages are in the browser.
async function session(chunks, { model = null, readyAt = 0, burst = null, diag = false } = {}) {
  posts.length = 0;
  let resolveModel = null;
  W.setVadModelLoaderForTests(model ? () => new Promise((r) => { resolveModel = r; }) : null);
  self.onmessage({ data: { type: "init", inputSampleRate: SR, ...(diag ? { diag: true } : {}), ...(model ? { vad: { modelBase: "test:" } } : {}) } });
  const port = {};
  self.onmessage({ data: { type: "audioPort", port } });
  const pitchIndexAtReady = { n: null };
  for (let c = 0; c < chunks.length; c++) {
    if (model && c === readyAt) {
      resolveModel(model);
      await nextMacrotask();
      pitchIndexAtReady.n = posts.filter((m) => m.type === "pitch").length;
    }
    const { buf, contextTime } = chunks[c];
    // a copy: the worker reads msg.buffer as its own (transferred in the browser)
    port.onmessage({ data: { buffer: buf.slice().buffer, contextTime } });
    const inBurst = burst && c >= burst[0] && c < burst[1] - 1;
    if (!inBurst) await nextMacrotask();
  }
  for (let i = 0; i < 20; i++) await nextMacrotask();
  W.setVadModelLoaderForTests(null);
  const pitch = posts.filter((m) => m.type === "pitch");
  const statuses = posts.filter((m) => m.type === "vad-status").map((m) => m.status);
  // pitch messages posted before the "slow" status
  let slowAfter = null, nPitch = 0;
  for (const m of posts) {
    if (m.type === "pitch") nPitch++;
    if (m.type === "vad-status" && m.status === "slow") { slowAfter = nPitch; break; }
  }
  return { pitch, statuses, slowAfter, readyPitch: pitchIndexAtReady.n, posts: posts.slice() };
}

const inOrder = (pitch) => pitch.every((m, i) => i === 0 || m.contextTime > pitch[i - 1].contextTime);
const samePitch = (a, b) => a.length === b.length && a.every((m, i) => m.pitch === b[i].pitch && m.confidence === b[i].confidence && m.contextTime === b[i].contextTime);

console.log("pitch worker with the try-out voice detector (fake model)");
const chunks4 = makeChunks(4);
const plain = await session(chunks4);
{
  check("no vad in init: no detector status, no vad fields", plain.statuses.length === 0 && plain.pitch.every((m) => !("vad" in m) && !("vadMs" in m)));
  check("no vad in init: a pitch message per chunk after the warm-up", plain.pitch.length >= chunks4.length - 8, `${plain.pitch.length} of ${chunks4.length}`);
}
{
  const fast = fakeModel();
  const r = await session(chunks4, { model: fast.model, readyAt: 0 });
  const decided = r.pitch.filter((m) => m.vad && typeof m.vad.voice === "boolean");
  check("fast model: ready, never slow", r.statuses.includes("ready") && !r.statuses.includes("slow"), r.statuses.join(","));
  check("fast model: a decision on every message", decided.length === r.pitch.length, `${decided.length} of ${r.pitch.length}`);
  check("fast model: the posted pitch is exactly the pitch without the detector", samePitch(r.pitch, plain.pitch));
  check("fast model: in order", inOrder(r.pitch));
}
{
  const slow = fakeModel({ msPerCall: 40 });
  const r = await session(chunks4, { model: slow.model, readyAt: 0 });
  const afterSlow = r.slowAfter === null ? [] : r.pitch.slice(r.slowAfter);
  check("model slower than real time (40 ms per 25 ms hop): switched off as slow", r.statuses.includes("slow"), r.statuses.join(","));
  check("... within about 1 s of audio (lag grows ~15 ms per hop; 0.5 s limit)", r.slowAfter !== null && r.slowAfter <= 50, `after ${r.slowAfter} pitch messages`);
  check("... every later message carries no decision (the display is not gated)", afterSlow.length > 50 && afterSlow.every((m) => !("vad" in m)), `${afterSlow.length} later messages`);
  check("... no message lost, in order, pitch unchanged", samePitch(r.pitch, plain.pitch) && inOrder(r.pitch));
  const msg = r.posts.find((m) => m.type === "vad-status" && m.status === "slow")?.message ?? "";
  check("... the status says how far behind", /ms behind real time/.test(msg), msg);
}
{
  const ok = fakeModel({ msPerCall: 10 });
  const r = await session(chunks4, { model: ok.model, readyAt: 0 });
  check("a slower model within budget (10 ms per hop): never slow", !r.statuses.includes("slow") && r.pitch.every((m) => m.vad), r.statuses.join(","));
}
{
  const fast = fakeModel();
  const chunks = makeChunks(6);
  const ref = await session(chunks);
  const r = await session(chunks, { model: fast.model, readyAt: 0, burst: [40, 160] });
  check("a 3 s burst of chunks (as after a main-thread stall): never slow", !r.statuses.includes("slow"), r.statuses.join(","));
  check("... every message posted, in order, pitch unchanged, decisions throughout", samePitch(r.pitch, ref.pitch) && inOrder(r.pitch) && r.pitch.every((m) => m.vad));
}
{
  // The model arrives after 20 s of audio; scoring costs 0.15 ms per frame
  // plus 0.5 ms per call (about 1.5x this PC's ORT-web cost). Without a cap and
  // a per-hop budget, the first ready hop would score all 2,000 waiting frames
  // at once (~300 ms of stalled pitch posts).
  const late = fakeModel({ msPerCall: 0.5, msPerFrame: 0.15 });
  const chunks = makeChunks(24);
  const r = await session(chunks, { model: late.model, readyAt: 800, diag: true });
  const after = r.pitch.slice(r.readyPitch);
  const firstDecided = after.findIndex((m) => m.vad);
  const catchUp = after.slice(0, firstDecided + 1);
  const maxMs = Math.max(...catchUp.map((m) => m.vadMs ?? 0));
  check("model after 20 s: no decision before it", r.pitch.slice(0, r.readyPitch).every((m) => !("vad" in m)));
  check(`model after 20 s: the waiting audio scored at most ${CATCHUP_FRAMES} frames per call`, Math.max(...late.calls) <= CATCHUP_FRAMES, `largest call ${Math.max(...late.calls)} frames`);
  check("model after 20 s: decisions again within 10 hops, then on every message", firstDecided >= 0 && firstDecided <= 10 && after.slice(firstDecided).every((m) => m.vad),
    `first decision ${firstDecided + 1} hops after ready`);
  check("model after 20 s: detector time per hop while catching up < 25 ms (no stalled pitch post)", catchUp.every((m) => typeof m.vadMs === "number") && maxMs < 25,
    `max ${maxMs.toFixed(1)} ms`);
  check("model after 20 s: never slow", !r.statuses.includes("slow"), r.statuses.join(","));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
