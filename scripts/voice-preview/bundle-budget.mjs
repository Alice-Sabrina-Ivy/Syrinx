// bundle-budget.mjs — Voice Shaper's bundle budget (the feature was "Voice preview", a
// Resonance lab view, until 2026-10-20; now its own lazily loaded tab)
// (measurements/voice-preview-phase1-2026-10-19.md §11 and "Renamed and moved
// 2026-10-20"): builds the base (default: the
// merge base of HEAD and origin/cue-strip, i.e. the cue-strip commit this branch last
// merged, else cue-strip at 811ebb8, the branch point; extracted with `git archive` into
// build/vp-budget/; since 2026-10-25 the integrated approved-UI commit UI_BASELINE when it
// is newer — see below) and this tree with the same Vite settings, and compares gzip sizes.
//
//   node scripts/voice-preview/bundle-budget.mjs [--base=<rev>] [--keep]
//
// Fails when
//   - what every page load fetches grows by more than 1.0 KB gzip: the entry chunk (the
//     module script in index.html plus everything it imports statically) AND the
//     stylesheets index.html links (the card's Tailwind classes land in the main stylesheet;
//     counted since the fix step);
//   - the LabView chunk grows by more than 1.0 KB gzip (since the move it should not grow
//     at all: the lab no longer carries Voice Shaper);
//   - the Voice Shaper tab's chunk (VoiceShaperView with the card, plus any chunk only it
//     pulls in) or the worker chunk (vp-worker) is over 15 KB gzip;
//   - the tab's chunk is in the entry's static closure, or the LabView chunk refers to it;
//   - "createVpWorld", "vp_world" or "voice-preview" appears in the entry or LabView chunks.
// Both trees are built with an inline config equal to vite.config.js minus the notices
// plugins (they emit a text asset only, no code, and need a node_modules beside the tree).
// The extracted base resolves its packages through this checkout's node_modules (Node's
// upward lookup from build/vp-budget/base/), so nothing is installed or linked.

