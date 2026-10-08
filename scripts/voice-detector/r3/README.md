# Custom voice detector — round 3 data step (2026-10-07)

Pre-registration:
[measurements/voice-detector-round3-preregistration-2026-10-07.md](../../../measurements/voice-detector-round3-preregistration-2026-10-07.md)
(its data addendum records what these scripts produced). Everything here
selects data by fixed rules; nobody listens to, plots or scores a
confirmatory clip before the look. Downloads, prepared audio, references,
dumps and fingerprints live under `build/vad-train/r3/` (gitignored); only the
seal (`seal-confirmatory.sha256`, `seal.json`) and the per-file manifest with
licences (`conf-manifest.jsonl`) are committed. The private session
recordings are not read by any script here.

| file | what |
|---|---|
| `c3.py` | `anon()` (Wikimedia Commons contributors appear in ids and the committed manifest only as a hash of their key), paths (`r3/conf` = the sealed set, `r3/vsess` = validation sessions, `r3/fp` = fingerprints), `guard_not_conf()` (training / validation / selection refuse sealed paths), the confirmatory manifest |
| `exclude.py` | §1.1 exclusion list (`r3/exclude.json`): every Freesound id / uploader and speaker group of rounds 1–2 (manifests, kept and dropped; download indexes), the benchmark's public voice and noise manifests + ESC-50 source ids, Coswara held-out dates, the review probes (splits.json + review scratch directories) |
| `fpindex.py` | Haitsma-Kalker fingerprints of every earlier clip (172 h: rounds 1–2 data, benchmark voice + noise, review probe audio) and the round-3 matcher (≥ 3 s aligned overlap, BER ≤ 0.35) |
| `fetch_conf.py` | downloads (licence read at the source): SingBAP intermediate, LibriSpeech train-clean-100 (48 speakers), GTSinger EN + FR, Jingju part 2, MTG-QBH, Acoustics Australia vowels, PLOS ONE vocal-fry audio and IPA trills (Wikimedia Commons), DCASE 2023 / 2024 T2 additional, AVQ drones, AID |
| `fs_conf.py` | Freesound voice (`c_fsv`) and machine / room noise (group NA): `search` (pre-registered queries and pages, cheap rules), `select` (global FNV order of the id, query caps, ≤ 2 clips per uploader, sound-page licence and keyword rules, YAMNet voice screen / Praat-voiced ≥ 1 s or Silero speech screen, fingerprint check; a match bans the uploader); `--fallback=trills,na` |
| `screen_conf.py` | the duplicate check of every kept non-Freesound confirmatory clip against the earlier audio (a match drops the clip and its whole group) |
| `prepare_conf.py` | native-rate and 16 kHz files, the gated Praat AC reference (60–1100 Hz, frames within 30 dB of the 95th-percentile voiced level), manifest records with subset, group, gender and licence |
| `sessions.py` | the one-room carried sessions of §2 (300 s, 30 s lead, episodes, pause distribution, constraints, levels, SNR) |
| `build_conf.py` | confirmatory streams: `cvoice` (clean, native rate), `cneg` (NA + NB), `cmix20` / `cmix0` (2 programs per noise stream, +10 / 0 dB), `csess` (≤ 160 one-room sessions) |
| `build_vsess.py` | validation-side one-room sessions (240, from the rounds 1–2 validation split only) |
| `run-dumps.sh` | the current app's production chain (`train/valdump.mjs`) over a stream set, ≤ 2 processes |
| `seal.py` | `counts` (the aggregate current-app counts §1.6 allows before the look), `seal` (sha256 of every confirmatory file + `exclude.json`), `verify` (re-hash at the look) |
| `train_side.py` | the training side's exclusion of every confirmatory source / group / uploader / Freesound id (`r3/train_exclude.json`), `filter_records()`, and a check that the rounds 1–2 manifests are disjoint from it |

```bash
export NOTCHVD_ROOT=<checkout>/build/notchvd
python scripts/voice-detector/r3/exclude.py --scratch="<review scratch dirs>"
python scripts/voice-detector/r3/fpindex.py build --probes="<review probe audio dirs>" --jobs=2
python scripts/voice-detector/r3/fetch_conf.py --what=sbi,ls,fry,ipa,aa,qbh,nb,jj,gts
python scripts/voice-detector/r3/fs_conf.py search && python scripts/voice-detector/r3/fs_conf.py select
python scripts/voice-detector/r3/prepare_conf.py --sources=fry,ipa,aa,qbh,nb,ls,sbi,jj,gts,fsv,na
python scripts/voice-detector/r3/screen_conf.py
python scripts/voice-detector/r3/build_conf.py base
ROOT=build/vad-train/r3/conf bash scripts/voice-detector/r3/run-dumps.sh cvoice:2 cneg:1
python scripts/voice-detector/r3/seal.py counts          # minimum-size rules (§1.3, §1.4); fallbacks once
python scripts/voice-detector/r3/build_conf.py mix && python scripts/voice-detector/r3/build_conf.py sess
ROOT=build/vad-train/r3/conf bash scripts/voice-detector/r3/run-dumps.sh cmix20:2 cmix0:2 csess:2
python scripts/voice-detector/r3/seal.py seal            # then commit + push the seal before any training
python scripts/voice-detector/r3/build_vsess.py
ROOT=build/vad-train/r3/vsess bash scripts/voice-detector/r3/run-dumps.sh vsess:2
python scripts/voice-detector/r3/train_side.py build && python scripts/voice-detector/r3/train_side.py check
```
