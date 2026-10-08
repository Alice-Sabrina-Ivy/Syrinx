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
export const ORT_THIRD_PARTY_NOTICES = "licenses/onnxruntime-web/ThirdPartyNotices.txt";
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

/** The THIRD_PARTY_NOTICES.txt body for these bundled packages. */
export function buildNoticesText(packages, { repo = REPO } = {}) {
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
  const collect = () => ({
    name: "syrinx-third-party-notices-collect",
    apply: "build",
    generateBundle() {
      for (const id of this.getModuleIds()) {
        const n = packageOfModuleId(id);
        if (n) packages.add(n);
      }
    },
  });
  const emit = {
    name: "syrinx-third-party-notices-emit",
    apply: "build",
    enforce: "post",
    generateBundle() {
      for (const id of this.getModuleIds()) {
        const n = packageOfModuleId(id);
        if (n) packages.add(n);
      }
      this.emitFile({ type: "asset", fileName: NOTICES_FILE, source: buildNoticesText(packages, { repo }) });
      if (packages.has("onnxruntime-web")) {
        this.emitFile({ type: "asset", fileName: ORT_NOTICES_FILE, source: readFileSync(path.join(repo, ORT_THIRD_PARTY_NOTICES), "utf8") });
      }
    },
  };
  // Dev server: no module graph to read, so the notices list the direct
  // dependencies plus ONNX Runtime (the build's list is the authoritative one).
  const serve = {
    name: "syrinx-third-party-notices-serve",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        let body = null;
        if (url.endsWith(`/${NOTICES_FILE}`)) {
          const deps = Object.keys(JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).dependencies ?? {});
          body = buildNoticesText([...deps, "onnxruntime-web", "onnxruntime-common"], { repo });
        } else if (url.endsWith(`/${ORT_NOTICES_FILE}`)) {
          body = readFileSync(path.join(repo, ORT_THIRD_PARTY_NOTICES), "utf8");
        }
        if (body === null) { next(); return; }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(body);
      });
    },
  };
  return { collect, emit, serve, packages };
}
