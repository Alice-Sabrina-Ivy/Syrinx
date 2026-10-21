// firered-model-hosting-test.js — where the voice gate's FireRedVAD model
// files come from, and how they are checked (src/dsp/firered-vad.js
// fireredModelSource / loadFireRedFiles; user decision 2026-10-21: host them
// on a Hugging Face mirror like the Silero speech detector,
// measurements/noise-detector-tryout-2026-10-20.md "Model hosting").
//
//   - the mirror's repo name is one constant; its commit is null until the
//     mirror is uploaded, and then a full 40-hex commit;
//   - mirrorCommit null: the app's own models/firered/ (as before the
//     mirror), plain fetch, no Cache Storage;
//   - mirrorCommit set: https://huggingface.co/<mirror>/resolve/<commit>/<file>,
//     through loadVerifiedModel (Cache Storage copy first, sha256-checked);
//   - both sources: a hash mismatch, a wrong size, an HTTP error or a network
//     error -> code "unavailable" (the gate stays off, pitch is shown as
//     before, Settings says the detector could not load);
//   - the REAL pitch worker's loader on both sources (mock fetch): a bad file
//     -> vad-status "unavailable", and its pitch messages carry no decision;
//   - Settings' status line in plain words (no developer command).
//
// Self-contained: synthetic "model" bytes with their own sha256 for the
// loader, the real FIRERED_MODEL spec for the worker (its files fail the
// check on purpose, so onnxruntime-web is never loaded).
//
//   node tests/dsp/firered-model-hosting-test.js

import { createHash } from "node:crypto";

const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
const W = await import("../../src/dsp/pitch-worker.js");
const { FIRERED_MODEL, FIRERED_CACHE_PREFIX, fireredModelSource, loadFireRedFiles } = await import("../../src/dsp/firered-vad.js");
const { voiceGateStatusText } = await import("../../src/utils/voiceGateSetting.js");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const nextMacrotask = () => new Promise((r) => setImmediate(r));

// Two synthetic files with the real files' names and keys.
const ONNX = new Uint8Array(4096).map((_, i) => (i * 7 + 3) & 255);
const CMVN = new Uint8Array(64).map((_, i) => (i * 13 + 1) & 255);
const fake = (commit = null) => ({
  ...FIRERED_MODEL,
  mirrorCommit: commit,
  files: [
    { key: "onnx", name: "fireredvad_stream_vad_with_cache.onnx", bytes: ONNX.length, sha256: sha(ONNX) },
    { key: "cmvn", name: "cmvn.ark", bytes: CMVN.length, sha256: sha(CMVN) },
  ],
});

// fetch mock: url -> { status?, bytes? } | "throw"; records every request.
function mockFetch(map) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const e = map[String(url)];
    if (e === "throw") throw new TypeError("Failed to fetch");
    if (!e) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    const status = e.status ?? 200;
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => e.bytes.slice().buffer, headers: { get: () => String(e.bytes.length) } };
  };
  fn.calls = calls;
  return fn;
}

// Cache Storage mock (open / match / put / delete / keys), per cache name.
function mockCaches() {
  const stores = new Map();
  const opened = [];
  const api = {
    async open(name) {
      opened.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(key) { const b = m.get(key); return b ? { arrayBuffer: async () => b.slice(0) } : undefined; },
        async put(key, res) { m.set(key, await res.arrayBuffer()); },
        async delete(key) { return m.delete(typeof key === "string" ? key : key.url); },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
      };
    },
  };
  return { api, stores, opened };
}

