// gate-lag.mjs — the resonance cue's utterance gate (src/ml/utterance-gate.js,
// as resonanceCue.js drives it: decide(chunk contextTime) once per chunk,
// notePitchHint for each relayed hint) under a steady relay lag of D chunks.
// Counts the verdict at every chunk over the c0 pitch runs (gate-on hints).
//   node scripts/resonance/mobile/gate-lag.mjs [--pitch=build/resonance-mobile/audit/pitch/c0]
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { createUtteranceGate } = await import(pathToFileURL(path.join(repo, "src/ml/utterance-gate.js")).href);
const dir = path.resolve(repo, arg("pitch", "build/resonance-mobile/audit/pitch/c0"));
const files = readdirSync(dir).filter((f) => /__(L|N)\.json$/.test(f));
const V = ["silent", "warming", "score", "sustained", "pause", "stale"];
console.log("| lag (chunks) | lag s | " + V.join(" | ") + " | dropped (warming+sustained, voiced chunks) |");
console.log("|---|---|" + V.map(() => "---").join("|") + "|---|");
for (const D of [0, 1, 2, 4, 8, 12, 20, 30, 40, 60, 80]) {
  const cnt = Object.fromEntries(V.map((v) => [v, 0]));
  let vc = 0, vdrop = 0;
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const g = createUtteranceGate();
    const n = j.byChunk.length;
    for (let k = 0; k < n; k++) {
      const ct = (k + 1) * 0.025;
      const verdict = g.decide(ct * 1000).verdict;
      cnt[verdict]++;
      // is the audio of this chunk voiced (posted frame for this chunk's ct, gate-on)?
      const kk = k + 2 < n ? j.byChunk[k + 2].find((m) => Math.abs(m[2] - ct) < 1e-9) : null;
      const voiced = kk && kk[0] && kk[3] !== 0;
      if (voiced) { vc++; if (verdict === "warming" || verdict === "sustained") vdrop++; }
      const src = k - D;
      if (src >= 0) for (const m of j.byChunk[src]) g.notePitchHint({ voiced: m[3] === 0 ? false : !!m[0], pitch: m[1], ts: m[2] * 1000 });
    }
  }
  const tot = Object.values(cnt).reduce((a, b) => a + b, 0);
  console.log(`| ${D} | ${(D * 0.025).toFixed(3)} | ` + V.map((v) => (100 * cnt[v] / tot).toFixed(1) + " %").join(" | ") + ` | ${(100 * vdrop / vc).toFixed(1)} % |`);
}
