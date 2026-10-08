// third-party-notices-test.js — the licence notices that ship with the built
// site (scripts/third-party-notices.mjs): every npm package bundled into
// the app has a licence text, ONNX Runtime's (whose npm package ships none)
// comes from licenses/onnxruntime-web/, and an unknown package without one
// fails instead of shipping without its notice.
//
//   node tests/site/third-party-notices-test.js

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageOfModuleId, licenseTextOf, buildNoticesText, COMMITTED_LICENSES, ORT_THIRD_PARTY_NOTICES,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
