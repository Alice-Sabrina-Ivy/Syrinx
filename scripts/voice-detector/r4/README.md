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

```bash
python scripts/voice-detector/r4/audit_exclusions.py --selftest
python scripts/voice-detector/r4/audit_exclusions.py      # -> build/vad-train/r4/audit-exclusions.json
```
