// third-party-notices-test.js — the licence notices that ship with the built
// site (scripts/third-party-notices.mjs): every npm package bundled into
// the app has a licence text, ONNX Runtime's (whose npm package ships none)
// comes from licenses/onnxruntime-web/, and an unknown package without one
// fails instead of shipping without its notice. Voice Shaper's WebAssembly
// module (not an npm package) brings WORLD's and Emscripten's texts exactly when
// a module under src/voice-preview/wasm/ is in the build.
//
//   node tests/site/third-party-notices-test.js

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageOfModuleId, licenseTextOf, buildNoticesText, COMMITTED_LICENSES, ORT_THIRD_PARTY_NOTICES,
  componentsOfModuleId, NON_NPM_COMPONENTS,
} from "../../scripts/third-party-notices.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

console.log("module id -> package");
check("plain", packageOfModuleId("C:/x/node_modules/react/index.js") === "react");
check("scoped", packageOfModuleId("/r/node_modules/@huggingface/transformers/dist/transformers.web.js") === "@huggingface/transformers");
check("?url asset", packageOfModuleId("C:\\x\\node_modules\\onnxruntime-web\\dist\\ort-wasm-simd-threaded.wasm?url") === "onnxruntime-web");
check("nested node_modules -> innermost", packageOfModuleId("/r/node_modules/a/node_modules/b/x.js") === "b");
check("app source -> null", packageOfModuleId("/r/src/ml/gender-worker.js") === null);
check("virtual module -> null", packageOfModuleId("\0vite/preload-helper.js") === null);

console.log("\nlicence texts");
const ort = licenseTextOf("onnxruntime-web");
check("onnxruntime-web: committed MIT text (Microsoft)", /MIT License/.test(ort.text) && /Copyright \(c\) Microsoft Corporation/.test(ort.text), ort.version);
const commit = readFileSync(path.join(repo, "node_modules/onnxruntime-web/__commit.txt"), "utf8").trim();
check("onnxruntime-web: version matches the build commit", ort.version.endsWith(commit.slice(0, 10)), `${ort.version} / ${commit.slice(0, 10)}`);
check("ORT ThirdPartyNotices committed", existsSync(path.join(repo, ORT_THIRD_PARTY_NOTICES)) && /THIRD PARTY SOFTWARE NOTICES/.test(readFileSync(path.join(repo, ORT_THIRD_PARTY_NOTICES), "utf8")));
for (const n of ["react", "react-dom", "scheduler", "dexie", "@huggingface/transformers", ...Object.keys(COMMITTED_LICENSES)]) {
  let t = null;
  try { t = licenseTextOf(n).text; } catch { /* reported below */ }
  check(`${n}: has a licence text`, typeof t === "string" && t.length > 200);
}
let threw = false;
try { licenseTextOf("syrinx-no-such-package-for-test"); } catch { threw = true; }
check("a bundled package without a licence text fails", threw);

console.log("\nTHIRD_PARTY_NOTICES.txt");
const txt = buildNoticesText(["react", "onnxruntime-web", "react"]);
check("starts with THIRD_PARTY_NOTICES.md", txt.startsWith(readFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), "utf8").trimEnd()));
check("includes Syrinx's LICENSE", txt.includes(readFileSync(path.join(repo, "LICENSE"), "utf8").trim()));
check("includes the ORT MIT notice", txt.includes("Copyright (c) Microsoft Corporation"));
check("points at ORT's ThirdPartyNotices", txt.includes("licenses/onnxruntime-ThirdPartyNotices.txt"));
check("each package once", (txt.match(/— bundled into this site/g) ?? []).length === 2);

console.log("\nnon-npm components (Voice Shaper: WORLD + Emscripten)");
const vpIds = ["C:\\r\\src\\voice-preview\\wasm\\vp_world.mjs?url", "/r/src/voice-preview/wasm/simd/vp_world.wasm?url"];
check("voice-preview wasm module ids -> WORLD + Emscripten", vpIds.every((id) => componentsOfModuleId(id).join() === "WORLD,Emscripten"));
check("other modules -> none", componentsOfModuleId("/r/src/voice-preview/vp-worker.js").length === 0
  && componentsOfModuleId("/r/src/ml/gender-worker.js").length === 0 && componentsOfModuleId("C:/x/node_modules/react/index.js").length === 0);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const worldText = readFileSync(path.join(repo, "licenses/world/LICENSE.txt"));
check("licenses/world/LICENSE.txt = WORLD's LICENSE.txt at the pinned commit (sha256)",
  sha(worldText) === "cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe");
const EMS = {
  "licenses/emscripten/LICENSE": "620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86",
  "licenses/emscripten/musl-COPYRIGHT": "b870108ec5e7790e9f9919064f1b9421d62d5f9b0e6c230c6adf7ea2da62e97b",
  "licenses/emscripten/compiler-rt-LICENSE.TXT": "1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d",
  "licenses/emscripten/libcxx-LICENSE.TXT": "539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b",
  "licenses/emscripten/libcxxabi-LICENSE.TXT": "e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c",
};
for (const [f, h] of Object.entries(EMS)) {
  check(`${f}: unchanged copy from emsdk 6.0.10 (sha256)`, existsSync(path.join(repo, f)) && sha(readFileSync(path.join(repo, f))) === h);
}
check("every component's files exist", NON_NPM_COMPONENTS.every((c) => c.files.length > 0 && c.files.every((f) => existsSync(path.join(repo, f)))));
const withVp = buildNoticesText(["react"], { components: ["WORLD", "Emscripten"] });
const withoutVp = buildNoticesText(["react"]);
const worldStr = worldText.toString("utf8").trimEnd();
const emsLicence = readFileSync(path.join(repo, "licenses/emscripten/LICENSE"), "utf8").trimEnd();
const musl = readFileSync(path.join(repo, "licenses/emscripten/musl-COPYRIGHT"), "utf8").trimEnd();
const llvm = readFileSync(path.join(repo, "licenses/emscripten/libcxx-LICENSE.TXT"), "utf8").trimEnd();
check("with Voice Shaper: WORLD's full text", withVp.includes(worldStr));
check("with Voice Shaper: Emscripten, musl, dlmalloc and LLVM texts", withVp.includes(emsLicence) && withVp.includes(musl)
  && withVp.includes(llvm) && withVp.includes("Doug Lea and released to the public domain"));
check("without Voice Shaper: none of them", !withoutVp.includes(worldStr) && !withoutVp.includes(emsLicence) && !withoutVp.includes(musl));
const md = readFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), "utf8");
check("THIRD_PARTY_NOTICES.md lists WORLD and the Emscripten runtime", md.includes("| WORLD (M. Morise)") && md.includes("| Emscripten 6.0.10 runtime"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
