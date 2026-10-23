// extract-rnnoise.mjs — writes Voice Shaper's RNNoise module, src/voice-preview/rnnoise/rnnoise.wasm,
// from the pinned npm package @jitsi/rnnoise-wasm (a devDependency; the app never imports it).
//
// Why extract: the package's separate dist/rnnoise.wasm (112 KB) is a 2022 build with the old
// RNNoise model; the RNNoise 0.2 model (xiph/rnnoise 372f7b4) ships only inside
// dist/rnnoise-sync.js, an Emscripten SINGLE_FILE build that carries the module as a base64
// data URI. Voice Shaper loads the module bytes itself (src/voice-preview/denoise.js, no
// Emscripten glue), so the bytes are taken out of that data URI unchanged and committed, like
// the WORLD build in src/voice-preview/wasm/. Model choice: measurements/voice-shaper-denoise-2026-10-23.md.
//
//   node scripts/voice-preview/extract-rnnoise.mjs           write the module (after `npm ci`)
//   node scripts/voice-preview/extract-rnnoise.mjs --check   fail unless the committed bytes
//                                                            equal a fresh extraction
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RNNOISE_PINS } from "../../src/voice-preview/denoise.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE_DIR = path.join(repo, "node_modules", "@jitsi", "rnnoise-wasm");
export const OUT = path.join(repo, "src", "voice-preview", "rnnoise", "rnnoise.wasm");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The module bytes inside the package's rnnoise-sync.js, checked against RNNOISE_PINS. */
export function extractRnnoise(packageDir = PACKAGE_DIR) {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  if (pkg.version !== RNNOISE_PINS.packageVersion) throw new Error(`@jitsi/rnnoise-wasm ${pkg.version}, pinned ${RNNOISE_PINS.packageVersion}`);
  const js = readFileSync(path.join(packageDir, "dist", "rnnoise-sync.js"));
  if (sha256(js) !== RNNOISE_PINS.syncJsSha256) throw new Error(`dist/rnnoise-sync.js sha256 ${sha256(js)}, pinned ${RNNOISE_PINS.syncJsSha256}`);
  const uris = [...js.toString("utf8").matchAll(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/g)];
  if (uris.length !== 1) throw new Error(`expected one embedded module, found ${uris.length}`);
  const wasm = Buffer.from(uris[0][1], "base64");
  if (sha256(wasm) !== RNNOISE_PINS.wasmSha256) throw new Error(`extracted module sha256 ${sha256(wasm)}, pinned ${RNNOISE_PINS.wasmSha256}`);
  return wasm;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wasm = extractRnnoise();
  if (process.argv.includes("--check")) {
    const have = existsSync(OUT) ? readFileSync(OUT) : null;
    if (!have || !have.equals(wasm)) { console.error(`FAIL ${path.relative(repo, OUT)} differs from the package's embedded module`); process.exit(1); }
    console.log(`OK ${path.relative(repo, OUT)} = @jitsi/rnnoise-wasm ${RNNOISE_PINS.packageVersion} dist/rnnoise-sync.js's module (${wasm.length} B, sha256 ${RNNOISE_PINS.wasmSha256})`);
  } else {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, wasm);
    console.log(`wrote ${path.relative(repo, OUT)} (${wasm.length} B)`);
  }
}
