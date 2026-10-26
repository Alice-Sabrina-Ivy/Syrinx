// third-party-notices.mjs — ships the licence notices with the built site.
//
// The built app (dist/, deployed to GitHub Pages) carries copies of
// third-party code: React, Dexie, Transformers.js and, since 2026-10-07, the
// ONNX Runtime WebAssembly runtime files (src/ml/ort-runtime-files.js), which
// used to come from jsDelivr together with the npm package's licence. MIT and
// Apache-2.0 require the notice to travel with the copies, so the build emits
//   THIRD_PARTY_NOTICES.txt                    THIRD_PARTY_NOTICES.md + Syrinx's
//                                              LICENSE + the full licence text of
//                                              every npm package bundled into the
//                                              app or a worker
//   licenses/onnxruntime-ThirdPartyNotices.txt ONNX Runtime's own notices for
//                                              the components inside its .wasm
// and the Settings panel links to them (DataManagement.jsx).
//
// Which packages are bundled is read from Rollup's module graph (main build
// and every worker build), so a new dependency is picked up automatically. A
// bundled package with no licence file in node_modules and no committed copy
// under licenses/ FAILS the build — add its licence text to licenses/<name>/.
// onnxruntime-web / onnxruntime-common publish no LICENSE file in their npm
// packages; licenses/onnxruntime-web/ holds the LICENSE and
// ThirdPartyNotices.txt of microsoft/onnxruntime at the commit the shipped
// runtime was built from (node_modules/onnxruntime-web/__commit.txt).
//
// Code that is not an npm package (NON_NPM_COMPONENTS, 2026-10-19): Voice
// Shaper's WebAssembly module (src/voice-preview/wasm/) contains compiled WORLD
// (modified BSD, which requires its text with binary copies) and Emscripten's
// JavaScript runtime and system libraries (musl, dlmalloc, LLVM compiler-rt /
// libc++ / libc++abi). When the build's module graph contains a module under
// src/voice-preview/wasm/, their texts (licenses/world/, licenses/emscripten/) are
// appended to THIRD_PARTY_NOTICES.txt like the npm packages'; the dev server's
// notices always include them. measurements/voice-preview-phase1-2026-10-19.md §12.
// Since 2026-10-25 Voice Shaper's background-noise reduction (src/voice-preview/dfn3.js) is a JS
// port of DeepFilterNet's libDF signal processing (MIT OR Apache-2.0); the three graphs it runs
// are fetched at run time (src/voice-preview/dfn3-model.js) and come under the same licence:
// licenses/deepfilternet/. measurements/voice-shaper-noise-2026-10-25.md. (RNNoise, shipped
// 2026-10-23 to 2026-10-25, was replaced by it.)
//
// tests/site/third-party-notices-test.js covers the assembly.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// npm packages that ship no licence file; their committed licence text.
export const COMMITTED_LICENSES = {
  "onnxruntime-web": ["licenses/onnxruntime-web/LICENSE"],
  "onnxruntime-common": ["licenses/onnxruntime-web/LICENSE"],
};
// Shipped code that is not an npm package: which module ids carry it, and its licence files.
export const NON_NPM_COMPONENTS = Object.freeze([
  {
    name: "WORLD",
    title: "WORLD (M. Morise; mmorise/World 8d79b88b7dd92e8a132996cf74080b2d6f881b98; its fft.cpp includes T. Ooura's FFT routines) — compiled into Voice Shaper's WebAssembly module",
    idPattern: /\/src\/voice-preview\/wasm\//,
    files: ["licenses/world/LICENSE.txt"],
  },
  {
    name: "Emscripten",
    title: "Emscripten 6.0.10 runtime and system libraries (musl, dlmalloc, LLVM compiler-rt, libc++, libc++abi) — in Voice Shaper's WebAssembly module and its JavaScript glue",
    idPattern: /\/src\/voice-preview\/wasm\//,
    files: [
      "licenses/emscripten/LICENSE",
      "licenses/emscripten/musl-COPYRIGHT",
      "licenses/emscripten/dlmalloc-NOTICE.txt",
      "licenses/emscripten/compiler-rt-LICENSE.TXT",
      "licenses/emscripten/libcxx-LICENSE.TXT",
      "licenses/emscripten/libcxxabi-LICENSE.TXT",
    ],
  },
  {
    name: "DeepFilterNet",
    title: "DeepFilterNet 3 (H. Schröter et al.; Rikorose/DeepFilterNet d375b2d8309e0935d165700c91da9de862a99c31) — libDF's signal processing ported to JS for Voice Shaper's background-noise reduction, and its ONNX graphs (fetched at run time); MIT OR Apache-2.0, both texts",
    idPattern: /\/src\/voice-preview\/dfn3(-model)?\.js$/,
    files: ["licenses/deepfilternet/LICENSE-MIT", "licenses/deepfilternet/LICENSE-APACHE"],
  },
]);

export const ORT_THIRD_PARTY_NOTICES = "licenses/onnxruntime-web/ThirdPartyNotices.txt";
// Models whose files the app serves (not npm packages): their licence text
// always ships in THIRD_PARTY_NOTICES.txt. FireRedVAD: the voice gate's
// model (Apache-2.0; loaded at runtime from the project's Hugging Face mirror,
// pinned in src/dsp/firered-vad.js FIRERED_MODEL.mirrorCommit).
export const MODEL_LICENSES = [
  { title: "FireRedVAD (FireRedTeam) — model used by the voice gate, Apache License 2.0", file: "licenses/fireredvad/LICENSE" },
];
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";
export const ORT_NOTICES_FILE = "licenses/onnxruntime-ThirdPartyNotices.txt";

