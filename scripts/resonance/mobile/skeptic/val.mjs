import path from "node:path"; import { pathToFileURL } from "node:url";
import { fileURLToPath as toPath } from "node:url";
const repo = path.resolve(path.dirname(toPath(import.meta.url)), "../../../..");
const { createRestartReadout, RESTART } = await import(pathToFileURL(path.join(repo, "src/resonance/resonanceCue.js")).href);
const { loadDedup } = await import(pathToFileURL(path.join(repo, "scripts/resonance/mobile/level-summarize.mjs")).href);
const REF = (await import(pathToFileURL(path.join(repo, "public/resonance-lab/reference.json")).href, { with: { type: "json" } })).default.vtln;
const recs = loadDedup(path.resolve(repo, "build/resonance-mobile/level/g0")).filter((r) => r.gate === "on").slice(0, 40);
for (const off of [0, -1]) {
let c = { eq: 0, postNull: 0, other: 0 }, ex = [];
for (const r of recs) {
  const ro = createRestartReadout({ ref: REF, restart: RESTART });
  let last = null, dropped = 0, bi = 0;
  for (const p of r.posts) {
    while (bi < r.bins.length && r.bins[bi][4] <= p[0] + off) { const [te, st, v, adm] = r.bins[bi]; const d = last === null ? 0 : Math.max(0, st - last); last = st; if (!adm) dropped += d; else ro.add(st - dropped, v); bi++; }
    const a = ro.snapshot().u, b = p[2];
    if (a === b || (a != null && b != null && Math.abs(a - b) < 1e-12)) c.eq++; else if (b == null) c.postNull++; else { c.other++; if (ex.length < 3) ex.push([r.id, p[0], a, b]); }
  }
}
console.log(off, c, ex);
}
