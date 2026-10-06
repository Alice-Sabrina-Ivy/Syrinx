// agg-cls.mjs — tables for linecls.mjs shards (2026-10-05 follow-up).
//   node scripts/notch-adversarial/realdata/agg-cls.mjs DIR|FILE [...] [--by=deg|source|label] [--list=N]
// 1. verdicts: tracks with a verdict (>= 3 windows), ever voice-confirmed,
//    ever machine-confirmed, granted voice timing (not onset-born, not
//    blocked by the jump guard; what changes the notch's clock).
// 2. time to the voice verdict (voice sets): s after the line's first
//    sighting, vs the 4.9 s point at which bc42ad0 promotes a not-onset-born
//    line seen at duty >= 0.9.
// 3. at-risk lines (not onset-born, seen >= 4.9 s at duty >= 0.9 in their
//    first 5 s): voice timing granted by 4.9 s / blocked by the jump guard /
//    verdict after 4.9 s / no voice verdict.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const rows = [];
for (const d of pos) {
  const files = statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [d];
  for (const f of files) rows.push(...JSON.parse(readFileSync(f)));
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "-");
const by = args.by || "deg";
const groups = {};
for (const r of rows) (groups[`${r.set} ${r[by] ?? ""}`] ??= []).push(r);
const isVoiceSet = (s) => s === "voice" || s === "held";
console.log("== 1. verdicts (tracks with >= 3 windows)");
console.log("group".padEnd(30) + ["tracks", "clips", "voice", "machine", "!onset", "granted"].map((h) => h.padStart(9)).join(""));
for (const [g, rs] of Object.entries(groups).sort()) {
  const v = rs.filter((r) => r.n > 0), nob = v.filter((r) => !r.ob0);
  // granted: voice timing among the lines that were NOT onset-born (an
  // onset-born line already has the 20 s clock; voice timing changes nothing)
  console.log(g.padEnd(30) + [v.length, new Set(v.map((r) => r.id)).size, pct(v.filter((r) => r.voice > 0).length, v.length) + "%", pct(v.filter((r) => r.mach > 0).length, v.length) + "%", nob.length, pct(nob.filter((r) => r.tGrant !== null).length, nob.length) + "%"].map((c) => String(c).padStart(9)).join(""));
}
console.log("\n== 2. time to the first voice verdict (voice lines with >= 3 windows), s after first sighting");
console.log("group".padEnd(30) + ["lines", "voice", "<=4.9s", "p50", "p90", "!onset", "timed<=4.9", "guard"].map((h) => h.padStart(13)).join(""));
for (const [g, rs] of Object.entries(groups).sort()) {
  if (!isVoiceSet(rs[0].set)) continue;
  const v = rs.filter((r) => r.n > 0), tv = v.map((r) => r.tVoice).filter((t) => t !== null).sort((a, b) => a - b);
  const q = (p) => (tv.length ? tv[Math.min(tv.length - 1, Math.floor(p * tv.length))].toFixed(1) : "-");
  // among the lines NOT born at an onset (the ones voice timing is for):
  // voice timing granted by the 4.9 s promotion point; voice-confirmed but
  // blocked by the jump guard (set before the verdict)
  const nob = v.filter((r) => !r.ob0);
  const blocked = nob.filter((r) => r.tVoice !== null && r.tGrant === null && r.tJump !== null && r.tJump <= r.tVoice);
  console.log(g.padEnd(30) + [v.length, pct(tv.length, v.length) + "%", pct(tv.filter((t) => t <= 4.9).length, v.length) + "%", q(0.5), q(0.9),
    nob.length, `${nob.filter((r) => r.tGrant !== null && r.tGrant <= 4.9).length} (${pct(nob.filter((r) => r.tGrant !== null && r.tGrant <= 4.9).length, nob.length)}%)`, blocked.length].map((c) => String(c).padStart(13)).join(""));
  if (args.list) for (const r of blocked.slice(0, +args.list)) console.log(`     guard: ${r.id} ${r.f} Hz deg ${r.deg}: tVoice ${r.tVoice} tJump ${r.tJump}`);
}
console.log("\n== 3. at-risk lines (not onset-born, seen >= 4.9 s at duty >= 0.9): voice timing by the 4.9 s promotion point");
console.log("group".padEnd(30) + ["at risk", "granted", "guard", "late", "no voice"].map((h) => h.padStart(13)).join(""));
for (const [g, rs] of Object.entries(groups).sort()) {
  const a = rs.filter((r) => r.atRisk);
  if (!a.length) continue;
  const granted = a.filter((r) => r.tGrant !== null && r.tGrant <= 4.9);
  const guard = a.filter((r) => !(r.tGrant !== null && r.tGrant <= 4.9) && r.tVoice !== null && r.tVoice <= 4.9 && r.tJump !== null && r.tJump <= 4.9);
  const late = a.filter((r) => !granted.includes(r) && !guard.includes(r) && r.tVoice !== null);
  const none = a.filter((r) => r.tVoice === null);
  console.log(g.padEnd(30) + [a.length, `${granted.length} (${pct(granted.length, a.length)}%)`, guard.length, late.length, none.length].map((c) => String(c).padStart(13)).join(""));
  if (args.list) for (const r of [...guard, ...late].slice(0, +args.list)) console.log(`     ${r.id} ${r.f} Hz: tVoice ${r.tVoice} tGrant ${r.tGrant} tJump ${r.tJump}`);
}