import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
// Baseline moved 2026-10-25: the approved UI refinements (boards A-D: the first-visit
// and goal-check sheets, the practice dock + saved toast + History's Recording now card,
// Settings as a side / bottom sheet) added +5.5 KB gzip to the entry chunk + stylesheet
// on purpose (JS +4.3 KB, CSS +1.2 KB, measured against b3e2e9b). This budget guards
// against Voice Shaper code reaching every page load, not against approved app UI, so the
// integrated UI commit is the base whenever it is in HEAD's history and newer than the
// merge base with origin/cue-strip (once cue-strip carries it, the merge base takes over).
const UI_BASELINE = "70bab92a8c79";
function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function isAncestor(a, b) {
  try { git(["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; }
}
function defaultBase() {
  let mergeBase = null;
  try { mergeBase = git(["merge-base", "HEAD", "origin/cue-strip"]).slice(0, 12); } catch { /* no origin/cue-strip */ }
  if (isAncestor(UI_BASELINE, "HEAD") && (!mergeBase || isAncestor(mergeBase, UI_BASELINE))) return UI_BASELINE;
  return mergeBase ?? "811ebb8";
}
const BASE_REV = arg("base", "") || defaultBase();
const KEEP = process.argv.includes("--keep");
const WORK = path.join(repo, "build", "vp-budget");
const KB = 1024;
const LIMITS = { entryGrowth: 1.0 * KB, labGrowth: 1.0 * KB, card: 15 * KB, worker: 15 * KB };

async function buildTree(root, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  await build({
    configFile: false,
    root,
    base: "/Syrinx/",
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    worker: { format: "es" },
    build: { outDir, emptyOutDir: true },
  });
}

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

/** Chunk graph of a build: file -> { size (gzip), imports (static) }. */
function analyse(outDir) {
  const assets = path.join(outDir, "assets");
  const chunks = {};
  for (const f of readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const code = readFileSync(path.join(assets, f), "utf8");
    // static imports between chunks: import{..}from"./x.js" / import"./x.js" (not import("./x.js"))
    const imports = [...code.matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)["']/g)].map((m) => m[1]);
    chunks[f] = { gzip: gz(Buffer.from(code)), code, imports: [...new Set(imports)] };
  }
  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  const entry = html.match(/<script type="module"[^>]*src="[^"]*\/assets\/([\w.-]+\.js)"/)[1];
  // the stylesheets every page load fetches with the entry
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="[^"]*\/assets\/([\w.-]+\.css)"/g)].map((m) => m[1]);
  const cssGzip = css.reduce((t, f) => t + gz(readFileSync(path.join(assets, f))), 0);
  const closure = (start) => {
    const seen = new Set();
    const walk = (f) => { if (seen.has(f) || !chunks[f]) return; seen.add(f); for (const i of chunks[f].imports) walk(i); };
    walk(start);
    return seen;
  };
  const find = (re) => Object.keys(chunks).find((f) => re.test(f)) ?? null;
  return { chunks, entry, css, cssGzip, closure, find };
}

function run(cmd, args, opts = {}) { return execFileSync(cmd, args, { cwd: repo, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30, ...opts }); }

mkdirSync(WORK, { recursive: true });
const baseSrc = path.join(WORK, "base");
rmSync(baseSrc, { recursive: true, force: true });
mkdirSync(baseSrc, { recursive: true });
console.log(`base ${BASE_REV}${arg("base", "") ? "" : BASE_REV === UI_BASELINE ? " (default: UI_BASELINE, the approved UI of 2026-10-25)" : " (default: merge base with origin/cue-strip)"}; extracting -> build/vp-budget/base`);
const tar = run("git", ["archive", "--format=tar", BASE_REV, "index.html", "src", "public"]);
execFileSync("tar", ["-x", "-f", "-"], { cwd: baseSrc, input: tar, maxBuffer: 1 << 30 }); // cwd, not -C: GNU tar reads "C:\\" as a host
if (!existsSync(path.join(baseSrc, "src", "main.jsx"))) throw new Error("base extraction failed");

console.log("building base and head");
await buildTree(baseSrc, path.join(WORK, "base-dist"));
await buildTree(repo, path.join(WORK, "head-dist"));
const B = analyse(path.join(WORK, "base-dist"));
const H = analyse(path.join(WORK, "head-dist"));

const sum = (G, set) => [...set].reduce((t, f) => t + G.chunks[f].gzip, 0);
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`); };
const kb = (n) => `${(n / KB).toFixed(2)} KB`;

const bEntry = B.closure(B.entry), hEntry = H.closure(H.entry);
const dJs = sum(H, hEntry) - sum(B, bEntry);
const dCss = H.cssGzip - B.cssGzip;
const dEntry = dJs + dCss;
const sgn = (n) => `${n >= 0 ? "+" : ""}${n} B`;
check("entry chunk + static imports + entry stylesheet grow <= 1.0 KB gzip", dEntry <= LIMITS.entryGrowth,
  `JS ${kb(sum(B, bEntry))} -> ${kb(sum(H, hEntry))}, ${sgn(dJs)}; CSS (${H.css.join(", ")}) ${B.cssGzip} -> ${H.cssGzip} B, ${sgn(dCss)}; together ${sgn(dEntry)}`);

const bLab = B.find(/^LabView-.*\.js$/), hLab = H.find(/^LabView-.*\.js$/);
const dLab = H.chunks[hLab].gzip - B.chunks[bLab].gzip;
check("LabView chunk grows <= 1.0 KB gzip", dLab <= LIMITS.labGrowth, `${kb(B.chunks[bLab].gzip)} -> ${kb(H.chunks[hLab].gzip)}, ${dLab >= 0 ? "+" : ""}${dLab} B`);

const card = H.find(/^VoiceShaperView-.*\.js$/);
if (!card) throw new Error("no VoiceShaperView chunk in the head build");
const cardOnly = [...H.closure(card)].filter((f) => !hEntry.has(f) && f !== hLab);
const cardSize = sum(H, cardOnly);
check("Voice Shaper tab chunk (VoiceShaperView + card, + chunks only it pulls in) <= 15 KB gzip", cardSize <= LIMITS.card, `${cardOnly.join(", ")}: ${kb(cardSize)}`);
check("the tab's chunk loads lazily: not in the entry's static closure, not referred to by LabView",
  !hEntry.has(card) && !H.chunks[hLab].code.includes(card) && H.chunks[H.entry].code.includes(card), `${card}; LabView refers to it: ${H.chunks[hLab].code.includes(card)}`);

const worker = H.find(/^vp-worker-.*\.js$/);
const workerSet = H.closure(worker);
const workerSize = sum(H, workerSet);
check("worker chunk <= 15 KB gzip", workerSize <= LIMITS.worker, `${[...workerSet].join(", ")}: ${kb(workerSize)}`);

const FORBIDDEN = /createVpWorld|vp_world|voice-preview/;
const leaks = [...hEntry, hLab].filter((f) => FORBIDDEN.test(H.chunks[f].code)).map((f) => `${f}: ${H.chunks[f].code.match(FORBIDDEN)[0]}`);
check("no createVpWorld / vp_world / voice-preview in the entry or LabView chunks", leaks.length === 0, leaks.join("; ") || "none");

const wasm = readdirSync(path.join(WORK, "head-dist", "assets")).filter((f) => /\.wasm$/.test(f) && /vp_world/.test(f))
  .map((f) => `${f} ${kb(gz(readFileSync(path.join(WORK, "head-dist", "assets", f))))}`);
console.log(`(voice-preview WebAssembly, fetched one at a time by the worker: ${wasm.join(", ")})`);

if (!KEEP) rmSync(WORK, { recursive: true, force: true });
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
