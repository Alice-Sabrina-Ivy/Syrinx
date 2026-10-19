// resonance-worker-recovery-test.js — the REAL resonance worker
// (src/resonance/resonance-worker.js, fake `self`, fetch stubbed to read
// public/) after an exception while running. 2026-10-19 pre-PR review S-2:
// one caught exception set the worker's state to "error" and every later
// chunk and pitch hint returned early, so the cue was off for the rest of
// the session. Now: "error", then after ERROR_BACKOFF_S (2 s) of audio a
// fresh engine and "ready" again, at most MAX_ERROR_RESTARTS (3) times; an
// asset-load failure stays "error".
//
// The exception is provoked inside the worker's chunk handler: the fake
// `self.postMessage` throws once on the next "state" message (posted from
// onChunk), as any exception in the engine / cue code would.
//
// Usage: node tests/resonance/resonance-worker-recovery-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const ASSETS = path.join(repo, "public", "resonance-lab");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

let sink = [];
let missing = null; // asset name to answer 404 for
let throwOnState = false;
globalThis.self = {
  postMessage: (m) => {
    if (throwOnState && m.type === "state") { throwOnState = false; throw new TypeError("boom"); }
    sink.push(m);
  },
};
globalThis.fetch = async (url) => {
  const name = String(url).split("/").pop();
  if (name === missing) return { ok: false, status: 404, json: async () => null };
  const body = readFileSync(path.join(ASSETS, name), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
await import(pathToFileURL(path.join(repo, "src/resonance/resonance-worker.js")).href);
const onMessage = self.onmessage;

const SR = 48000;
const CHUNK = 1200; // 25 ms
let port = null;
let t = 0;
async function init() {
  sink = [];
  t = 0;
  await onMessage({ data: { type: "init", sampleRate: SR, assetBase: "/" } });
  port = {};
  await onMessage({ data: { type: "audioPort", port } });
}
// A 160 Hz tone chunk + a voiced pitch hint at its time.
function chunk(n = 1) {
  for (let i = 0; i < n; i++) {
    const x = new Float32Array(CHUNK);
    for (let k = 0; k < CHUNK; k++) x[k] = 0.2 * Math.sin(2 * Math.PI * 160 * (t * CHUNK + k) / SR);
    const ct = (t * CHUNK) / SR;
    port.onmessage({ data: { buffer: x.buffer, contextTime: ct } });
    onMessage({ data: { type: "pitch-hint", voiced: true, pitch: 160, contextTime: ct } });
    t++;
  }
}
const statuses = () => sink.filter((m) => m.type === "status").map((m) => m.status);
const states = () => sink.filter((m) => m.type === "state").length;
// Arms the one-shot throw and runs chunks until it has fired.
// (A worker that has stopped posting state never fires it: give up after
// 10 s of audio and leave it armed, so the checks below fail, not hang.)
const boom = () => {
  throwOnState = true;
  for (let i = 0; i < 400 && throwOnState; i++) chunk(1);
  throwOnState = false;
};

console.log("one exception while running");
await init();
check("loads and posts ready", statuses().join() === "loading,ready", statuses().join());
chunk(40); // 1 s
check("posts state messages", states() > 0, `${states()}`);
sink = [];
boom();
check("posts error", statuses().join() === "error", statuses().join());
chunk(40); // 1 s: still backing off
check("no state while backing off", states() === 0 && statuses().join() === "error", `${states()} / ${statuses().join()}`);
chunk(41); // past 2 s of audio
check("ready again after the back-off", statuses().join() === "error,ready", statuses().join());
sink = [];
chunk(40);
check("state messages resume", states() > 0, `${states()}`);

console.log("repeated exceptions");
await init();
chunk(10);
sink = [];
for (let i = 0; i < 3; i++) { boom(); chunk(81); }
check("three recoveries", statuses().join() === "error,ready,error,ready,error,ready", statuses().join());
sink = [];
boom();
chunk(200);
check("the fourth stays error (no endless restart loop)", statuses().join() === "error" && states() === 0, `${statuses().join()} / ${states()} states`);

console.log("a new session (init) resets the count");
await init();
chunk(10);
sink = [];
boom(); chunk(81);
check("recovers again after init", statuses().join() === "error,ready", statuses().join());

console.log("asset load failure");
missing = "vtln_warp.json";
await init();
check("posts error", statuses().join() === "loading,error", statuses().join());
chunk(200);
check("stays error, no state messages", statuses().join() === "loading,error" && states() === 0, `${statuses().join()} / ${states()}`);
missing = null;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
