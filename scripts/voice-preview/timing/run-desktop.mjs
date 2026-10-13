// run-desktop.mjs — drives the voice-preview timing page in a pinned desktop browser
// (§P5 / §P8 of measurements/voice-preview-spike-2026-10-12.md) and saves its result.
//
//   node scripts/voice-preview/timing/run-desktop.mjs [--browser=chrome|firefox] [--headful]
//        [--params="runs=1&blocks=world-auto&lengths=5"] [--mode=identity] [--per-run-context]
//        [--plans=FILE] [--out=FILE] [--timeout-min=600]
//
// Browsers: only the pinned builds under VP_CACHE/browsers (installed with
// @puppeteer/browsers 2.13.0; see the note for versions and archive hashes):
//   chrome   Chrome for Testing 154.0.8037.57    firefox  Firefox 156.0.1
// Hard rule 2 (CLAUDE.md): every launch gets a new temporary profile directory; the
// spawned PID is recorded; cleanup is browser.close(), then `taskkill /pid <PID> /T /F`
// on any abnormal exit (exit, SIGINT, SIGTERM, uncaughtException), then the profile is
// deleted. Nothing is ever killed by image name; the installed Chrome is never touched.
//
// The page runs from a local static server (serve.mjs) on 127.0.0.1. The result is read
// through the protocol (window.__vpResult once window.__vpDone) — nothing is downloaded.
// --per-run-context (Chrome): each run of the matrix in a fresh browser context.
// --plans=FILE (with --per-run-context; § Addition 2026-10-12, A5): FILE is a JSON array of page
// parameter strings, one matrix each (for example one per clip set). Their runs are interleaved
// repeat by repeat (repeat 0 of every plan, then repeat 1, ...), so every plan sees the same
// machine load; --params is added to every plan. Each run row keeps its plan's clipset.
// --mode=identity: the page hashes its output PCM; this script compares the hashes with
// the same engine in Node (parity/identity-node.mjs) and fails on any difference.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { P } from "../lib/paths.mjs";
import { startServer } from "./serve.mjs";
import { buildMatrix, cfgFromParams } from "./matrix.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const BROWSER = args.browser || "chrome";
const EXE = {
  chrome: path.join(P.browsers, "chrome", "win64-154.0.8037.57", "chrome-win64", "chrome.exe"),
  firefox: path.join(P.browsers, "firefox", "win64-stable_156.0.1", "core", "firefox.exe"),
}[BROWSER];
if (!EXE) throw new Error(`--browser=chrome|firefox`);
const params = new URLSearchParams(args.params || "");
if (args.mode) params.set("mode", args.mode);
params.set("auto", "1");
const timeoutMs = Number(args["timeout-min"] || 600) * 60000;

