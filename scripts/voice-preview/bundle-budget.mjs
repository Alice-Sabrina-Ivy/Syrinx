// bundle-budget.mjs — the voice preview's bundle budget
// (measurements/voice-preview-phase1-2026-10-19.md §11): builds the base (the branch point,
// default cue-strip at 62bf3cc, extracted with `git archive` into build/vp-budget/) and this
// tree with the same Vite settings, and compares gzip sizes.
//
//   node scripts/voice-preview/bundle-budget.mjs [--base=<rev>] [--keep]
//
// Fails when
//   - the entry chunk (the module script in index.html plus everything it imports
//     statically) grows by more than 1.0 KB gzip;
//   - the LabView chunk grows by more than 1.0 KB gzip;
//   - the card chunk (VoicePreviewCard plus any chunk only it pulls in) or the worker chunk
//     (vp-worker) is over 15 KB gzip;
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
const BASE_REV = arg("base", "62bf3cc");
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
  const closure = (start) => {
    const seen = new Set();
    const walk = (f) => { if (seen.has(f) || !chunks[f]) return; seen.add(f); for (const i of chunks[f].imports) walk(i); };
    walk(start);
    return seen;
  };
  const find = (re) => Object.keys(chunks).find((f) => re.test(f)) ?? null;
  return { chunks, entry, closure, find };
}

function run(cmd, args, opts = {}) { return execFileSync(cmd, args, { cwd: repo, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30, ...opts }); }

mkdirSync(WORK, { recursive: true });
const baseSrc = path.join(WORK, "base");
rmSync(baseSrc, { recursive: true, force: true });
mkdirSync(baseSrc, { recursive: true });
console.log(`extracting ${BASE_REV} -> build/vp-budget/base`);
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
const dEntry = sum(H, hEntry) - sum(B, bEntry);
check("entry chunk + static imports grow <= 1.0 KB gzip", dEntry <= LIMITS.entryGrowth, `${kb(sum(B, bEntry))} -> ${kb(sum(H, hEntry))}, ${dEntry >= 0 ? "+" : ""}${dEntry} B`);

const bLab = B.find(/^LabView-.*\.js$/), hLab = H.find(/^LabView-.*\.js$/);
const dLab = H.chunks[hLab].gzip - B.chunks[bLab].gzip;
check("LabView chunk grows <= 1.0 KB gzip", dLab <= LIMITS.labGrowth, `${kb(B.chunks[bLab].gzip)} -> ${kb(H.chunks[hLab].gzip)}, ${dLab >= 0 ? "+" : ""}${dLab} B`);

const card = H.find(/^VoicePreviewCard-.*\.js$/);
const cardOnly = [...H.closure(card)].filter((f) => !hEntry.has(f) && f !== hLab);
const cardSize = sum(H, cardOnly);
check("card chunk (+ chunks only it pulls in) <= 15 KB gzip", cardSize <= LIMITS.card, `${cardOnly.join(", ")}: ${kb(cardSize)}`);

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
