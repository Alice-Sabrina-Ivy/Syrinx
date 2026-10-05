// merge.mjs OUT DIR:VAR[,VAR] ... — merge suite shards from several runs by
// scenario key (held: name+sr; int: all job fields), picking the listed variants
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const [out, ...specs] = process.argv.slice(2);
const by = new Map();
const key = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== "v")));
for (const s of specs) {
  const [d, vs] = s.split(":");
  for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) for (const r of JSON.parse(readFileSync(path.join(d, f)))) {
    const k = key(r); if (!by.has(k)) by.set(k, { ...r, v: {} });
    for (const v of vs.split(",")) if (r.v[v]) by.get(k).v[v] = r.v[v];
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "m.json"), JSON.stringify([...by.values()]));
console.log(by.size, "rows");
