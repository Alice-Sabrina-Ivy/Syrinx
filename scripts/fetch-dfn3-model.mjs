// fetch-dfn3-model.mjs — downloads DeepFilterNet 3's three ONNX graphs (Voice Shaper's noise
// reduction, src/voice-preview/dfn3.js) into build/models/dfn3/ (gitignored, outside public/ so no
// build ships it). The app loads them from the project's Hugging Face mirror once
// DFN3_MODEL.mirrorCommit is set; this copy is for Node (tests/voice-preview/dfn3-test.js, the
// worker and controller tests, the noise study) and, with --out=public/models/dfn3 and
// mirrorCommit null, for offline development of the app. A developer tool, never a user step.
//
// Source: models/DeepFilterNet3_onnx.tar.gz of github.com/Rikorose/DeepFilterNet at the pinned
// commit (MIT OR Apache-2.0; licence texts in licenses/deepfilternet/). The archive and each
// extracted graph are checked against their pinned size and sha256 before anything is written; a
// mismatch writes nothing and exits non-zero. The archive is read by this script's own tar reader
// (no extraction tool runs) and the graphs are data for onnxruntime; nothing downloaded is executed.
//
//   node scripts/fetch-dfn3-model.mjs            download what is missing
//   node scripts/fetch-dfn3-model.mjs --check    verify only (exit 1 if missing / wrong)
//   node scripts/fetch-dfn3-model.mjs --out=DIR  another target directory (default build/models/dfn3)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { DFN3_MODEL } from "../src/voice-preview/dfn3.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
export const LOCAL_DFN3_DIR = path.join(REPO, "build", "models", "dfn3");
const OUT = typeof args.out === "string" ? path.resolve(REPO, args.out) : LOCAL_DFN3_DIR;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
// tmp/export/config.ini too (the [df] values src/voice-preview/dfn3.js hard-codes; dfn3-test.js reads it)
const CONFIG = { name: "config.ini", member: "tmp/export/config.ini", bytes: 2067, sha256: DFN3_MODEL.configSha256 };
const ok = (f) => { const p = path.join(OUT, f.name); if (!existsSync(p)) return false; const b = readFileSync(p); return b.length === f.bytes && sha256(b) === f.sha256; };

/** Members of an uncompressed ustar archive: { name -> Buffer }. */
function untar(buf) {
  const out = new Map();
  for (let o = 0; o + 512 <= buf.length;) {
    const h = buf.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, n) => h.subarray(a, a + n).toString("latin1").replace(/\0.*$/s, "");
    const name = (str(345, 155) ? `${str(345, 155)}/` : "") + str(0, 100);
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    if (type === "0") out.set(name, buf.subarray(o + 512, o + 512 + size));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const want = [...DFN3_MODEL.files, CONFIG].filter((f) => !ok(f));
if (args.check) {
  if (want.length) { console.error(`missing or wrong in ${OUT}: ${want.map((f) => f.name).join(", ")}`); process.exit(1); }
  console.log(`DeepFilterNet 3 graphs ok in ${OUT}`); process.exit(0);
}
if (want.length === 0) { console.log(`DeepFilterNet 3 graphs already in ${OUT}`); process.exit(0); }
const url = `https://raw.githubusercontent.com/Rikorose/DeepFilterNet/${DFN3_MODEL.commit}/${DFN3_MODEL.archive.path}`;
const res = await fetch(url);
if (!res.ok) { console.error(`${url}: HTTP ${res.status}`); process.exit(1); }
const tgz = Buffer.from(await res.arrayBuffer());
if (tgz.length !== DFN3_MODEL.archive.bytes || sha256(tgz) !== DFN3_MODEL.archive.sha256) { console.error(`archive: ${tgz.length} B, sha256 ${sha256(tgz)} — not the pinned file`); process.exit(1); }
const members = untar(gunzipSync(tgz));
const got = [...DFN3_MODEL.files, CONFIG].map((f) => [f, members.get(f.member)]);
for (const [f, b] of got) if (!b || b.length !== f.bytes || sha256(b) !== f.sha256) { console.error(`${f.member}: not the pinned graph`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
for (const [f, b] of got) writeFileSync(path.join(OUT, f.name), b);
console.log(`fetched ${got.map(([f]) => f.name).join(", ")} from ${url}\nDeepFilterNet 3 graphs ready in ${OUT}`);
