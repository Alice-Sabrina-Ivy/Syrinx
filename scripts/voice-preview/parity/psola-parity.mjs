// psola-parity.mjs — the spike's PSOLA arm (lib/psola.js) against the scratch
// prototype's stored PSOLA renders: same clips, same stored F0 grids, same 26 cells;
// every finished render must be bit-identical.
//   node scripts/voice-preview/parity/psola-parity.mjs --proto-renders=<prototype renders/psola dir>
// Also times the port's analysis and renders (Node, single thread; indicative only).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { readF32, sha256Arr, cells, cellName } from "../lib/node-io.mjs";
import { psolaAnalyze, psolaRender, finish } from "../lib/psola.js";

const arg = process.argv.find((a) => a.startsWith("--proto-renders="));
if (!arg) throw new Error("--proto-renders=<dir> is required");
const PR = arg.slice("--proto-renders=".length);
const clips = JSON.parse(readFileSync(path.join(P.clips, "proto16", "clips.json"), "utf8"));
let same = 0, total = 0, missing = 0;
const differ = [];
for (const c of clips) {
  const x = readF32(path.join(P.clips, "proto16", `${c.name}.f32`));
  const g = readF32(path.join(P.clips, "proto16", `${c.name}.protogrid.f32`));
  const ana = psolaAnalyze(x, 16000, g);
  for (const [s, a] of cells(c.sex)) {
    const out = finish(psolaRender(x, 16000, ana, { st: s, a }), x);
    const ref = path.join(PR, c.name, `${cellName(s, a)}.f32`);
    total++;
    if (!existsSync(ref)) { missing++; continue; }
    const theirs = readF32(ref);
    if (sha256Arr(theirs) === sha256Arr(out)) same++;
    else {
      let mx = 0;
      for (let i = 0; i < Math.min(out.length, theirs.length); i++) mx = Math.max(mx, Math.abs(out[i] - theirs[i]));
      differ.push({ clip: c.name, cell: cellName(s, a), maxAbs: mx, lenOurs: out.length, lenTheirs: theirs.length });
    }
  }
}
console.log(JSON.stringify({ renders: total, bitIdentical: same, missing, differ: differ.slice(0, 20) }, null, 1));
process.exitCode = same === total ? 0 : 1;
