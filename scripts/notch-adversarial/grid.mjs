// grid.mjs — the 2026-10-03 held-note MAIN grid (150-300 Hz x 6/10/14/20 s x
// 8 modulations x 3 qualities = 480) and REQUIREMENT grid (120/220 Hz x
// 8/12/20/30 s x 5 modulations x 3 qualities = 120), same synth + configs +
// scoring as the 2026-10-03 held.mjs grid (grid-synth.mjs = its synthesizer), but
// through the REAL worker (lib.mjs) instead of the chainlib mirror.
//   node scripts/notch-adversarial/grid.mjs --set=main|req --variants=B,SRC --shard=i/n --out=FILE
import { writeFileSync } from "node:fs";
import { heldNote } from "./grid-synth.mjs";
import { runWorker, displayed } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const VARS = (args.variants || "HEAD").split(",");
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
const QUAL = { modalA: { h1h2: 4, hnrDb: 30, vowel: "a" }, breathyI: { h1h2: 12, hnrDb: 10, vowel: "i" }, breathyU: { h1h2: 12, hnrDb: 10, vowel: "u" } };
const MODS = {
  steady: { wanderCents: 0 }, wander5: { wanderCents: 5 }, wander10: { wanderCents: 10 },
  vib10: { wanderCents: 3, vibCents: 10, vibHz: 5.5 }, vib20: { wanderCents: 3, vibCents: 20, vibHz: 5.5 }, vib25: { wanderCents: 3, vibCents: 25, vibHz: 5 },
  drift15: { wanderCents: 3, driftCents: 15 }, drift50: { wanderCents: 3, driftCents: 50 },
};
const configs = [];
if (args.set === "req") {
  for (const f0 of [120, 220]) for (const durSec of [8, 12, 20, 30]) for (const [mn, m] of Object.entries({ steady: MODS.steady, wander5: MODS.wander5, vib10: MODS.vib10, vib25: MODS.vib25, drift15: MODS.drift15 }))
    for (const [qn, q] of Object.entries(QUAL)) configs.push({ name: `${f0}/${durSec}s/${mn}/${qn}`, f0, durSec, jitterPct: 0.5, ...m, ...q, seed: f0 * 7 + durSec * 13 + mn.length * 3 + qn.length });
} else {
  for (const f0 of [150, 180, 220, 260, 300]) for (const durSec of [6, 10, 14, 20]) for (const [mn, m] of Object.entries(MODS))
    for (const [qn, q] of Object.entries(QUAL)) configs.push({ name: `${f0}/${durSec}s/${mn}/${qn}`, f0, durSec, jitterPct: 0.5, ...m, ...q, seed: f0 * 7 + durSec * 13 + mn.length * 3 + qn.length });
}
const rows = [];
for (const cfg of configs.filter((_, i) => i % shN === shI)) {
  const x = heldNote(cfg);
  const row = { cfg: cfg.name, f0: cfg.f0, dur: cfg.durSec, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, 16000);
    const d = displayed(msgs);
    let n = 0, ok = 0, dok = 0, promo = null;
    msgs.forEach((m, i) => {
      if (promo === null && m.nf && m.nf.some((f) => [1, 2, 3].some((k) => Math.abs(f / (k * cfg.f0) - 1) < 0.04))) promo = +(m.t - 1).toFixed(2);
      const t = m.t - 1;
      if (t < 0.3 || t > cfg.durSec - 0.1) return;
      n++;
      if (m.pitch > 0 && Math.abs(m.pitch / cfg.f0 - 1) < 0.08) ok++;
      if (d[i] > 0 && Math.abs(d[i] / cfg.f0 - 1) < 0.08) dok++;
    });
    row.v[vn] = { ok: +(100 * ok / n).toFixed(1), dOk: +(100 * dok / n).toFixed(1), promo };
  }
  rows.push(row);
  console.log(cfg.name.padEnd(28), VARS.map((vn) => `${vn}:${row.v[vn].ok}/${row.v[vn].promo ?? "-"}`).join(" "));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));
