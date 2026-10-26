// faster-explore.mjs — the EXPLORATORY (post-hoc, not pre-registered, not
// eligible) cells of measurements/resonance-faster-2026-10-26.md §3: Huber /
// trimmed-mean readouts on 5 / 4 / 3.5 s horizons with faster restarts.
//   node scripts/resonance/faster-explore.mjs --runs=<bins jsonl,...> [--json=<out>]
const C = await import("./faster-candidates.mjs");
const mk = C._createShown;
for (const stat of ["huber", "tm20"]) for (const h of [5, 4, 3.5]) for (const [k, s, j, n] of [["short", 1.5, 0.6, 2], ["short", 1.5, 0.5, 4], ["two", 1.5, 0.6, 4], ["short", 1.0, 0.6, 4]]) {
  const id = `X-${stat}-h${h}-${k === "short" ? "R" : "T"}${s}j${j}n${n}`;
  C.CANDIDATES[id] = { family: "X", make: (ref) => mk({ ref, horizonS: h, stat, test: { kind: k, shortS: s, jumpU: j, confirmN: n } }) };
}
process.argv.push("--cands=S0," + Object.keys(C.CANDIDATES).filter((x) => x.startsWith("X-")).join(","));
await import("./faster-eval.mjs");
