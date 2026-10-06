// agg-gender.mjs — the gender-symmetric voice metric on realeval.mjs voice
// rows (2026-10-06 fix round): per variant, hold frames painted at pitch
// pooled per gender group (grp "male" / "female"; other groups listed), the
// error 100 - that, and max(F_err, M_err) — the binding ship metric for pitch
// (CLAUDE.md); plus the streams with a notch on the voice (promoV) per group
// and the streams more than 1 pp below the base.
//   node scripts/notch-adversarial/realdata/agg-gender.mjs DIR|FILE [...] [--vars=B,V14,SRC] [--base=B] [--as=SRC:V18,...] [--kind=cos-]
// --as renames variants (several dirs may carry different variants of the
// same streams: rows are merged by stream id). --kind keeps rows whose kind
// starts with the prefix.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const A = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const byId = new Map();
for (const d of argv.filter((a) => !a.startsWith("--"))) {
  const [dir, as] = d.split("@"); // DIR@SRC:V18,V16:V16 renames for this dir only
  const ren = Object.fromEntries((as ?? A.as ?? "").split(",").filter(Boolean).map((p) => p.split(":")));
  const files = statSync(dir).isDirectory() ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : [dir];
  for (const f of files) for (const r of JSON.parse(readFileSync(f))) {
    if (r.set !== "voice") continue;
    if (A.kind && !String(r.kind).startsWith(A.kind)) continue;
    const e = byId.get(r.id) ?? { ...r, v: {} };
    for (const [k, v] of Object.entries(r.v)) e.v[ren[k] ?? k] = v;
    byId.set(r.id, e);
  }
}
const rows = [...byId.values()];
const vars = A.vars ? A.vars.split(",") : Object.keys(rows[0].v);
const base = A.base || "B";
const groups = [...new Set(rows.map((r) => r.grp))].sort();
console.log(`${rows.length} voice streams; groups ${groups.map((g) => `${g} ${rows.filter((r) => r.grp === g).length}`).join(", ")}`);
for (const v of vars) {
  const per = {};
  for (const g of groups) {
    let a = 0, n = 0, notched = 0, m = 0;
    for (const r of rows.filter((q) => q.grp === g)) {
      const c = r.v[v]; if (!c || c.pok == null) continue;
      a += c.pok * c.pok_n / 100; n += c.pok_n; m++;
      if (c.promoV != null) notched++;
    }
    per[g] = { pct: n ? 100 * a / n : NaN, notched, m };
  }
  const err = (g) => (per[g] ? 100 - per[g].pct : NaN);
  const sym = Math.max(err("male"), err("female"));
  const worse = rows.filter((r) => r.v[v]?.pok != null && r.v[base]?.pok != null && r.v[v].pok < r.v[base].pok - 1);
  console.log(`${v.padEnd(5)} max(F_err, M_err) ${sym.toFixed(2)} pp | ` + groups.map((g) => `${g}: ${per[g].pct.toFixed(2)} % painted at pitch, voice notched in ${per[g].notched}/${per[g].m}`).join(" | ")
    + (v === base ? "" : ` | ${worse.length} streams < ${base} - 1 pp${worse.length ? ": " + worse.slice(0, 6).map((r) => `${r.id} (${r.grp}, ${r.f0} Hz) ${r.v[v].pok} vs ${r.v[base].pok}`).join("; ") : ""}`));
}
