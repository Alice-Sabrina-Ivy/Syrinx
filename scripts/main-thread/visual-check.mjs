// visual-check.mjs — fixed-input checks of the pitch trace's pixels and the
// cue strip's values between two source trees
// (measurements/main-thread-cpu-2026-10-08.md guards 2 and 4).
//
//   node scripts/main-thread/visual-check.mjs --base=<tree> [--head=<tree, default this repo>]
//        [--out=<dir>] [--only=trace|cue]
//
// <tree> is a source checkout (e.g. `git archive <rev> src public index.html
// package.json vite.config.js scripts` extracted, with node_modules reachable).
// The fixtures (scripts/main-thread/fixture/) are copied into
// <tree>/build/fixture/ and built against that tree's src/ with Vite.
//
// trace: the real PitchTrace, fixed data appended at the 25 ms DSP cadence,
//   a manual clock; canvas pixels captured at fixed data steps for target
//   none / feminine at DPR 1 and 3. Pass: no capture has more than 0.2 % of
//   its pixels differing by > 8/255 in any channel, and none outside the plot
//   rectangle. Also reported, not judged: a capture 7 ms after a data step
//   (between data frames).
// cue: the real CueStrip, a scripted 60 s of props / resonance snapshots,
//   the 250 ms tick stepped by hand, transitions off; after every tick each
//   row's data attributes, header / screen-reader text, the dot, start ring,
//   trail centres and opacities. Pass: identical (positions to 0.01 px).
//
// Process hygiene (CLAUDE.md hard rule 2): puppeteer with a temporary
// --user-data-dir, browser.close() then taskkill of ITS pid only; the
// static servers are in-process.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const BASE = path.resolve(arg("base", ""));
const HEAD = path.resolve(arg("head", repo));
const OUT = path.resolve(arg("out", path.join(repo, "build", "main-thread-visual")));
const ONLY = arg("only", "");
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || !existsSync(path.join(BASE, "src"))) { console.error("need Chrome and --base=<source tree>"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

let browser = null;
const servers = [];
const profile = mkdtempSync(path.join(tmpdir(), "mt-visual-"));
function cleanup() {
  for (const s of servers) { try { s.close(); } catch { /* closed */ } }
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildFixture(tree, name) {
  const dst = path.join(tree, "build", "fixture");
  mkdirSync(dst, { recursive: true });
  cpSync(path.join(repo, "scripts/main-thread/fixture"), dst, { recursive: true });
  const out = path.join(OUT, `dist-${name}`);
  execFileSync(process.execPath, [path.join(tree, "node_modules/vite/bin/vite.js"), "build", "--config", path.join(dst, "vite.fixture.config.mjs")],
    { cwd: tree, stdio: "inherit", env: { ...process.env, FIXTURE_OUT: out } });
  return out;
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
function serve(dir) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
      try { const b = readFileSync(p); res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" }); res.end(b); }
      catch { res.writeHead(404); res.end(); }
    });
    s.listen(0, () => { servers.push(s); resolve(`http://localhost:${s.address().port}`); });
  });
}

const dists = { base: buildFixture(BASE, "base"), head: buildFixture(HEAD, "head") };
const urls = { base: await serve(dists.base), head: await serve(dists.head) };
browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--font-render-hinting=none"] });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

