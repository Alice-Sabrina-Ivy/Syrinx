// level-check.mjs — integrity of the level area's run dirs: unparseable lines,
// duplicate (id, gate) records, and (id, gate) pairs still missing for the kinds asked.
//   node scripts/resonance/mobile/level-check.mjs <cond dir>... [--kinds=ctl,sw,exc,long]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../..");
const kinds = (process.argv.find((a) => a.startsWith("--kinds=")) ?? "--kinds=ctl,sw,exc,long").slice(8).split(",");
const L = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8"));
const ids = [];
for (const r of L.readers) {
  if (kinds.includes("ctl")) for (const v of ["N", "U10", "D10"]) ids.push(`${r.id}__${v}`);
  if (kinds.includes("sw")) ids.push(`${r.id}__N-U10-N`, `${r.id}__N-D10-N`);
  if (kinds.includes("exc")) for (const V of ["U10", "D10"]) for (const D of [3, 5, 8]) ids.push(`${r.id}__N-${V}x${D}-N`);
  if (kinds.includes("long")) ids.push(`${r.id}__L`);
}
for (const d of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const dir = path.resolve(repo, d);
  let bad = 0, n = 0; const seen = new Map();
  for (const f of readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
    for (const l of readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!l) continue; n++;
      try { const r = JSON.parse(l); const k = `${r.id}|${r.gate}`; seen.set(k, (seen.get(k) ?? 0) + 1); } catch { bad++; }
    }
  }
  const dup = [...seen.values()].filter((c) => c > 1).length;
  const missing = ids.flatMap((id) => ["on", "off"].filter((g) => !seen.has(`${id}|${g}`)).map((g) => `${id}|${g}`));
  let badCache = 0;
  for (const f of existsSync(path.join(dir, "pitch")) ? readdirSync(path.join(dir, "pitch")) : []) { try { JSON.parse(readFileSync(path.join(dir, "pitch", f), "utf8")); } catch { badCache++; } }
  console.log(`${d}: lines ${n} bad ${bad} dupPairs ${dup} missing ${missing.length}${missing.length && missing.length < 12 ? " " + missing.join(" ") : ""} badPitchCache ${badCache}`);
}
