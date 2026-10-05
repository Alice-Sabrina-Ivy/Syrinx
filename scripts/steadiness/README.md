# Steadiness readout oracles

The live pitch-steadiness readout (2026-10-04): 1-s SD of the pitch worker's
posted values, in semitones, from [src/audio/steadiness.js](../../src/audio/steadiness.js).
Decision data and every number: [measurements/steadiness-readout-2026-10-04.md](../../measurements/steadiness-readout-2026-10-04.md).
Background (why posted values, why a trim): [measurements/pitch-precision-steadiness-2026-10-04.md](../../measurements/pitch-precision-steadiness-2026-10-04.md).

Work dir `build/steady/` (gitignored). Inputs:
- real-chain per-hop dumps `build/session-oracle/attr/base/{sessions,fda,ptdb,voc}`
  (`scripts/session-oracle/lowband-attr.mjs`, current `src/`; column `post` = posted pitch,
  `paint` = painted trace),
- session references `build/session-oracle/refs` (`scripts/session-oracle/build_refs.py`),
- corpus references `build/pb/data` (`scripts/pitch-benchmark/export_corpora.mjs`),
- the precision pass's 96 synthetic held notes `build/prec/sc_base_*.json` (`scripts/pitch-precision/synth-chain.mjs`).

| file | role |
|---|---|
| `chainlib.mjs` | `driveHookMessages()`: drives the REAL hook with every pitch message through `handlePitchMessage` and every DSP frame through `handleAnalysisResult` (the session oracle's `driveHook` never reaches the steadiness path); `simulateModule()` |
| `synth-cases.mjs` | synthetic cases through the REAL workers + REAL hook: flat (jitter only), vibrato 4.5–6.5 Hz ±25–100 c, drift 0.5–4 st/s, sirens, ±7 / ±12 st jumps (abrupt / 80 ms), short notes, notes in pink / fan-hum / white noise at 20 / 10 / 5 dB, noise only (all noise-synth classes + babble + resonant, 4 seeds × 30 s) |
| `sim.mjs` | runs the module over posted (or `--col=paint`) series for a configuration grid (one-factor-at-a-time, trim × drop-limit grid, two-stage trims, variations around the chosen recipe `rec`, `untrimmed06` = untrimmed control at coverage 0.6, and `defaults` = the module as committed, incl. the 1.5 s hold) |
| `score.py` | readout vs reference on a 0.25 s grid. Sessions: Praat AC on own-speaker windows (disputed windows excluded), `--reftrim=3` (precision-pass convention) or `recipe` (same two-stage trim on the reference); categories held / speech-like / sparse / < 20 % voiced / reference-silent; best-window p5 / p10. Corpora: clean references untrimmed (`agree_raw`) and 3-st trimmed. Synthetic: truth contour |
| `table.py`, `table2.py`, `report.py` | one-line-per-config summaries; markdown tables for the measurement file |
| `jumps.py` | synthetic jump / siren windows spanning both notes: "—" / held / large / small (`--sim=` to pick a sim dir) |
| `stability.py` | display stability at the hook's 200 ms state cadence; number ↔ "—" flips per minute (`--sim=`) |
| `hook-check.mjs` | real chain over a session: hook state == pure module bit for bit, display readout unchanged vs the session oracle's `driveHook`, posted values == the attr dump |

## Reproduce (repo root)

```bash
R="node --import ./scripts/session-oracle/lib/register.mjs"; P=scripts/steadiness
for i in 0 1 2 3 4; do $R $P/synth-cases.mjs --shard=$i/5 & done; wait
node $P/sim.mjs --sets=sessions,fda,ptdb,voc,synth,prec
node $P/sim.mjs --sets=sessions,fda,ptdb,voc --configs=rec,t3m100 --col=paint
python $P/score.py rec untrimmed untrimmed06 t3m100 ... --reftrim=recipe --json=build/steady/score_final_recipe.json
python $P/score.py rec untrimmed t3m100 ... --reftrim=3 --json=build/steady/score_final_3.json
python $P/table2.py build/steady/score_final_recipe.json
python $P/report.py build/steady/score_final_recipe.json rec sessions   # | bins | corpora | synth | prec | best
python $P/stability.py rec defaults
python $P/jumps.py defaults t3m100
for s in 2025-09-08 2026-05-07 2026-05-26 2026-06-09; do $R $P/hook-check.mjs --session=$s; done
node tests/audio/steadiness-test.js
```
