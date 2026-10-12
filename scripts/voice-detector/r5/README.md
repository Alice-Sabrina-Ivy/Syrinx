# Custom voice detector — round 5 (2026-10-12)

Pre-registration:
[measurements/voice-detector-round5-preregistration-2026-10-12.md](../../../measurements/voice-detector-round5-preregistration-2026-10-12.md)
(Addenda R5-A, R5-B). Round 5 keeps round 4's sealed set (re-sealed blind
after the trills ruling), its validation data and its bar, and adds practice-bar
rows for low male humming next to machines (H1) and long holds (H2). Outputs
live under `build/vad-train/r5/` (gitignored). The private session recordings
are not read by any script here.

| file | what |
|---|---|
| `trills_r5.py` | §1 / Addendum R5-A: `drop` (the Volta clip, blind), `people` (the extended new-people list), `ds-scan` / `ds-cands` / `ds`, `ia` (round 4's `r4/trills.py` sources 3 and 4 with the extended list), `prepare`, `count` (aggregate trills-row count) |
| `vsynth_val.py` | §2.1: the VALIDATION-ONLY voice synthesizer (the round-1 / round-4 reviews' `vsynth.py` / `vsynth2.py`, ported unchanged) |
| `vbeds.py` | §2.1: the VALIDATION-ONLY synthetic machine beds (the round-3 / round-4 reviews' `beds.py` / `beds4.py`, ported unchanged) |
| `hval.py` | §2.2–2.5: `beds` (real val beds: machine topic + round 4's D2 steadiness), `voices` (Coswara / SVD val voices, gated Praat reference, H1 lists, H2 series), `build` (H1 / H2 streams, specs for `train/valdump.mjs`), `counts [--grow]` (CORRECT hops per cell / bin and sex from the current-app dumps; synthetic growth), `hash` (`r5/sel/inputs.sha256`) |
| `d7.py` | §3.3 D7a: real held-phonation series for training (training-split Coswara / SVD / DCS / ESMUC records, sex-balanced) |
| `../train/vsynth_r5.py` | §3.3 D7b: the TRAINING synthesizer (Rosenberg-type source, drawn tracts; not the validation one); `pack` -> `vsynth_r5_train.i16` / `.npz` |
| `selftest_r5.py` | no training script imports the validation generators or names `r5/hval`; the ported generators match the review files' digests; the training synthesizer refuses validation seeds; the topic rule's word boundaries |
| `../r3/seal.py --tag=r5` | §1.3: the re-seal (`seal-confirmatory-r5.sha256`, `seal-r5.json`, `seal-r5-changes.json` against round 4), `verify --tag=r5`, `verify-r4 --tag=r5`, `verify-r3 --tag=r5` |

```bash
# data step A' (the sealed side; Addendum R5-A)
python scripts/voice-detector/r5/trills_r5.py drop && python scripts/voice-detector/r5/trills_r5.py people && python scripts/voice-detector/r5/trills_r5.py count
python scripts/voice-detector/r5/trills_r5.py ds-scan && python scripts/voice-detector/r5/trills_r5.py ds-cands && python scripts/voice-detector/r5/trills_r5.py count
python scripts/voice-detector/r5/trills_r5.py ia && python scripts/voice-detector/r5/trills_r5.py count
python scripts/voice-detector/r4/audit_exclusions.py
python scripts/voice-detector/r3/seal.py seal --tag=r5 && python scripts/voice-detector/r3/seal.py verify --tag=r5 && python scripts/voice-detector/r3/seal.py verify-r4 --tag=r5 && python scripts/voice-detector/r3/seal.py verify-r3 --tag=r5
(cd scripts/voice-detector/r3 && python train_side.py build && python train_side.py check)
# data step V (the validation side; Addendum R5-B part 1)
python scripts/voice-detector/r5/hval.py beds && python scripts/voice-detector/r5/hval.py voices && python scripts/voice-detector/r5/hval.py build
ROOT=build/vad-train/r5/hval bash scripts/voice-detector/r3/run-dumps.sh h1:2 h2:2
python scripts/voice-detector/r5/hval.py counts --grow    # repeat build + dumps + counts until no synthetic cell is under 400
python scripts/voice-detector/r5/hval.py hash
# data step B (the training side; Addendum R5-B part 2)
python scripts/voice-detector/r5/d7.py lists
(cd scripts/voice-detector/train && python vsynth_r5.py pack --n=2000)
python scripts/voice-detector/r5/selftest_r5.py
```
