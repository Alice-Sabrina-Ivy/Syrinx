// warning_bound.mjs — memory and CPU of the pitch-only warning over a long
// session (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.9 (c),
// (d)): the module in src/ml/pitch-only-warning.js against the shipped one
// it replaced (tests/ml/fixtures/pitch-only-warning-shipped-2a1f4022.js), on
// the deterministic simulated session of warning_bound_sim.mjs, in three
// panel scenarios (off throughout, on from the start, switched on at 30 min).
//
//   node --expose-gc scripts/heard-as/pitch-only/warning_bound.mjs [--hours=1] [--runs=5] [--chrome] [--out=<json>]
//
// (c) Retained pitch frames: the new module's retained() after EVERY call
//     against the bound (<= 7,522 = 321 ring + 7,201 buffer; <= 321 once A40
//     is final; no ring once the first panel update came before t_fill); the
//     shipped module's buffer, which is not observable, counted from the
//     stream by its own rule (every voiced frame from t_fill until an update
//     past max(t_start, t_fill + 40 s) froze A40). The heap each warning
//     object holds after the session: heapUsed + arrayBuffers after a forced
//     GC with the object alive, minus the same after dropping it; median of 3.
// (d) CPU: the whole call loop timed (performance.now()), median of --runs
//     runs after a warm-up run; in the panel-off scenario the loop is only
//     addPitch + noteResonance. One more run times every call for the longest
//     single call. With --chrome the same in desktop Chrome: headless, a
//     temporary profile, the files served by this script's own HTTP server on
//     127.0.0.1 (cross-origin isolated, so the timer has 5 us resolution).
//
// Process hygiene (CLAUDE.md hard rule 2): Chrome is launched by puppeteer with
// a temporary --user-data-dir and closed with browser.close(), falling back to
// taskkill of ITS pid only; the HTTP server is in-process. Cleanup runs on
// exit / SIGINT / SIGTERM / uncaughtException.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { buildSession, eventsFor, drive, SCENARIOS } from "./warning_bound_sim.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const HOURS = Number(arg("hours", "1")), RUNS = Number(arg("runs", "5"));
const OUT = arg("out", null);
const MODS = { new: "src/ml/pitch-only-warning.js", shipped: "tests/ml/fixtures/pitch-only-warning-shipped-2a1f4022.js" };
const M = {};
for (const [k, p] of Object.entries(MODS)) M[k] = await import(pathToFileURL(path.join(REPO, p)).href);
const median = (xs) => { const q = [...xs].sort((a, b) => a - b), h = q.length >> 1; return q.length % 2 ? q[h] : (q[h - 1] + q[h]) / 2; };
const S = buildSession({ hours: HOURS });
const EV = Object.fromEntries(Object.entries(SCENARIOS).map(([k, sc]) => [k, eventsFor(S, sc)]));
const BOUND = 7522, RING = 321;
const E = Math.max(S.startMs, S.fillMs + 40000);
const result = { hours: HOURS, frames: S.n, voicedFrac: +S.voicedFrac.toFixed(4), fillMs: S.fillMs, startMs: S.startMs, a40FinalAfterMs: E };
console.log(`session: ${HOURS} h, ${S.n} frames, ${(100 * S.voicedFrac).toFixed(1)} % voiced; t_fill ${S.fillMs} ms, t_start ${S.startMs} ms, A40 final after ${E} ms`);