async function rejects(p) {
  try { await p; return null; } catch (e) { return e; }
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log("the mirror constant");
{
  check("mirror repo name = Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx", FIRERED_MODEL.mirror === "Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx");
  check("mirrorCommit: null until the mirror is uploaded, else a full commit hash",
    FIRERED_MODEL.mirrorCommit === null || /^[0-9a-f]{40}$/.test(FIRERED_MODEL.mirrorCommit), String(FIRERED_MODEL.mirrorCommit));
  check("the pinned files keep their sha256 (the mirror must serve the official bytes)",
    FIRERED_MODEL.files.find((f) => f.key === "onnx").sha256 === "b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93" &&
    FIRERED_MODEL.files.find((f) => f.key === "cmvn").sha256 === "c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473");
}

console.log("\nsource selection");
{
  const APP = "https://example.test/Syrinx/models/firered/";
  const app = fireredModelSource({ appBaseUrl: APP, model: fake(null) });
  check("mirrorCommit null -> the app's own models/firered/", app && app.kind === "app" && app.base === APP, JSON.stringify(app));
  check("mirrorCommit null, no page location -> no source (no detector)", fireredModelSource({ appBaseUrl: null, model: fake(null) }) === null);
  const C = "0123456789abcdef0123456789abcdef01234567";
  const mir = fireredModelSource({ appBaseUrl: APP, model: fake(C) });
  check("mirrorCommit set -> the Hugging Face mirror at that commit",
    mir && mir.kind === "mirror" && mir.base === `https://huggingface.co/Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx/resolve/${C}/`, JSON.stringify(mir));
  check("mirrorCommit set, no page location -> still the mirror", fireredModelSource({ model: fake(C) })?.kind === "mirror");
  const real = fireredModelSource({ appBaseUrl: APP });
  check("as shipped now: " + (FIRERED_MODEL.mirrorCommit ? "the mirror" : "the app's own path"),
    real.kind === (FIRERED_MODEL.mirrorCommit ? "mirror" : "app"));
}

console.log("\napp source (mirrorCommit null): plain fetch, size + sha256 checked");
{
  const model = fake(null);
  const base = "https://example.test/Syrinx/models/firered/";
  const src = { kind: "app", base };
  const good = { [base + "fireredvad_stream_vad_with_cache.onnx"]: { bytes: ONNX }, [base + "cmvn.ark"]: { bytes: CMVN } };
  const caches = mockCaches();
  const f = mockFetch(good);
  const r = await loadFireRedFiles(src, { fetchFn: f, cachesApi: caches.api, model });
  check("both files load", same(r.onnx, ONNX) && same(r.cmvn, CMVN));
  check("fetched from the app's own path", f.calls.map((c) => c.url).sort().join() === Object.keys(good).sort().join(), f.calls.map((c) => c.url).join(" "));
  check("no Cache Storage on the app path (as before the mirror)", caches.opened.length === 0);
  const badBytes = ONNX.slice(); badBytes[100] ^= 1;
  let e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ ...good, [base + "fireredvad_stream_vad_with_cache.onnx"]: { bytes: badBytes } }), model }));
  check("hash mismatch -> unavailable", e?.code === "unavailable" && /sha256/.test(e.message), e?.message);
  e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ ...good, [base + "cmvn.ark"]: { bytes: CMVN.subarray(0, 40) } }), model }));
  check("wrong size (e.g. an HTML fallback page) -> unavailable", e?.code === "unavailable", e?.message);
  e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ [base + "cmvn.ark"]: { bytes: CMVN } }), model }));
  check("HTTP 404 -> unavailable", e?.code === "unavailable" && /404/.test(e.message), e?.message);
  e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ ...good, [base + "cmvn.ark"]: "throw" }), model }));
  check("network error -> unavailable", e?.code === "unavailable", e?.message);
  e = await rejects(loadFireRedFiles(null, { fetchFn: mockFetch(good), model }));
  check("no source -> unavailable", e?.code === "unavailable", e?.message);
}

console.log("\nmirror source (mirrorCommit set): pinned commit URL, sha256, Cache Storage copy");
{
  const C = "fedcba9876543210fedcba9876543210fedcba98";
  const model = fake(C);
  const src = fireredModelSource({ model });
  const base = `https://huggingface.co/Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx/resolve/${C}/`;
  const good = { [base + "fireredvad_stream_vad_with_cache.onnx"]: { bytes: ONNX }, [base + "cmvn.ark"]: { bytes: CMVN } };
  const caches = mockCaches();
  let f = mockFetch(good);
  let r = await loadFireRedFiles(src, { fetchFn: f, cachesApi: caches.api, model });
  check("first load: both files from the mirror's pinned commit URLs", same(r.onnx, ONNX) && same(r.cmvn, CMVN) &&
    f.calls.map((c) => c.url).sort().join() === Object.keys(good).sort().join(), f.calls.map((c) => c.url).join(" "));
  check("stored in Cache Storage, one cache per file", [FIRERED_CACHE_PREFIX + "onnx", FIRERED_CACHE_PREFIX + "cmvn"].every((n) => caches.stores.get(n)?.size === 1),
    [...caches.stores.keys()].join(","));
  f = mockFetch({});
  r = await loadFireRedFiles(src, { fetchFn: f, cachesApi: caches.api, model });
  check("second load: from Cache Storage, no network request", same(r.onnx, ONNX) && same(r.cmvn, CMVN) && f.calls.length === 0, `${f.calls.length} requests`);
  // A corrupted cache entry is dropped and fetched again.
  const store = caches.stores.get(FIRERED_CACHE_PREFIX + "onnx");
  const [k] = [...store.keys()];
  const broken = ONNX.slice(); broken[0] ^= 255; store.set(k, broken.buffer);
  f = mockFetch(good);
  r = await loadFireRedFiles(src, { fetchFn: f, cachesApi: caches.api, model });
  check("a corrupted cached copy is refetched from the mirror", same(r.onnx, ONNX) && f.calls.length === 1, `${f.calls.length} requests`);
  // Hash mismatch from the network: unavailable, nothing cached.
  const c2 = mockCaches();
  const badBytes = CMVN.slice(); badBytes[3] ^= 1;
  let e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ ...good, [base + "cmvn.ark"]: { bytes: badBytes } }), cachesApi: c2.api, model }));
  check("hash mismatch -> unavailable", e?.code === "unavailable" && /hash/.test(e.message), e?.message);
  check("a mismatching file is not cached", (c2.stores.get(FIRERED_CACHE_PREFIX + "cmvn")?.size ?? 0) === 0);
  e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ [base + "cmvn.ark"]: { bytes: CMVN } }), cachesApi: mockCaches().api, model }));
  check("mirror file missing (HTTP 404) -> unavailable", e?.code === "unavailable", e?.message);
  e = await rejects(loadFireRedFiles(src, { fetchFn: mockFetch({ ...good, [base + "cmvn.ark"]: "throw" }), cachesApi: mockCaches().api, model }));
  check("network error -> unavailable", e?.code === "unavailable", e?.message);
  // No Cache Storage at all (insecure context / some private windows): still loads.
  r = await loadFireRedFiles(src, { fetchFn: mockFetch(good), cachesApi: undefined, model });
  check("without Cache Storage: loads from the network", same(r.onnx, ONNX) && same(r.cmvn, CMVN));
}