let browser = null, pid = null, server = null;
const profiles = [];
function cleanup() {
  if (pid) { try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ } pid = null; }
  for (const d of profiles.splice(0)) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* locked */ } }
  if (server) { server.close(); server = null; }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function launch() {
  const profile = mkdtempSync(path.join(os.tmpdir(), `vp-${BROWSER}-`));
  profiles.push(profile);
  browser = await puppeteer.launch({
    browser: BROWSER, executablePath: EXE, headless: !args.headful, userDataDir: profile,
    args: BROWSER === "chrome" ? ["--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] : [],
    protocolTimeout: timeoutMs,
  });
  pid = browser.process()?.pid ?? null;
  log(`${BROWSER} ${await browser.version()} pid ${pid} profile ${profile}`);
}

async function runPage(ctx, url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  let lastDone = -1;
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({ done: window.__vpDone === true, p: window.__vpProgress || null, s: document.getElementById("status")?.textContent }));
    if (st.done) break;
    if (Date.now() - t0 > timeoutMs) throw new Error("page timed out");
    if (st.p && st.p.done !== lastDone && st.p.done % 10 === 0) { lastDone = st.p.done; log(`${st.p.done}/${st.p.total} ${st.s}`); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const result = await page.evaluate(() => window.__vpResult);
  await page.close();
  return { result, errors };
}

server = await startServer({ port: Number(args.port || 0) });
const port = server.address().port;
const base = `http://localhost:${port}/scripts/voice-preview/timing/index.html`;
await launch();
let out;
const t0 = Date.now();
try {
  if (args["per-run-context"]) {
    if (BROWSER !== "chrome") throw new Error("--per-run-context is Chrome-only here");
    const plans = (args.plans ? JSON.parse(readFileSync(args.plans, "utf8")) : [""]).map((ps) => {
      const q = new URLSearchParams(ps);
      for (const [k, v] of params) q.set(k, v);
      return { q, matrix: buildMatrix(cfgFromParams(q)) };
    });
    const queue = [];
    const reps = Math.max(...plans.map((p) => Math.max(...p.matrix.map((s) => s.rep)) + 1));
    for (let rep = 0; rep < reps; rep++) for (const p of plans) for (const s of p.matrix.filter((x) => x.rep === rep)) queue.push({ q: p.q, s });
    out = { meta: null, metas: [], plans: plans.map((p) => p.q.toString()), runs: [], errors: [] };
    let k = 0;
    for (const { q: pq, s } of queue) {
      const ctx = await browser.createBrowserContext();
      const q = new URLSearchParams(pq); q.set("run", String(s.i));
      const { result, errors } = await runPage(ctx, `${base}?${q}`);
      await ctx.close();
      out.meta = out.meta || result.meta;
      if (!out.metas.some((m) => m.href.split("&run=")[0] === result.meta.href.split("&run=")[0])) out.metas.push(result.meta);
      out.runs.push(...result.runs);
      out.errors.push(...errors);
      if (k++ % 10 === 0) log(`run ${k}/${queue.length}: ${s.block} ${s.rate} ${s.length}s ${s.clip} ${q.get("clipset") || "timing"}`);
    }
  } else {
    const { result, errors } = await runPage(browser.defaultBrowserContext(), `${base}?${params}`);
    out = { ...result, errors };
  }
  out.driver = { browser: BROWSER, version: await browser.version(), executable: path.relative(P.browsers, EXE), perRunContext: !!args["per-run-context"], seconds: (Date.now() - t0) / 1000 };
} finally {
  // A clean close means the PID is gone (and could be reused): never taskkill it then.
  const proc = browser.process();
  await browser.close().catch(() => {});
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    await new Promise((r) => { proc.once("exit", r); setTimeout(r, 5000); });
  }
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) pid = null;
  cleanup();
}

if (params.get("mode") === "identity") {
  const { identityNode } = await import("../parity/identity-node.mjs");
  const node = await identityNode(out.meta.cfg.builds);
  const key = (r) => `${r.build}|${r.engine}|${r.clip}|${r.rate}|${r.fe}|${r.st}|${r.a}`;
  const nm = new Map(node.map((r) => [key(r), r.sha256]));
  out.identityCompare = (out.identity || []).map((r) => ({ key: key(r), browser: r.sha256 || r.error, node: nm.get(key(r)) || null, same: !!r.sha256 && r.sha256 === nm.get(key(r)) }));
  const same = out.identityCompare.filter((r) => r.same).length;
  log(`identity: ${same} of ${out.identityCompare.length} outputs bit-identical to Node (${node.length} Node outputs)`);
  if (same !== out.identityCompare.length || out.identityCompare.length !== node.length) process.exitCode = 1;
}
const errs = out.runs?.filter((r) => r.error) || [];
if (errs.length || out.error) { process.exitCode = 1; log(`errors: ${errs.length} runs; ${out.error || ""}`); }
const file = args.out || path.join(P.timing, `${BROWSER}-${params.get("mode") || "timing"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
log(`saved ${file} (${out.runs?.length ?? 0} runs, ${out.errors?.length ?? 0} page errors, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