// ---- (c) retained frames
result.retained = {};
for (const [sc, ev] of Object.entries(EV)) {
  const w = M.new.createPitchOnlyWarning();
  let max = 0, maxA = 0, maxRing = 0, maxAfterA40 = 0, maxRingAfterEarlyUpdate = 0, over = 0, calls = 0;
  let firstUpdate = null, sawEarly = false;
  // the shipped module's buffer, by its rule
  const sh = { n: 0, max: 0, frozen: false };
  drive(w, S, ev, (kind, i) => {
    calls++;
    const r = w.retained(), tot = r.a40Frames + r.ringFrames, tm = S.t[i];
    max = Math.max(max, tot); maxA = Math.max(maxA, r.a40Frames); maxRing = Math.max(maxRing, r.ringFrames);
    if (tot > BOUND) over++;
    if (tm > E) { maxAfterA40 = Math.max(maxAfterA40, tot); if (tot > RING || r.a40Frames > 0) over++; }
    if (kind === "u" && firstUpdate === null) { firstUpdate = tm; sawEarly = tm < S.fillMs; }
    if (sawEarly) { maxRingAfterEarlyUpdate = Math.max(maxRingAfterEarlyUpdate, r.ringFrames); if (r.ringFrames) over++; }
    if (kind === "p" && !sh.frozen && tm >= S.fillMs && S.f0[i] > 0) sh.n++;
    if (kind === "u" && tm > E) sh.frozen = true, sh.n = 0;
    sh.max = Math.max(sh.max, sh.n);
  });
  result.retained[sc] = { calls, maxRetained: max, maxA40Frames: maxA, maxRingFrames: maxRing, maxAfterA40Final: maxAfterA40,
    ringAfterEarlyUpdate: sawEarly ? maxRingAfterEarlyUpdate : null, violations: over, end: w.retained(),
    shippedBufferMax: sh.max, shippedBufferEnd: sh.n };
  console.log(`(c) ${sc}: new retained max ${max} (A40 buffer ${maxA}, ring ${maxRing}), after A40 final ${maxAfterA40}`
    + `${sawEarly ? `, ring after the first (pre-t_fill) update ${maxRingAfterEarlyUpdate}` : ""}; violations ${over} of ${calls} calls;`
    + ` shipped buffer max ${sh.max}, at the end ${sh.n}`);
}

// ---- (c) heap held by the warning object
// The objects live only in `holder` (no local reference survives into the measurement). With one object alive the
// figure includes what its closures share with any other instance (V8 feedback / code, freed with the last one);
// with 10 alive, divided by 10, it is closer to the per-object state alone. A warm-up run precedes the measured ones.
const holder = { w: [] };
function fill(mod, ev, n) { holder.w = []; for (let i = 0; i < n; i++) { holder.w.push(mod.createPitchOnlyWarning()); drive(holder.w[i], S, ev); } }
function used() { for (let i = 0; i < 4; i++) globalThis.gc(); const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; }
function heldBytes(mod, ev, n = 1) { fill(mod, ev, n); const a = used(); holder.w = []; const b = used(); return Math.round((a - b) / n); }
if (typeof globalThis.gc === "function") {
  result.heap = {};
  for (const [sc, ev] of Object.entries(EV)) {
    result.heap[sc] = {};
    for (const k of ["new", "shipped"]) {
      heldBytes(M[k], ev);
      const xs = [0, 1, 2].map(() => heldBytes(M[k], ev));
      const ys = [0, 1, 2].map(() => heldBytes(M[k], ev, 10));
      result.heap[sc][k] = { medianBytes: median(xs), runs: xs, per10MedianBytes: median(ys), per10Runs: ys };
    }
    const f = (x) => `${(x / 1024).toFixed(1)} KB`;
    console.log(`(c) heap after ${HOURS} h, ${sc}: new ${f(result.heap[sc].new.medianBytes)} (per object with 10 alive ${f(result.heap[sc].new.per10MedianBytes)}),`
      + ` shipped ${f(result.heap[sc].shipped.medianBytes)} (${f(result.heap[sc].shipped.per10MedianBytes)})`);
  }
} else console.log("(c) heap: run with node --expose-gc");

// ---- (d) CPU in Node
function cpu(now, mods, runs) {
  const out = {};
  for (const [sc, ev] of Object.entries(EV)) {
    out[sc] = {};
    for (const [k, mod] of Object.entries(mods)) {
      drive(mod.createPitchOnlyWarning(), S, ev); // warm-up
      const xs = [];
      for (let r = 0; r < runs; r++) {
        const w = mod.createPitchOnlyWarning();
        const t0 = now();
        drive(w, S, ev);
        xs.push(now() - t0);
      }
      const timed = drive(mod.createPitchOnlyWarning(), S, ev, null, now);
      out[sc][k] = { medianMs: median(xs), runsMs: xs, perCallMs: timed.ms, maxCallMs: timed.maxMs };
    }
  }
  return out;
}
result.cpuNode = cpu(() => performance.now(), M, RUNS);
for (const [sc, r] of Object.entries(result.cpuNode)) {
  console.log(`(d) Node ${process.version}, ${sc}: new ${(r.new.medianMs / HOURS).toFixed(1)} ms per audio hour (longest call ${Math.max(...Object.values(r.new.maxCallMs)).toFixed(3)} ms), shipped ${(r.shipped.medianMs / HOURS).toFixed(1)} ms (longest ${Math.max(...Object.values(r.shipped.maxCallMs)).toFixed(3)} ms)`);
}

