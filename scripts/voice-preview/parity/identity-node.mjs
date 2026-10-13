// identity-node.mjs — Node side of the browser-vs-Node bit-identity check (§P3
// cross-engine): the same preview engine (lib/preview-core.js), the same .wasm and
// the same inputs as the timing page's ?mode=identity; returns sha256 of every output PCM.
//   node scripts/voice-preview/parity/identity-node.mjs [simd,nosimd]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, loadLab, readF32, sha256Arr } from "../lib/node-io.mjs";
import { Preview } from "../lib/preview-core.js";
import { IDENTITY_CASES, IDENTITY_CELLS } from "../timing/matrix.js";

export async function identityNode(builds = ["simd", "nosimd"]) {
  const idx = JSON.parse(readFileSync(path.join(P.clips, "timing", "index.json"), "utf8"));
  const lab = await loadLab();
  const rows = [];
  for (const build of builds) {
    const world = await loadWorldNode(build);
    for (const c of IDENTITY_CASES) {
      const e = idx.clips.find((k) => k.name === c.clip).lengths[String(c.length)];
      const pcm = readF32(path.join(P.clips, "timing", e.pcm));
      const posted = c.fe === "S" ? readF32(path.join(P.clips, "timing", e.posted)) : null;
      const pv = new Preview({ engine: c.engine, world, lab });
      const [first, ...rest] = IDENTITY_CELLS;
      let r = pv.analyse(pcm, 48000, { rate: c.rate, frontEnd: c.fe, posted, framePeriod: 5, first: { st: first[0], a: first[1] } });
      rows.push({ build, ...c, st: first[0], a: first[1], n: r.pcm.length, sha256: sha256Arr(r.pcm) });
      for (const [st, a] of rest) {
        r = pv.render(st, a);
        rows.push({ build, ...c, st, a, n: r.pcm.length, sha256: sha256Arr(r.pcm) });
      }
      pv.free();
    }
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const builds = (process.argv[2] || "simd,nosimd").split(",");
  for (const r of await identityNode(builds)) console.log(`${r.build} ${r.engine} ${r.clip} ${r.rate} ${r.fe} (${r.st}, ${r.a}): ${r.sha256}`);
}
