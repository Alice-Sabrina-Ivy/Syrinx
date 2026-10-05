# Pitch precision / steadiness oracles

The precision and steadiness pass of 2026-10-04: where Syrinx's fine pitch
error comes from, and whether a 1-s pitch-SD (semitones) "steadiness" readout
computed from the chain would track a reference. Decision data and every
number: [measurements/pitch-precision-steadiness-2026-10-04.md](../../measurements/pitch-precision-steadiness-2026-10-04.md).

Work dir `build/prec/` (gitignored). Corpus dump `build/pb/data`
(`scripts/pitch-benchmark/export_corpora.mjs`, `PITCH_BENCH_DIR=build/pb`),
session references `build/session-oracle/refs` (`scripts/session-oracle/build_refs.py`),
real-chain per-hop dumps `build/session-oracle/attr/<tag>` from
`scripts/session-oracle/lowband-attr.mjs` (the `base` tag = current `src/`).

| file | role |
|---|---|
| `lib.mjs` | additive held-vowel synthesizer with known instantaneous F0 (jitter, shimmer, aspiration noise, vibrato / wander / glide contours, 4 vowels); a reproduction of `boersma-ac.js` `candidates()`' window-corrected autocorrelation (checked against the production candidate frequencies in `est.mjs static16`); peak refiners (parabolic = production, log-parabolic, Praat sinc70 + golden-section, harmonic-weighted spectral) |
| `est.mjs` | estimator-only precision on synthetic frames (oracle candidate = AC peak nearest the truth), conditions `static16/48/441`, `jit48`, `jitnoisy48`, `vib48`, `wander48` |
| `synth-chain.mjs`, `synth_an.py` | 96 synthetic 5-s held notes (82–390 Hz, truth 1-s SD 0.05–1.5 st) through the REAL chain (`session-oracle/lib/chain.mjs`); 1-s SD agreement at the posted and painted level |
| `est-real.mjs`, `praat_corp.py`, `er_an.py` | corpus (FDA / PTDB / vocadito) fine-error decomposition on a common frame set: Syrinx posted / painted vs oracle-candidate estimators at 80/40 ms windows x 25/10 ms hops x refiners, Praat AC / CC, and the reference itself sampled at the hop and smoothed by the 80 ms frame |
| `steady_lib.py`, `steady_real.py` | 1-s SD windowing; corpus / vocadito windows (`--sets=voc`) incl. a 3-st-trimmed estimator |
| `steady_sess.py` | session 1-s SD agreement vs Praat AC (CC as a second tracker): own-voicing vs joint-voicing, plain vs trimmed, held (`--minref=0.9`) vs speech-like (`--minref=0.6`) windows, posted / painted / readout |
| `pitch-refine.js`, `variants.py` | the measured post-decode refinement variants (`sinc`, `sub40`) and the unsmoothed display (`m1`) as src trees under `build/prec/trees/` |
| `prec_cmp.py` | variant comparison on a common frame set (corpus FPE overall + slow segments; session SD agreement). `PAINT_LAG` = the display alignment (0.030 s for the deployed median-3, 0.005 for `m1`) |
| `cpu.mjs`, `cpu-micro.mjs` | whole-chain CPU per chunk (noisy on a shared desktop) and the per-frame refiner cost vs `candidates()` |

## Reproduce (repo root)

```bash
P=scripts/pitch-precision; R="node --import ./scripts/session-oracle/lib/register.mjs"
node $P/est.mjs static16,static48,static441,jit48,jitnoisy48,vib48,wander48
for i in 0 1 2 3 4 5 6 7; do $R $P/synth-chain.mjs --src=src --out=build/prec/sc_base_$i.json --shard=$i/8 & done; wait
python $P/synth_an.py base
for c in fda ptdb voc; do for nh in 1280:400 1280:160 640:400 640:160; do
  node $P/est-real.mjs --corpus=$c --N=${nh%%:*} --H=${nh##*:} & done; done; wait
for c in fda ptdb voc; do python $P/praat_corp.py $c & done; wait
python $P/er_an.py base
python $P/steady_real.py base --sets=voc
python $P/steady_sess.py base --minref=0.6 --json=build/prec/sess2_TAG.json; python $P/steady_sess.py base --minref=0.9
# variants: trees, real-chain dumps + guards, comparison, CPU
for v in "sinc sinc" "sub40 sub40" "m1 m1"; do python $P/variants.py $v; done
for v in sinc sub40 m1; do sh scripts/session-oracle/lowband/run_variant.sh $v build/prec/trees/$v/src; done
PITCH_BENCH_DIR=build/pb python scripts/session-oracle/lowband/table.py base sinc sub40 m1
python $P/prec_cmp.py base sinc sub40; PAINT_LAG=0.005 python $P/prec_cmp.py m1
node $P/cpu-micro.mjs
```