// ---- (d) CPU in desktop Chrome
if (process.argv.includes("--chrome")) {
  const { default: puppeteer } = await import("puppeteer-core");
  const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
  if (!CHROME) throw new Error("Chrome not found");
  const profile = mkdtempSync(path.join(tmpdir(), "warning-bound-"));
  let browser = null, server = null;
  const killBrowser = () => {
    const pid = browser?.process?.()?.pid;
    if (pid) { try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
    browser = null;
  };
  const cleanup = () => { killBrowser(); try { server?.close(); } catch { /* closed */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } };
  process.on("exit", cleanup);
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
  process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
  const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { buildSession, eventsFor, drive, SCENARIOS } from "/scripts/heard-as/pitch-only/warning_bound_sim.mjs";
const M = { new: await import("/${MODS.new}"), shipped: await import("/${MODS.shipped}") };
const median = (xs) => { const q = [...xs].sort((a, b) => a - b), h = q.length >> 1; return q.length % 2 ? q[h] : (q[h - 1] + q[h]) / 2; };
const S = buildSession({ hours: ${HOURS} });
const out = { isolated: self.crossOriginIsolated, ua: navigator.userAgent };
for (const [sc, cfg] of Object.entries(SCENARIOS)) {
  const ev = eventsFor(S, cfg);
  out[sc] = {};
  for (const [k, mod] of Object.entries(M)) {
    drive(mod.createPitchOnlyWarning(), S, ev);
    const xs = [];
    for (let r = 0; r < ${RUNS}; r++) { const w = mod.createPitchOnlyWarning(); const t0 = performance.now(); drive(w, S, ev); xs.push(performance.now() - t0); }
    const timed = drive(mod.createPitchOnlyWarning(), S, ev, null, () => performance.now());
    out[sc][k] = { medianMs: median(xs), runsMs: xs, perCallMs: timed.ms, maxCallMs: timed.maxMs };
  }
}
window.__result = out;
</script>`;
  server = createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const hdr = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
    if (u === "/" || u === "/bench.html") { res.writeHead(200, { ...hdr, "Content-Type": "text/html" }); res.end(page); return; }
    const allowed = [`/${MODS.new}`, `/${MODS.shipped}`, "/src/ml/heardAsCalibration.js", "/scripts/heard-as/pitch-only/warning_bound_sim.mjs"];
    if (!allowed.includes(u)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { ...hdr, "Content-Type": "text/javascript" });
    res.end(readFileSync(path.join(REPO, u.slice(1))));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--no-first-run"] });
  const pg = await browser.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.goto(`http://127.0.0.1:${port}/bench.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => window.__result !== undefined || false, { timeout: 30 * 60 * 1000, polling: 1000 }).catch((e) => errs.push(String(e)));
  const r = await pg.evaluate(() => window.__result ?? null);
  const version = await browser.version();
  await browser.close().catch(() => {});
  killBrowser();
  if (!r) throw new Error(`Chrome run failed: ${errs.join(" | ")}`);
  result.cpuChrome = { version, ...r };
  for (const sc of Object.keys(SCENARIOS)) {
    const x = r[sc];
    console.log(`(d) ${version} (isolated ${r.isolated}), ${sc}: new ${(x.new.medianMs / HOURS).toFixed(1)} ms per audio hour (longest call ${Math.max(...Object.values(x.new.maxCallMs)).toFixed(3)} ms), shipped ${(x.shipped.medianMs / HOURS).toFixed(1)} ms (longest ${Math.max(...Object.values(x.shipped.maxCallMs)).toFixed(3)} ms)`);
  }
  cleanup();
}

result.node = process.version;
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
