# Custom voice detector — round 6, shared data code (2026-10-13)

Pre-registration:
[measurements/voice-detector-round6-preregistration-2026-10-13.md](../../../measurements/voice-detector-round6-preregistration-2026-10-13.md);
what the Data step built:
[Addendum R6-A](../../../measurements/voice-detector-round6-addendum-a-2026-10-13.md).
Round 6 keeps round 5's sealed set, validation data and bar, and adds the
gating rows H4–H8 (§2.4–2.8) built here. Outputs live under
`build/vad-train/r6/` (gitignored). The private session recordings are not
read by any script here. No model runs here.

Every round-6 pre-registration, addendum, data manifest, freeze and result
file is hashed into the round-6 hash log (outside the repository) with
`hashlog.py` when it is written; a hashed file is never edited.

| file | what |
|---|---|
| `hashlog.py` | appends `<time> <tag> <path> <sha256>` lines to the round-6 hash log |
| `disjoint_r6.py` | §1.2 items 4 and 5: the training lists round 6 starts from; new validation material (fsnew, the review sessions' VocalSet takes and real beds) against `exclude.json`, `train_exclude.json`, `r4/d1.json`, the earlier-audio fingerprints and the sealed matcher (keep / drop only) |
| `lfsynth_val.py`, `mach5_val.py`, `micsim_val.py` | the round-5 voice-safety review's LF-model synthesizer, machine beds and microphone / AGC models, ported unchanged (VALIDATION ONLY) |
| `probes5_val.py` | the review's screens S1, S1b, S2, S2b, S3, S4 (`specs()` / `make()` of its screen5.py, ported unchanged) |
| `sess5_val.py`, `sess3_val.py` | the round-5 review's `sess5` and the round-3 review's one-room VocalSet sessions, ported unchanged (re-rendered bit-exact) |
| `hval6.py` | `beds`, `build --set=…` (H4, H5, H6a, H6b, H6c, H8 and the probe screens), `probes --set=sess5` / `--set=sess3` (specs + masks), `specs`, `counts [--grow]`, `hash` (`build/vad-train/r6/sel/inputs.sha256`) |
| `hcells.py` | the gating cells, bins and sub-bands of H4–H8 and the probe streams (fixed before any model scores them), the size rules |
| `portcheck_r6.py`, `sesscheck_r6.py` | the ported generators and the re-rendered review probes / sessions against the review files, bit for bit |
| `selftest_r6.py` | no training script imports a validation generator or names a validation folder; the ported generators' digests; seed ranges; the buzz / topic rules; the bin merge rule |

```bash
PY="build/vad-train/venv/Scripts/python.exe -I"
# §1.2 checks (blind, before any round-6 data): seals, exclusion audit, training side, items 4-5
(cd scripts/voice-detector/r3 && python seal.py verify --tag=r5 && python seal.py verify-r4 --tag=r5 && python seal.py verify-r3 --tag=r5)
python scripts/voice-detector/r4/audit_exclusions.py --selftest && python scripts/voice-detector/r4/audit_exclusions.py
(cd scripts/voice-detector/r3 && python train_side.py build && python train_side.py check)
$PY scripts/voice-detector/r6/disjoint_r6.py
# the rows
$PY scripts/voice-detector/r6/sess5_val.py && $PY scripts/voice-detector/r6/sess3_val.py
$PY scripts/voice-detector/r6/portcheck_r6.py all && $PY scripts/voice-detector/r6/sesscheck_r6.py
$PY scripts/voice-detector/r6/hval6.py beds
for i in 0 1 2; do (for s in h4 h5 h6a h6b h6c h8 s1 s1b s2 s2b s3 s4; do $PY scripts/voice-detector/r6/hval6.py build --set=$s --shard=$i/3; done) & done; wait
$PY scripts/voice-detector/r6/hval6.py specs && $PY scripts/voice-detector/r6/hval6.py probes --set=sess5 && $PY scripts/voice-detector/r6/hval6.py probes --set=sess3
ROOT=build/vad-train/r6/hval MAXJ=3 bash scripts/voice-detector/r3/run-dumps.sh h4:3 h5:3 h6a:3 h6b:3 h6c:3 h8:3 sess5:3 sess3:3 s1:3 s1b:3 s2:3 s2b:3 s3:3 s4:3
$PY scripts/voice-detector/r6/hval6.py counts --grow   # repeat build + specs + dumps + counts until no synthetic cell is under 400
$PY scripts/voice-detector/r6/hval6.py hash
$PY scripts/voice-detector/r6/selftest_r6.py
```