/** "…/node_modules/@scope/name/dist/x.js?url" -> "@scope/name" (the innermost node_modules). */
export function packageOfModuleId(id) {
  const p = String(id).replace(/\\/g, "/").split("?")[0];
  const i = p.lastIndexOf("/node_modules/");
  if (i < 0) return null;
  const rest = p.slice(i + "/node_modules/".length).split("/");
  if (!rest[0] || rest[0].startsWith(".")) return null;
  return rest[0].startsWith("@") ? (rest[1] ? `${rest[0]}/${rest[1]}` : null) : rest[0];
}

/** Names of the NON_NPM_COMPONENTS a module id belongs to ("…/src/voice-preview/wasm/vp_world.mjs?url" -> ["WORLD", "Emscripten"]). */
export function componentsOfModuleId(id) {
  const p = String(id).replace(/\\/g, "/").split("?")[0];
  return NON_NPM_COMPONENTS.filter((c) => c.idPattern.test(p)).map((c) => c.name);
}

/** Licence text(s) of one package: its LICENSE / LICENCE / COPYING / NOTICE files, else the committed copy. */
export function licenseTextOf(name, { repo = REPO } = {}) {
  const dir = path.join(repo, "node_modules", name);
  const found = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (/^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f)) found.push(path.join(dir, f));
    }
  }
  const files = found.length ? found : (COMMITTED_LICENSES[name] ?? []).map((f) => path.join(repo, f));
  if (!files.length || !files.every((f) => existsSync(f))) {
    throw new Error(`third-party notices: no licence text for bundled package "${name}" — add it under licenses/${name}/ (scripts/third-party-notices.mjs)`);
  }
  let version = "";
  try { version = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? ""; } catch { /* no package.json */ }
  return { name, version, text: files.map((f) => readFileSync(f, "utf8").trimEnd()).join("\n\n") };
}

/** The THIRD_PARTY_NOTICES.txt body for these bundled packages (and NON_NPM_COMPONENTS names). */
export function buildNoticesText(packages, { repo = REPO, components = [] } = {}) {
  const names = [...new Set(packages)].sort();
  const rule = "=".repeat(78);
  const parts = [
    readFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), "utf8").trimEnd(),
    "",
    rule,
    "Syrinx — LICENSE",
    rule,
    readFileSync(path.join(repo, "LICENSE"), "utf8").trimEnd(),
  ];
  for (const n of names) {
    const { version, text } = licenseTextOf(n, { repo });
    parts.push("", rule, `${n}${version ? ` ${version}` : ""} — bundled into this site`, rule, text);
  }
  if (names.includes("onnxruntime-web")) {
    parts.push("", rule, "onnxruntime-web — the WebAssembly runtime's third-party components",
      rule, `See ${ORT_NOTICES_FILE} (ONNX Runtime's ThirdPartyNotices.txt at the commit the runtime was built from).`);
  }
  const wanted = new Set(components);
  for (const c of NON_NPM_COMPONENTS) {
    if (!wanted.has(c.name)) continue;
    const missing = c.files.filter((f) => !existsSync(path.join(repo, f)));
    if (missing.length) throw new Error(`third-party notices: ${c.name}: missing ${missing.join(", ")} (scripts/third-party-notices.mjs)`);
    const text = c.files.map((f) => readFileSync(path.join(repo, f), "utf8").trimEnd()).join(`\n\n${"-".repeat(78)}\n\n`);
    parts.push("", rule, c.title, rule, text);
  }
  for (const m of MODEL_LICENSES) {
    parts.push("", rule, m.title, rule, readFileSync(path.join(repo, m.file), "utf8").trimEnd());
  }
  return parts.join("\n") + "\n";
}

/**
 * Vite plugins: `collect` goes into both `plugins` and `worker.plugins` (it
 * records the bundled packages of every Rollup build); `emit` (main build
 * only) writes the notice files at the end of the main build, after the
 * workers were bundled.
 */
export function thirdPartyNotices({ repo = REPO } = {}) {
  const packages = new Set();
  const components = new Set();
  const record = (id) => {
    const n = packageOfModuleId(id);
    if (n) packages.add(n);
    for (const c of componentsOfModuleId(id)) components.add(c);
  };
  const collect = () => ({
    name: "syrinx-third-party-notices-collect",
    apply: "build",
    generateBundle() {
      for (const id of this.getModuleIds()) record(id);
    },
  });
  const emit = {
    name: "syrinx-third-party-notices-emit",
    apply: "build",
    enforce: "post",
    generateBundle() {
      for (const id of this.getModuleIds()) record(id);
      this.emitFile({ type: "asset", fileName: NOTICES_FILE, source: buildNoticesText(packages, { repo, components }) });
      if (packages.has("onnxruntime-web")) {
        this.emitFile({ type: "asset", fileName: ORT_NOTICES_FILE, source: readFileSync(path.join(repo, ORT_THIRD_PARTY_NOTICES), "utf8") });
      }
    },
  };
  // Dev server: no module graph to read, so the notices list the direct
  // dependencies plus ONNX Runtime and every non-npm component (the build's
  // list is the authoritative one).
  const serve = {
    name: "syrinx-third-party-notices-serve",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        let body = null;
        if (url.endsWith(`/${NOTICES_FILE}`)) {
          const deps = Object.keys(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).dependencies ?? {});
          body = buildNoticesText([...deps, "onnxruntime-web", "onnxruntime-common"], { repo, components: NON_NPM_COMPONENTS.map((c) => c.name) });
        } else if (url.endsWith(`/${ORT_NOTICES_FILE}`)) {
          body = readFileSync(path.join(repo, ORT_THIRD_PARTY_NOTICES), "utf8");
        }
        if (body === null) { next(); return; }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(body);
      });
    },
  };
  return { collect, emit, serve, packages, components };
}