console.log("\nthe REAL pitch worker's loader (mock fetch; files fail the check on purpose)");
async function workerRun(vad, fetchFn) {
  posts.length = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    W.setVadModelLoaderForTests(null); // the app's loader
    self.onmessage({ data: { type: "init", inputSampleRate: 48000, vad } });
    const port = {};
    self.onmessage({ data: { type: "audioPort", port } });
    for (let i = 0; i < 50 && !posts.some((m) => m.type === "vad-status" && m.status !== "loading"); i++) await nextMacrotask();
    let t = 0;
    for (let c = 0; c < 40; c++) {
      const buf = new Float32Array(1200);
      for (let i = 0; i < 1200; i++) { t += 1 / 48000; buf[i] = 0.2 * Math.sin(2 * Math.PI * 180 * t); }
      port.onmessage({ data: { buffer: buf.buffer, contextTime: t } });
      await nextMacrotask();
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
  return {
    statuses: posts.filter((m) => m.type === "vad-status").map((m) => m.status),
    pitch: posts.filter((m) => m.type === "pitch"),
  };
}
{
  const base = "https://example.test/Syrinx/models/firered/";
  // The real spec's names, wrong bytes: the sha256 / size check fails.
  const wrong = mockFetch({ [base + "fireredvad_stream_vad_with_cache.onnx"]: { bytes: ONNX }, [base + "cmvn.ark"]: { bytes: CMVN } });
  let r = await workerRun({ modelBase: base, source: "app" }, wrong);
  check("app source, wrong files -> vad-status loading, then unavailable", r.statuses.join() === "loading,unavailable", r.statuses.join());
  check("app source: requested from the app's own path", wrong.calls.length > 0 && wrong.calls.every((c) => c.url.startsWith(base)));
  check("unavailable: pitch messages carry no decision (not gated)", r.pitch.length > 20 && r.pitch.every((m) => !("vad" in m)), `${r.pitch.length} messages`);
  const C = "0123456789abcdef0123456789abcdef01234567";
  const mbase = `https://huggingface.co/${FIRERED_MODEL.mirror}/resolve/${C}/`;
  const wrongM = mockFetch({ [mbase + "fireredvad_stream_vad_with_cache.onnx"]: { bytes: ONNX }, [mbase + "cmvn.ark"]: { bytes: CMVN } });
  r = await workerRun({ modelBase: mbase, source: "mirror" }, wrongM);
  check("mirror source, hash mismatch -> vad-status loading, then unavailable", r.statuses.join() === "loading,unavailable", r.statuses.join());
  check("mirror source: requested from the mirror's pinned commit", wrongM.calls.length > 0 && wrongM.calls.every((c) => c.url.startsWith(mbase)));
  check("mirror unavailable: no decision on any pitch message", r.pitch.length > 20 && r.pitch.every((m) => !("vad" in m)));
  r = await workerRun({ modelBase: base, source: "app" }, mockFetch({}));
  check("app source, files not there (404) -> unavailable", r.statuses.join() === "loading,unavailable", r.statuses.join());
}

console.log("\nSettings' status line (plain words)");
{
  const all = ["idle", "loading", "ready", "unavailable", "error", "slow"].flatMap((s) => [null, "ok", "unavailable", "mirror"].map((p) => voiceGateStatusText(s, p)));
  check("no developer command in any status line", all.every((t) => !/node |scripts\/|npm |fetch-firered/.test(t)), all.find((t) => /node |scripts\//.test(t)));
  check("unavailable: says the detector could not load and pitch is shown as before",
    /could not load/.test(voiceGateStatusText("unavailable")) && /pitch is shown as before/.test(voiceGateStatusText("unavailable")));
  check("before listening, app files missing: the same plain sentence", voiceGateStatusText("idle", "unavailable") === voiceGateStatusText("unavailable"));
  check("error / slow: pitch is shown as before", /shown as before/.test(voiceGateStatusText("error")) && /shown as before/.test(voiceGateStatusText("slow")));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
