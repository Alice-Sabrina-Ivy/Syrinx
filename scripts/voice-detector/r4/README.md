# Custom voice detector — round 4 (2026-10-11)

Pre-registration:
[measurements/voice-detector-round4-preregistration-2026-10-11.md](../../../measurements/voice-detector-round4-preregistration-2026-10-11.md).
Round 4 keeps round 3's sealed confirmatory set (`../r3/`), its validation
data and its bar, and targets steady machine noise (hums, fans, fridges).
Outputs live under `build/vad-train/r4/` (gitignored). The private session
recordings are not read by any script here.

| file | what |
|---|---|
| `audit_exclusions.py` | §1 of the pre-registration: the exclusion audit with every uploader / group comparison case-insensitive (`common.fold_user`), over the sealed set (metadata only), the rounds 1–2 manifests, the train / val split by uploader, and the old uploader rules; `--selftest` is the unit check (`fold_user`, `train_side.touches` / `filter_records`, and a static check that no exclusion script compares raw uploader names) |
| `repair_conf.py` | §2.1: `search` re-runs round 3's Freesound search with the corrected comparisons over the cached pages only; `drop` drops every kept record the audit flags and re-runs round 3's selection for the freed slots; `affected` lists the mixes / sessions that use a dropped record |
| `sealfp.py` | fingerprints of the sealed set (kept records' 16 kHz audio), stored inside `r3/conf/fp-r4/`; only a matcher's keep / drop leaves it (§2.2 duplicates, D3) |
| `trills.py` | §2.2 real trills: `calibrate` (θ on VocalSet; the screen is dropped if > 20 % of straight files pass), the sources in order `fs`, `wc`, `ds-scan` / `ds`, `ia`, then `prepare --source=…` and `count` (current-app CORRECT hops of the trills / other-SOVT rows, aggregate only) after each source (stop rule ≥ 800) |
| `fetch_fsr4.py` | D3: new CC0 / CC BY Freesound steady-noise negatives (`search`, `select`, `manifest`) -> `build/vad-train/r4/data/` (the rounds 1-3 manifests are not touched) |
| `train_side_r4.py` | D1 (`d1`: the corrected training lists, the 203 shared-uploader training records removed) and D2 (`d2`: S_stat, census labels, the steady pool `stat`) |
| `d6.py` | D6: `specs` (the `stat` pool + fsr4 training clips, FNV order, <= 40 h) for the current app's dumps (`ROOT=build/vad-train/r4/d6 run-dumps.sh tneg4:2`), `masks` (model frames the app paints falsely, td rule) |
| `../train/synth_r4.py` | D4: the steady synthetic interferer families, training seeds [2e9, 3e9); `pack` writes `synth_r4_train.*` |
| `../r3/seal.py --tag=r4` | §2.3: the re-seal (`seal-confirmatory-r4.sha256`, `seal-r4.json`, `conf-manifest.jsonl`, `seal-r4-changes.json`); `verify --tag=r4`, `verify-r3` |

```bash
python scripts/voice-detector/r4/audit_exclusions.py --selftest
python scripts/voice-detector/r4/audit_exclusions.py      # -> build/vad-train/r4/audit-exclusions.json
# data step A (the sealed side)
python scripts/voice-detector/r4/repair_conf.py search && python scripts/voice-detector/r4/repair_conf.py drop && python scripts/voice-detector/r4/repair_conf.py affected
python scripts/voice-detector/r4/sealfp.py build --jobs=2
python scripts/voice-detector/r4/trills.py calibrate
python scripts/voice-detector/r4/trills.py fs && python scripts/voice-detector/r4/trills.py prepare --source=c_tr4_fs && python scripts/voice-detector/r4/trills.py count
python scripts/voice-detector/r4/trills.py wc && python scripts/voice-detector/r4/trills.py prepare --source=c_tr4_wc && python scripts/voice-detector/r4/trills.py count   # >= 800: stop
python scripts/voice-detector/r3/seal.py seal --tag=r4 && python scripts/voice-detector/r3/train_side.py build && python scripts/voice-detector/r3/train_side.py check
# data step B (the training side)
python scripts/voice-detector/r4/fetch_fsr4.py search && python scripts/voice-detector/r4/fetch_fsr4.py select
python scripts/voice-detector/r4/train_side_r4.py d1 && python scripts/voice-detector/r4/train_side_r4.py d2 --jobs=2
python scripts/voice-detector/train/synth_r4.py pack --n=2000
python scripts/voice-detector/r4/d6.py specs && ROOT=build/vad-train/r4/d6 bash scripts/voice-detector/r3/run-dumps.sh tneg4:2 && python scripts/voice-detector/r4/d6.py masks
```
