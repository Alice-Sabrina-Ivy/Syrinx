// merge.mjs — joins run.mjs's shard files into <out>/rows-<set>.jsonl, in the take list's
// order, and checks that every take x condition is there exactly once.
//
//   node scripts/exercises/take-checks/merge.mjs [--out=build/exercise-take-checks]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { positiveTakes, negativeTakes, CONDITIONS } from "./stimuli.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const OUT = resolve(args.out ?? "build/exercise-take-checks");
const parts = readdirSync(resolve(OUT, "parts"));
let bad = 0;
for (const set of ["sel", "conf", "neg"]) {
  const rows = new Map();
  for (const f of parts.filter((x) => x.startsWith(`rows-${set}.`) && x.endsWith(".jsonl"))) {
    for (const l of readFileSync(resolve(OUT, "parts", f), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const r = JSON.parse(l);
      const key = `${r.takeId}|${r.cond}`;
      if (rows.has(key)) { console.log(`duplicate ${key}`); bad++; }
      rows.set(key, r);
    }
  }
  const keys = set === "neg"
    ? negativeTakes().map((t) => `${t.id}|-`)
    : positiveTakes(set).takes.flatMap((t) => CONDITIONS.map((c) => `${t.id}|${c}`));
  const missing = keys.filter((k) => !rows.has(k));
  const extra = [...rows.keys()].filter((k) => !keys.includes(k));
  if (missing.length || extra.length) { console.log(`${set}: missing ${missing.length} (${missing.slice(0, 4).join(", ")}), extra ${extra.length}`); bad++; }
  writeFileSync(resolve(OUT, `rows-${set}.jsonl`), keys.filter((k) => rows.has(k)).map((k) => JSON.stringify(rows.get(k))).join("\n") + "\n");
  console.log(`${set}: ${keys.length} expected, ${rows.size} rows -> ${resolve(OUT, `rows-${set}.jsonl`)}`);
}
process.exit(bad ? 1 : 0);