// ---- trace ----
const TRACE_PLAN = [
  ["17.5 s of data", (p) => p.evaluate(() => window.__step(700))],
  ["+0.325 s (voiced, glow dot)", (p) => p.evaluate(() => window.__step(13))],
  ["+0.6 s (into a gap)", (p) => p.evaluate(() => window.__step(24))],
  ["+2.4 s (octave break)", (p) => p.evaluate(() => window.__step(96))],
  ["+7 ms, no data (between frames)", (p) => p.evaluate(() => window.__idle(7)), { report: true }],
  ["+25 ms (next data frame)", (p) => p.evaluate(() => { window.__fake.epoch -= 7; window.__step(1); })],
  ["+9.6 s (clipped values)", (p) => p.evaluate(() => window.__step(384))],
];
async function traceRun(which, target, dpr) {
  const page = await browser.newPage();
  await page.setViewport({ width: 700, height: 300, deviceScaleFactor: dpr });
  await page.goto(`${urls[which]}/build/fixture/trace.html?target=${target}`);
  await page.waitForFunction(() => window.__ready === true && document.querySelector("canvas"));
  await sleep(300); // ResizeObserver / effects settle on the real event loop
  const caps = [];
  for (const [name, act] of TRACE_PLAN) {
    await act(page);
    caps.push({ name, px: await page.evaluate(() => window.__pixels()) });
    if (process.env.VC_PNG) {
      const url = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
      writeFileSync(path.join(OUT, `${which}-${target}-dpr${dpr}-${caps.length}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
  }
  await page.close();
  return caps;
}
function comparePx(a, b, dpr) {
  if (a.w !== b.w || a.h !== b.h) return { sizeDiff: true };
  const A = Buffer.from(a.b64, "base64"), B = Buffer.from(b.b64, "base64");
  const pl = 48 * dpr, pr = a.w - 28 * dpr, pt = 8 * dpr, pb = a.h - 24 * dpr;
  let any = 0, big = 0, outside = 0, maxd = 0;
  for (let i = 0, px = 0; i < A.length; i += 4, px++) {
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]), Math.abs(A[i + 3] - B[i + 3]));
    if (d === 0) continue;
    any++; maxd = Math.max(maxd, d);
    if (d > 8) {
      big++;
      const x = px % a.w, y = Math.floor(px / a.w);
      if (x < pl - 1 || x > pr + 1 || y < pt - 1 || y > pb + 1) outside++;
    }
  }
  const n = A.length / 4;
  return { any, big, outside, maxd, bigFrac: big / n, n };
}
if (ONLY !== "cue") {
  for (const target of ["none", "feminine"]) {
    for (const dpr of [1, 3]) {
      const [b, h] = [await traceRun("base", target, dpr), await traceRun("head", target, dpr)];
      for (let i = 0; i < b.length; i++) {
        const c = comparePx(b[i].px, h[i].px, dpr);
        const report = TRACE_PLAN[i][2]?.report;
        const detail = c.sizeDiff ? "canvas size differs" : `${c.any} px differ, ${c.big} by > 8/255 (${(100 * c.bigFrac).toFixed(3)} %), ${c.outside} outside the plot, max ${c.maxd}`;
        const ok = !c.sizeDiff && c.bigFrac <= 0.002 && c.outside === 0;
        if (report) console.log(`INFO  trace target=${target} dpr=${dpr} '${b[i].name}': ${detail}`);
        else check(`trace target=${target} dpr=${dpr} '${b[i].name}'`, ok, detail);
      }
      writeFileSync(path.join(OUT, `trace-${target}-dpr${dpr}.json`), JSON.stringify({ base: b.map((x) => ({ name: x.name, w: x.px.w, h: x.px.h })), head: h.map((x) => ({ name: x.name, w: x.px.w, h: x.px.h })) }));
    }
  }
}

// ---- cue strip ----
async function cueRun(which, direction, width, vp) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(`${urls[which]}/build/fixture/cue.html?direction=${direction}&w=${width}`);
  await page.waitForFunction(() => document.querySelector("[data-cue]"));
  await sleep(500); // reference assets fetched
  const dumps = [];
  for (let i = 0; i < 240; i++) {
    await page.evaluate((i) => window.__set(i), i);
    await page.waitForFunction((i) => window.__committed === i, {}, i);
    await page.evaluate(() => window.__tick());
    await sleep(40); // the tick's state update renders
    dumps.push(await page.evaluate(() => window.__dump()));
  }
  await page.close();
  return dumps;
}
if (ONLY !== "trace") {
  for (const [direction, width, vp] of [["feminine", 480, { width: 1280, height: 800 }], ["masculine", 400, { width: 448, height: 890, deviceScaleFactor: 3 }], ["exploring", 420, { width: 1280, height: 800 }]]) {
    const [b, h] = [await cueRun("base", direction, width, vp), await cueRun("head", direction, width, vp)];
    let firstDiff = null, nDiff = 0;
    for (let i = 0; i < b.length; i++) {
      const sb = JSON.stringify(b[i]), sh = JSON.stringify(h[i]);
      if (sb !== sh) { nDiff++; if (!firstDiff) firstDiff = { i, base: b[i], head: h[i] }; }
    }
    const live = b.flat().filter((r) => r.state === "live").length;
    check(`cue strip direction=${direction} width=${width} vp=${vp.width}x${vp.height}: 240 ticks identical`, nDiff === 0,
      `${nDiff} ticks differ; ${live} live row-ticks, ${b.flat().filter((r) => r.dotCentre).length} dots, ${b.flat().reduce((a, r) => a + r.trail.length, 0)} trail dots compared`);
    if (firstDiff) writeFileSync(path.join(OUT, `cue-${direction}-firstdiff.json`), JSON.stringify(firstDiff, null, 1));
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close().catch(() => {});
cleanup();
process.exit(failed ? 1 : 0);
