// wasm-files-test.js — the committed voice-preview WebAssembly build
// (src/voice-preview/wasm/) is exactly the spike's pinned build: the files match
// BUILD.json and the sha256 values the Phase 1 design recorded, BUILD.json's pins are
// build.mjs's PINS, both modules validate and load in Node, and the SIMD probe
// accepts SIMD here. measurements/voice-preview-phase1-2026-10-19.md §12, §14 item 1.
//
// CI does not rebuild; `node scripts/voice-preview/build.mjs --check-shipped` (with the
// pinned emsdk and WORLD source under $VP_CACHE) proves the bytes are reproducible.
//
//   node tests/voice-preview/wasm-files-test.js
import { readFileSync } from "node:fs";
import path from "node:path";
import { WASM_DIR, sha256, loadWorld, makeChecker, REPO } from "./vp-test-lib.js";
import { PINS, EXPORTS, SHIP_FILES } from "../../scripts/voice-preview/build.mjs";
import { simdSupported } from "../../src/voice-preview/engine/world.js";

const T = makeChecker();
// The design's recorded hashes (§12): the bytes the phone gate timed.
const DESIGN = {
  "simd/vp_world.wasm": "fa3a29cf0ef75145ebe7fa6ab2b5dfa526ce9d1e5eb1a6409f291e863a7d3a25",
  "nosimd/vp_world.wasm": "09cf5e8ae0bb2d4ae1fb11eb2e11a32fddd3a94f767365bad47c84b40e33598d",
  "vp_world.mjs": "5e7a7a209e4a88ceb765a8d5c64cf2af33ad5abe8700cd38071d2ed117d988c5",
};
const build = JSON.parse(readFileSync(path.join(WASM_DIR, "BUILD.json"), "utf8"));

console.log("committed files");
T.check("BUILD.json lists exactly the shipped files", JSON.stringify(Object.keys(build.files).sort()) === JSON.stringify(Object.keys(DESIGN).sort())
  && JSON.stringify(Object.keys(SHIP_FILES).sort()) === JSON.stringify(Object.keys(DESIGN).sort()));
const bytes = {};
for (const [rel, want] of Object.entries(DESIGN)) {
  const buf = readFileSync(path.join(WASM_DIR, ...rel.split("/")));
  bytes[rel] = buf;
  const h = sha256(buf);
  T.check(`${rel}: sha256 = the design's and BUILD.json's`, h === want && build.files[rel]?.sha256 === want && build.files[rel]?.raw === buf.length,
    h === want ? `${buf.length} B` : `got ${h} (a CRLF checkout? see .gitattributes)`);
}
T.check("BUILD.json build records agree (wasm per build, one glue)",
  build.builds.simd.wasm.sha256 === DESIGN["simd/vp_world.wasm"] && build.builds.nosimd.wasm.sha256 === DESIGN["nosimd/vp_world.wasm"]
  && build.builds.simd.glue.sha256 === DESIGN["vp_world.mjs"] && build.builds.nosimd.glue.sha256 === DESIGN["vp_world.mjs"]);
T.check("features: SIMD only in the SIMD build",
  build.builds.simd.features.includes("simd") && !build.builds.nosimd.features.includes("simd"), `${build.builds.simd.features} / ${build.builds.nosimd.features}`);

console.log("\npins");
T.check("BUILD.json pins = build.mjs PINS", JSON.stringify(build.pins) === JSON.stringify(PINS));
T.check("BUILD.json exports = build.mjs EXPORTS", JSON.stringify(build.exports) === JSON.stringify(EXPORTS));
T.check("pinned WORLD commit and licence hash", PINS.world.commit === "8d79b88b7dd92e8a132996cf74080b2d6f881b98"
  && PINS.world.licenseSha256 === "cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe");
T.check("pinned emsdk 6.0.10 at a2b9277", PINS.emsdk.version === "6.0.10" && PINS.emsdk.commit === "a2b92777574c2feda07994cd4f1079a3dfc151f8");
T.check("emcc version recorded", /6\.0\.10 \(d6c521a7f05449857c76bd99e396895583cf2083\)/.test(build.emcc), build.emcc);
const noLocal = (s) => !/[A-Za-z]:[\\/]/.test(s);
T.check("BUILD.json command lines use placeholders only", Object.values(build.builds).every((b) => noLocal(b.command) && b.command.includes("$VP_CACHE") && b.command.includes("<repo>/scripts/voice-preview")));
const wl = readFileSync(path.join(REPO, "licenses/world/LICENSE.txt"));
T.check("licenses/world/LICENSE.txt is WORLD's LICENSE.txt at the pinned commit", sha256(wl) === PINS.world.licenseSha256);

console.log("\nmodules");
T.check("SIMD probe accepts SIMD in this Node", simdSupported(), process.version);
for (const b of ["simd", "nosimd"]) {
  T.check(`${b}: WebAssembly.validate`, WebAssembly.validate(bytes[`${b}/vp_world.wasm`]));
  let ok = false, detail = "";
  try {
    const w = await loadWorld(b);
    ok = w.mod._vp_version() === 1 && w.fftSize(48000) === 2048 && w.fftSize(16000) === 1024 && w.fftSize(44100) === 2048;
    detail = `fft 48k ${w.fftSize(48000)}, 16k ${w.fftSize(16000)}; memory ${w.memoryBytes()} B`;
  } catch (err) { detail = String(err); }
  T.check(`${b}: loads in Node through the committed glue; vp_version 1; WORLD's FFT sizes`, ok, detail);
}
T.done();
