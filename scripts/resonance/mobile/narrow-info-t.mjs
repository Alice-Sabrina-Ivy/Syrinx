// narrow-info-t.mjs — the info text's numbers (plan §11) of the narrower
// resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md),
// computed after the confirmation verdict, on the confirmation speech:
//   N (the streak span) comes from narrow-report.mjs (speech.clean.<pick>.all.ageFull);
//   T: over the noisier conditions where the pick's thumb is gone in > 5 % of
//      the 1–5 s pauses, the median, over their 1–5 s pauses in which the trail
//      cleared, of the time from the pause's start to the first tick with an
//      empty trail (rounded to 0.5 s for the text).
// "The trail cleared in the pause": the last tick before the pause's start
// had >= 1 point and a tick in the pause's thumb window (render points a ..
// b + 10, i.e. the pause's start to its end + 250 ms, §7) has 0. The pause's
// start is render point a, at (a + 1)·25 ms. Pauses, classes and the window
// are pause-report.mjs pausesFromClean / pauseMetrics's (kFrom 20 s, 1–5 s =
// 40–199 chunks); the replay is stripReplay with the pick's shipped factory.
//
//   node scripts/resonance/mobile/narrow-info-t.mjs [--pick=K4]
//        [--speech-runs=build/resonance-mobile/narrow/confirm/pause/runs]
//        [--speech-hook=build/resonance-mobile/narrow/confirm/pause/hook]
//        [--conds=brown_m50,pink_m50,ac_m50,brown_m48,pink_m48,ac_m48,brown_m40,pink_m40,ac_m40]
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PR = await import("./pause-report.mjs");
const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const pick = arg("pick", "K4");
const runs = path.resolve(repo, arg("speech-runs", "build/resonance-mobile/narrow/confirm/pause/runs"));
const hookDir = path.resolve(repo, arg("speech-hook", "build/resonance-mobile/narrow/confirm/pause/hook"));
const conds = arg("conds", "brown_m50,pink_m50,ac_m50,brown_m48,pink_m48,ac_m48,brown_m40,pink_m40,ac_m40").split(",").filter(Boolean);
const load = (dir, re) => readdirSync(dir).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const hooks = load(hookDir, /^hook-.*\.jsonl$/).filter((h) => conds.includes(h.cond));
const chain = new Map();
for (const c of conds) for (const r of load(path.join(runs, c), /^runs-.*\.jsonl$/)) if (r.gate === "on") chain.set(`${c}|${r.id}`, r);
const cands = { [pick]: CS.RESONANCE_HOLD_CANDIDATES[pick] };
const per = {};
for (const h of hooks) {
  const cr = chain.get(`${h.cond}|${h.id}`);
  if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
  const R = PR.stripReplay(h, cr, { from: 20, cands });
  const clean = JSON.parse(readFileSync(path.join(runs, "clean", "pitch", `${h.id}.json`), "utf8")).byChunk;
  const A = R.arms[pick];
  per[h.cond] ??= { n: 0, gone: 0, cleared: 0, T: [] };
  for (const [a, b] of PR.pausesFromClean(clean)) {
    if (a < R.kFrom || b + 10 >= R.n) continue;
    const len = b - a + 1;
    if (len < 40 || len >= 200) continue;
    const P = per[h.cond];
    P.n++;
    let gone = false;
    for (let k = a; k <= b + 10; k++) if (!A.thumb[k]) { gone = true; break; }
    if (gone) P.gone++;
    const t0 = (a + 1) * 0.025, t1 = (b + 11) * 0.025;
    const before = A.ticks.filter((x) => x.t < t0).pop();
    if (!before || before.trailLen === 0) continue;
    const first = A.ticks.find((x) => x.t >= t0 && x.t <= t1 && x.trailLen === 0);
    if (!first) continue;
    P.cleared++;
    P.T.push(first.t - t0);
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const pooled = [];
for (const c of conds) {
  const v = per[c];
  if (!v) continue;
  const g = (100 * v.gone) / v.n;
  console.log(`${c}: 1–5 s pauses ${v.n}, thumb gone ${v.gone} (${g.toFixed(1)} %), trail cleared ${v.cleared}, T median ${med(v.T)?.toFixed(3) ?? "—"} s`);
  if (g > 5) pooled.push(...v.T);
}
const m = med(pooled);
console.log(`pooled over the conditions with the thumb gone in > 5 %: ${pooled.length} pauses, T median ${m?.toFixed(3) ?? "—"} s -> ${m != null ? (Math.round(m * 2) / 2).toFixed(1) : "—"} s`);
