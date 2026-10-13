// clips-44k.mjs — 44.1 kHz copies of the timing clips, for the 44.1 kHz capture rule (§ Addition
// 2026-10-12, A3 / A4 / A5, of measurements/voice-preview-spike-2026-10-12.md). A device that
// captures at 44.1 kHz with 48 kHz selected runs WORLD at 44.1 kHz with no resampling, so the
// page gets 44.1 kHz PCM:
//   PCM     each 48 kHz cut (3, 5, 8 s) brought to 44 100 Hz in Node with the page's resampler
//           (lib/preview-core.js resampleClip: the lab's sinc resampler, cutoff 0.45 x 44 100 Hz)
//   F-S     the REAL pitch worker's posted track on the 44.1 kHz PCM (session-oracle runWorkers at
//           44 100 Hz, 1103-sample chunks), as the live chain would post it on such a device
// Writes VP_CACHE/clips/<set>-44k/ (index.json with sr 44100, <clip>_<L>s.f32, .post.f32) for
// set = timing and timing-speech. No F-L grid (only F-S is timed at the new rates).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/prep/clips-44k.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { readF32, writeArr, sha256Arr } from "../lib/node-io.mjs";
import { resampleClip } from "../lib/preview-core.js";

const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
const S = await loadSrc(path.join(REPO, "src"));
const SR = 44100;

for (const set of ["timing", "timing-speech"]) {
  const SD = path.join(P.clips, set), OD = path.join(P.clips, `${set}-44k`);
  mkdirSync(OD, { recursive: true });
  const idx = JSON.parse(readFileSync(path.join(SD, "index.json"), "utf8"));
  const out = { from: set, resampler: "lib/preview-core.js resampleClip (sinc, cutoff 0.45 x 44100 Hz)", clips: [] };
  for (const c of idx.clips) {
    const oc = { name: c.name, sex: c.sex, sr: SR, from: { set, sr: c.sr }, lengths: {} };
    for (const [L, e] of Object.entries(c.lengths)) {
      const x = resampleClip(readF32(path.join(SD, e.pcm)), c.sr, SR);
      const post = Float32Array.from(runWorkers(S, x, SR).col.post);
      const pcm = e.pcm, posted = e.pcm.replace(/\.f32$/, ".post.f32");
      writeArr(path.join(OD, pcm), x);
      writeArr(path.join(OD, posted), post);
      oc.lengths[L] = { pcm, samples: x.length, sha256: sha256Arr(x), posted, fromSha256: e.sha256 };
      console.log(`${set}-44k ${c.name} ${L} s: ${x.length} samples, ${post.length} hops (${post.filter((v) => v > 0).length} voiced)`);
    }
    out.clips.push(oc);
  }
  writeFileSync(path.join(OD, "index.json"), JSON.stringify(out, null, 1));
}
