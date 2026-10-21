// fetch-firered-model.mjs — downloads the FireRedVAD streaming model used by
// the voice gate ("Hide pitch when no voice is heard", src/dsp/firered-vad.js)
// into public/models/firered/ (gitignored: the model files are not committed).
// The app loads them from there while FIRERED_MODEL.mirrorCommit is null; once
// the Hugging Face mirror's commit is pinned it loads them from the mirror,
// and this script is only needed for the parity test and the browser smoke
// (scripts/voice-gate-smoke.mjs) — a developer tool, never a user step.
//
// Source: the official files of github.com/FireRedTeam/FireRedVAD at a pinned
// commit (Apache-2.0; licence text in licenses/fireredvad/LICENSE, attribution
// in THIRD_PARTY_NOTICES.md). Each file is checked against its pinned size and
// sha256 before it is written; a mismatch writes nothing and exits non-zero.
// The files are treated as data (the ONNX graph is loaded by onnxruntime-web,
// cmvn.ark is parsed by firered-vad.js); nothing downloaded is executed.
//
//   node scripts/fetch-firered-model.mjs            download what is missing
//   node scripts/fetch-firered-model.mjs --check    verify only (exit 1 if missing / wrong)
//   node scripts/fetch-firered-model.mjs --out=DIR  another target directory

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIRERED_MODEL } from "../src/dsp/firered-vad.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const OUT = path.resolve(REPO, typeof args.out === "string" ? args.out : "public/models/firered");
const RAW = `https://raw.githubusercontent.com/FireRedTeam/FireRedVAD/${FIRERED_MODEL.commit}/`;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function verify(buf, f) {
  if (buf.length !== f.bytes) return `size ${buf.length} B, expected ${f.bytes} B`;
  const h = sha256(buf);
  if (h !== f.sha256) return `sha256 ${h}, expected ${f.sha256}`;
  return null;
}

let bad = 0;
mkdirSync(OUT, { recursive: true });
for (const f of FIRERED_MODEL.files) {
  const dest = path.join(OUT, f.name);
  if (existsSync(dest)) {
    const why = verify(readFileSync(dest), f);
    if (!why) { console.log(`ok       ${f.name} (${f.bytes} B, sha256 ${f.sha256.slice(0, 12)}…)`); continue; }
    console.log(`replace  ${f.name}: ${why}`);
  } else {
    console.log(`missing  ${f.name}`);
  }
  if (args.check) { bad++; continue; }
  const url = RAW + f.upstreamPath;
  let buf;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`FAIL     ${f.name}: download failed (${url}): ${err?.message || err}`);
    bad++;
    continue;
  }
  const why = verify(buf, f);
  if (why) {
    console.error(`FAIL     ${f.name}: ${why} — not written (${url})`);
    bad++;
    continue;
  }
  const tmp = `${dest}.part`;
  writeFileSync(tmp, buf);
  if (existsSync(dest)) unlinkSync(dest);
  renameSync(tmp, dest);
  console.log(`fetched  ${f.name} (${f.bytes} B, sha256 ${f.sha256.slice(0, 12)}…) from ${url}`);
}
console.log(bad ? `\n${bad} file(s) missing or wrong in ${path.relative(REPO, OUT) || OUT}` : `\nFireRedVAD model ready in ${path.relative(REPO, OUT) || OUT}`);
process.exit(bad ? 1 : 0);
