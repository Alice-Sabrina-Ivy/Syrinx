# Off-the-shelf screen, Stage A: plan and score adapter (2026-10-20)

> Copied on 2026-10-21 from branch `voice-detector` (commit 852485e) into
> `cue-strip`, where the voice gate it led to was merged. Unchanged below this
> box except that references to scripts and notes that stay on
> `voice-detector` (everything under `scripts/voice-detector/`, the
> `voice-detector-*-2026-10-06.md` notes) say "on branch `voice-detector`".
> The `build/vad*/` data paths are local, gitignored data of that branch's
> worktree. Public data only; the sealed set and the private session
> recordings were not read.

Branch `voice-detector`. User decision 2026-10-20: before choosing between a
custom round 7 and stopping the detector work, run a cheap screen of
ready-made tools. This note fixes the screen **before any candidate score
exists**, and records the score adapter that the screen uses, checked on the
2026-10-06 candidates.

- The bar and harness this screen borrows from:
  `voice-detector-benchmark-2026-10-06.md` (on branch `voice-detector`),
  `voice-detector-harness-2026-10-06.md` (on branch `voice-detector`),
  `scripts/voice-detector/README.md` (on branch `voice-detector`).
- Tools: `scripts/voice-detector/offtheshelf/` (on branch `voice-detector`).
- `src/` is not changed. The baseline is the branch's `src`, identical to
  dd92037 (main + V19g), the tree every current-app dump here was made with.
- Public data only. The sealed set (`build/vad-train/r3/conf`) and the private
  session recordings are not read.

**This is a screen, not the 2026-10-06 verdict.** 2,590 of the 4,305 old
test streams have no audio on disk (held notes, sustained vowels, all
voice-in-noise mixes, held-out B). The screen therefore uses substitute
held-voice rows from the custom rounds. A candidate that survives earns
Stage B, nothing more.

**Outcome (2026-10-20): no candidate survives; the off-the-shelf route is
closed.** The best detector removes 5.6 % of the false pitch line at a setting
that keeps held voices (bar: 60 %), and the GTCRN filter, placed before the
notch, adds more false paint than it removes. Details:
[Results](#results-2026-10-20). A read-only review found no HIGH issue; its
five findings are applied below and change no verdict
([Review applied](#review-applied-2026-10-20)).

**Addendum (2026-10-20, post hoc, information only; the verdict stands):**
if held notes and sustained vowels may be blanked everywhere (also inside the
noise mixes, the "h" reading), FireRedVAD removes about **80 %** of the
tuning-194 false line (w5, p ≥ 0.55, 2 s hangover). That figure is stable when
the tuning data are resampled (median about 78 %, ≥ 60 % in every draw). If
held voices inside the mixes still count (R2, 0 dB mixes allowed 10 %), it
removes 70 %, a marginal result (median 62 %, ≥ 60 % in only 60–66 % of
draws). Normal speech loses at most 0.99 % in its worst row (children's
speech, women). **Tuning data only:** best of a grid, scored on the clips it
was picked on, with no held-out check. Details:
[Addendum](#addendum-relaxed-rules-post-hoc-information-only-2026-10-20).

## Plan (pre-registered, 2026-10-20)

### 1. Candidates and their per-frame causal score

Each runner writes one raw score per native frame (higher = more voice) and
declares when each frame is available. All five meet V3 (frame + look-ahead
<= 100 ms) on paper; a runner that finds otherwise records it, and that
candidate cannot survive.

| name | tool (source to be recorded, §11) | score per frame | input | native hop | first available (frame i) | frame + look-ahead (V3) | V4 on paper |
|---|---|---|---|---|---|---|---|
| `firered` | FireRedVAD Stream-VAD, official ONNX with cache (`fireredvad_stream_vad_with_cache.onnx`), Apache-2.0 | voice probability (speech + singing), raw, before its own smoothing | 16 kHz; our own 80-band Kaldi fbank (25 ms / 10 ms, the model's CMVN), parity-checked against the official front end | 10 ms | 25 + 10 i ms | 25 + 0 ms | pass (2.3 MB) |
| `gtcrn` | GTCRN streaming model (`gtcrn.onnx`, DNS3 checkpoint, with caches), MIT | share of the 93.75–1000 Hz energy it keeps: Σ\|Y\|² / Σ\|X\|² over 512-point STFT bins 3–32 (0 if the input bins are all zero) | the app's own 16 kHz pitch stream (§2) | 16 ms | 32 + 16 i ms | 32 + 0 ms | pass (0.35 MB) |
| `rnnoise` | RNNoise v0.2 (xiph, BSD-3) through an npm WASM build that is v0.2 (`@jitsi/rnnoise-wasm` 0.2.1 sync build or `@shiguredo/rnnoise-wasm` 2025.1.x; the runner shows it is v0.2) | `vad_prob` returned by `rnnoise_process_frame` | 48 kHz: each stream resampled from its own rate with scipy `resample_poly` (16 kHz x3, 20 kHz x12/5, 44.1 kHz x160/147, 48 kHz as is), scaled to the int16 range, 480-sample frames | 10 ms | 10 + 10 i ms | 20 + 0 ms | pass (1.4 MB weights) |
| `dfn3` | DeepFilterNet 3 (official ONNX release or the `deepfilternet` package, MIT / Apache-2.0); **information only** | local SNR in dB (model range −15…35) | 48 kHz as RNNoise | 10 ms | 40 + 10 i ms (20 ms window + 2 frames look-ahead) | 20 + 20 ms | **fails** (about 11 MB in the browser): reported, never survives |
| `earshot` | Earshot 1.2.x (MIT or Apache-2.0) | speech probability | 16 kHz | 16 ms | 16 + 16 i ms | its receptive field, declared by the runner (<= 48 ms expected) | pass (tiny) |

- 16 kHz models other than GTCRN read `lib/streams.py` `load_audio_16k`
  (scipy polyphase), as the 2026-10-06 runners did.
- **+1 ms** is added to `first_avail_ms` for every stream that is not at
  the model's own rate (scipy's ≤ 0.63 ms look-ahead, as WebRTC on
  2026-10-06; for GTCRN the app resampler's lag of at most one input
  sample).
- Where a runner finds the true dependency is later than the table (e.g.
  DFN3's look-ahead), it declares the smallest availability that passes the
  truncation test (§9) and reports it.
- RNNoise and DFN3 see band-limited audio on 16 kHz sources (no content above
  8 kHz). Many selection rows are 16 kHz (§3), and 26.2 of the old 26.8 h are
  too. The screen reports voice lost per native rate for every candidate,
  as information.
- Silero, WebRTC, YAMNet and TEN were scored on 2026-10-06 and are not re-run.

### 2. The GTCRN filter route

Besides its detector score, GTCRN is tested as a **filter on the pitch path
only**. This is the route the July 2026 notes never tested.

- **Where the filter sits:** inside the pitch worker, after its linear
  resampler to 16 kHz and before the notch. The DSP worker, the readouts and
  the hook keep the raw audio.
- **How, without changing `src/`:**
  1. A new `offtheshelf/fdump.mjs` (= `dump.mjs` / `train/valdump.mjs`) adds
     two options. `--emit16` writes the 16 kHz stream that the app's
     `createStreamingResampler` builds chunk by chunk (imported read-only from
     the src tree). `--pitch16=<dir>` re-runs the real chain. In that run the
     pitch worker is started at 16 kHz and gets, for capture chunk k, the
     filtered samples at the positions the resampler produced for chunk k.
     Everything else is unchanged: the DSP worker and hook get the raw audio,
     the labels come from the same code and references, and the dumps go to
     `build/vad/offtheshelf/gtcrn/fdumps/`.
  2. `scripts/session-oracle/lib/chain.mjs` `runWorkers` gets one optional
     argument (`pitchInput`). Without it the chain runs as before, bit for bit.
- **Plumbing check, before GTCRN runs:** feeding the *unfiltered* emitted
  stream through `--pitch16` must reproduce the base dumps byte for byte.
  This is run on every listed stream whose seeded order key starts with `0`
  (about 1/16).
- **The filter:** causal streaming GTCRN with fresh state per stream. The
  output (overlap-add) is delayed by one window, 512 samples (32 ms), so each
  output sample depends only on input up to its own time. It keeps the
  input's length. The filtered audio is cached under
  `build/vad/offtheshelf/gtcrn/pitch16/`.
- **Scored base vs filtered**, hop by hop, by `fscore.py`:
  - **voice lost (V1-like):** each gating row's base CORRECT hops that are not
    CORRECT after filtering. Hops that became WRONG and hops that became
    unpainted are also reported separately.
  - **net removal (V2-like):** 100 × (F_base − F_filtered) / F_base, where F
    counts the FALSE hops. Newly created false paint counts against the
    filter. "Removed only" and "created" are reported separately.
  - **onset delay:** for each base voice onset, the hops until the filtered
    run first paints in that run. This includes the filter's 32 ms, because
    the delay is in the audio.
- The filter route is one fixed configuration. There is no grid and nothing
  to choose.

### 3. Data: the fixed lists

The lists are built from the current-app dumps alone (`make_lists.py`, no
audio, no candidate) and committed with this plan:

| file | sha256 | content |
|---|---|---|
| `lists/selection.tsv` | `c2e0b939a0ac09f3e5a27d4cd112ad99ceef2b2d0fe3403ef9fd90b91cb2a6c7` | 2,750 streams, 19.96 h, 2,874,239 hops, 8,234 voice onsets |
| `lists/readonce.tsv` | `d55c35ae99c70c8a8a1bf4d564785c86963ede542fce905d30c7cf4c7faad4f5` | the 279 noise clips (tuning 194 + held-out A 85), 3.67 h, 527,806 hops |

**SELECTION** (used to choose each candidate's setting):
- tuning-194 noise clips: all 194, with 79,223 falsely painted hops;
- FDA 100, PTDB-TUG 180, vocadito 40, Hillenbrand 1,116: all streams;
- seeded subsets of the substitute held-voice rows:
  - round-4 validation: `vvoice` per group × sex, `vmix20` / `vmix0` per SNR
    × sex group;
  - round-5 H1 (held vowels and hums, clean and over machine beds) and H2
    (long holds), per condition × sex;
  - round-6 H4, per condition × sex.

**Subset rule.** Streams are ordered by sha256(`ots-screen-2026-10-20|<id>`).
Within each cell, streams are taken in that order until the cell has both
≥ 4,000 current-app CORRECT hops of its reading and ≥ 24 streams, or the cell
runs out of streams. H2 cells also need ≥ 1,000 CORRECT hops in the holds'
last 10 s. `vmix20` and `vmix0` share ids, so they share the order.

The result: substitute rows total 16.7 h (vvoice 3.62, vmix20 2.42, vmix0
1.62, H1 2.73, H2 4.86, H4 1.43). Every gating cell has ≥ 1,914 CORRECT hops
in its worst sex group.

**READ-ONCE** (scored at the chosen point only, once): the 279 clips, which
gives held-out A (85 clips, 43,213 falsely painted hops) and the 279 pooled
(122,436). Held-out B has no audio on disk (0 of 119 streams), so it is not
read in Stage A.

### 4. Readings

Every reading uses `score.py`'s alignment, threshold, hangover and onset
rules, over the base dumps' hop labels.

**Gating rows: share of correctly painted hops vetoed, per sex group** (f, m,
unknown). A group gates only with ≥ 400 CORRECT hops; a row's result is its
worst gating group.

Clean rows, limit **1 %**:

| rows | hops counted |
|---|---|
| FDA, PTDB-TUG, vocadito, Hillenbrand | all CORRECT hops |
| vvoice per group (speech, vowels, singing, clinical, exercises, children) | all CORRECT hops |
| H1 clean | CORRECT hops in the sex's band (men 75–130, women 160–300 Hz), as round 5 |
| H2 clean | all CORRECT hops |
| H2 clean, last 10 s of each hold | CORRECT hops in the hold's last 10 s |

Bed / mix rows, limit **3 %**:

| rows | hops counted |
|---|---|
| vmix20 +10 / 0 dB, vmix0 +10 / 0 dB | all CORRECT hops |
| H1 at +20 / +10 / 0 dB | CORRECT hops in the sex's band |
| H2 at +20 / +10 / 0 dB, and the same three in their last 10 s | as for H2 clean |
| H4 at +10 / 0 dB | band hops, excluding round 6's masked hops |

**Objective:** share of the falsely painted hops on the tuning-194 clips that
the detector vetoes (pooled over hops).

**Reported, not gating:**
- removal per tuning-194 noise class;
- false paint in the mixes' noise-only lead, gaps and tail, and in the H rows'
  noise-only leads;
- voice lost per native rate (16 / 20 / 44.1 / 48 kHz);
- H1 per voice kind and H4 per bed class;
- onset delay: median per sex group, worse group, as `score.py` V3.

### 5. Operating-point grids (`grids.json`, fixed now)

Each candidate is swept over threshold × hangover × smoothing (w):

| candidates | thresholds | smoothing w |
|---|---|---|
| probability scores (`firered`, `rnnoise`, `earshot`) and GTCRN's kept share | 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98 | 1 and 5 for 10 ms models; 1 and 3 for 16 ms models |
| DFN3 local SNR | −15, −12.5, −10, −7.5, −5, −2.5, 0, 2.5, 5, 7.5, 10, 12.5, 15, 20 dB | 1 and 5 |

- **Hangovers (all candidates):** 0, 50, 100, 150, 200, 250, 300, 400, 500,
  750, 1000, 1250, 1500, 2000, 3000 and 5000 ms.
- **Smoothing w** = the trailing mean of the last w native frames (about
  50 ms; w = 5 is FireRedVAD's own default).
- **Hangovers stop at 5 s on purpose.** On 2026-10-06, Silero met V1 only with
  a 45 s latch. A gate that stays open through every pause of a practice
  session removes nothing after speech (10-06 §6), so a pass that needs one
  is not worth Stage B.

### 6. Selection rule

For each candidate, among all grid points where every gating row passes:
1. choose the best tuning-194 removal;
2. break exact ties by the smaller worst row-to-limit ratio, then the shorter
   hangover, then the smaller w, then the higher threshold.

Held-out data is never used to choose. If no point passes, the candidate
stops. Held-out A is then not read, and the least-vetoing point and the best
removal with the limits relaxed to 2 / 5 / 10 % are reported as information,
as on 2026-10-06.

### 7. Survive rule

A detector survives to Stage B only if its chosen point:
- removes **≥ 60 %** of the false paint on tuning-194, **and**
- removes **≥ 50 %** on held-out A, read once,
- and is not DFN3 (V4).

The **filter route** survives only if:
- every gating row passes as "voice lost";
- its net removal is **≥ 60 %** on tuning-194;
- its net removal is **≥ 50 %** on held-out A, read once.

Everything else (the 279 pooled, classes, rooms, onset delays) is reported.
Nothing is chosen after a held-out number is seen.

### 8. What a survive does NOT mean

- It is **not** the pre-registered 2026-10-06 verdict. The substitute rows
  are not VocalSet, PVQD + VOICED, the old mixes or held-out B, and tuning
  194 is selection data.
- **Stage B**, after a new go-ahead, would:
  - rebuild the missing held-note, sustained-vowel, mix and held-out B audio,
    with a byte-parity check;
  - add a held-note check on singing that is not VocalSet, because the
    DNS-trained models may have seen VocalSet;
  - run V1–V4 in full, including the browser WASM CPU bench (`r6/v4bench`);
  - for a filter, run the full pitch regression of CLAUDE.md.
- A survive also says nothing about false paint right after speech (the
  10-06 G3 clause): the noise clips are the cold case.

### 9. Order of work, blinding, checks

Per candidate:
1. Download into `build/vad/offtheshelf/<name>/dl/` and fill the provenance
   row (§11).
2. Run the checks below.
3. Run inference on the **selection** list only.
4. Run `adapt.py` and `screen.py select`.
5. Commit and push the selection record: the pick, its tuning-194 number and
   the gating rows.
6. Only then run the 85 held-out A clips, `adapt.py --lists=readonce` and
   `screen.py readonce`, which refuses to run a second time.
7. Commit and push the result.

The filter route follows the same order with `fscore.py`.

Checks per runner, recorded in `causality.json`:
- **Truncation test** on ≥ 6 listed streams covering every native rate: every
  frame declared available before a random cut must be unchanged (0 expected,
  ≤ 1e-5 allowed).
- **FireRedVAD:** its fbank matches the official front end on ≥ 6 streams.
- **Speed:** CPU time per hour of audio.

At most 2 worker processes per runner. Third-party Python runs with `-I`;
each download stays in its own folder.

### 10. Budget and stop rules

- **Inference:** at most 4 CPU-hours per candidate for the 19.96 h of
  selection audio plus the 1.20 h of held-out A.
- **Over budget:** if a 30-minute pilot on selection streams (no scoring)
  shows the budget would be exceeded, the runner stops and reports. The lists
  are never shrunk afterwards.
- **Filter route:** about 1 CPU-hour of chain re-runs, plus GTCRN.
- **Deviations:** any change to lists, grids, readings or rules is a dated
  addendum, committed before any affected score is computed. Nothing is
  changed after held-out A has been read.

### 11. Provenance (each runner fills its row before its first score)

| name | source URL | version / commit | model file(s): bytes, sha256 | licence file read |
|---|---|---|---|---|
| firered | github.com/FireRedTeam/FireRedVAD, `pretrained_models/onnx_models/` (official export, added by the authors in 71352f2, 2026-03-12); check-only: HF `FireRedTeam/FireRedVAD` `Stream-VAD/model.pth.tar`, and the official front end `kaldi_native_fbank` 1.22.3 + `kaldiio` 2.18.0 wheels (sha256 = PyPI's) | repo commit `c30ec49e8cc69642b0ee65362eba11b9d11c6e54` (2026-05-06), package `fireredvad` 0.0.2 (not installed, not run); HF revision `7990aaccc6b7aec1e527743bd30201f2c4a03b8c` | scored: `fireredvad_stream_vad_with_cache.onnx` 2,306,042 B, sha256 `b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93`; `cmvn.ark` 1,311 B, sha256 `c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473` (= HF `Stream-VAD/cmvn.ark`). Check only: `fireredvad_stream_vad.onnx` 2,298,251 B, sha256 `33779744…`; HF `model.pth.tar` 2,283,513 B, sha256 `ec88a8ae8ac5f004cdbd20c1eac4a9e9d12067c3d51ac5b141afa1f921fb59c9` (loaded with `weights_only=True`) | `LICENSE` at the commit, 11,357 B, sha256 `c71d239d…` = the stock Apache-2.0 text, read in full; no NOTICE file; README and HF card (`license: apache-2.0`) add no terms. Record: `build/vad/offtheshelf/firered/provenance.json` |
| gtcrn | github.com/Xiaobin-Rong/gtcrn, files from raw.githubusercontent.com at the commit (git blob hashes checked against the GitHub tree) | `main` @ 502ebfab64da7c4a9af78dcb9c6ceef1ebb01c73 (2026-08-03); `gtcrn.onnx` last changed in 9202557caa (2024-03-25) | `stream/onnx_models/gtcrn.onnx` 352,084 B, sha256 `f648b02f2d7ff96ebcb0eec2219688a08ed12fe7e3d50f248605a90eba8cad17` (the only file loaded). It was exported from `stream/onnx_models/model_trained_on_dns3.tar` (737,323 B, sha256 `250fa2820ea9947704a62dda8e642ba773a067719c5e4294ad95aeab23f06442`): 111 of its 229 tensors are unchanged in the ONNX file, against 2 of 229 for `checkpoints/model_trained_on_dns3.tar`, which is a different file | `LICENSE` (1,069 B, sha256 `c467165e5860b4a7494ef4a6e2788e4115d95b5b8989bb5f86287089adddf794`), read in full on 2026-10-20: standard MIT, "Copyright (c) 2024 Rong Xiaobin", no added terms |
| rnnoise | npm `@jitsi/rnnoise-wasm` 0.2.1, `registry.npmjs.org/@jitsi/rnnoise-wasm/-/rnnoise-wasm-0.2.1.tgz` (1,436,285 B, sha256 `c80b015b69701699868086a30015e5e680bee41a68df4c8ad2daed8b1bbc1173`; sha512 = the registry's integrity); check only: the official release `github.com/xiph/rnnoise/releases/download/v0.2/rnnoise-0.2.tar.gz` (2,294,308 B, sha256 `90fce4b00b9ff24c08dbfe31b82ffd43bae383d85c5535676d28b0a2b11c0d37`) | wrapper 0.2.1 = github.com/jitsi/rnnoise-wasm `cb529a59a8478fe604e57986fc96afdaecfa6fb7` (its `dist/rnnoise-sync.js` blob = the tarball's); built from xiph/rnnoise `372f7b4b76cde4ca1ec4605353dd17898a99de38` = tag v0.2 (`904a876d…`) + one header-only compile fix; model version `0b50c45` | scored: the WASM module inlined (base64) in `dist/rnnoise-sync.js` (1,933,102 B, sha256 `05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f`, read as text only), decoded 1,440,118 B, sha256 `4f513a50613de74378331237886138eab52fa2650e8b1a41eb587d932d9b8850`, run by our own loader in Node (no package JS executed). All 43 weight arrays (1,398,788 B) of the official v0.2 `src/rnnoise_data.c` (sha256 `dece58ea…`) occur byte for byte in its data section | `COPYING` of the v0.2 release (1,612 B, sha256 `45d37ca1…`, = the v0.2 tag's): BSD-3 (Valin, Amazon 2023, Mozilla, Xiph.Org, Borgerding), read in full, no extra terms; wrapper `LICENSE`: stock Apache-2.0 + an MIT notice (ESTOS, BlueJimp 2013), read in full. Not read: emscripten's runtime licence (MIT / NCSA). Record: `build/vad/offtheshelf/rnnoise/provenance.json`, `verify_v02.json` |
| dfn3 | github.com/Rikorose/DeepFilterNet, `models/DeepFilterNet3_onnx.tar.gz` (official ONNX export; 7,983,136 B, sha256 `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616`), from `github.com/Rikorose/DeepFilterNet/raw/<commit>/models/`; check only: the official front end, PyPI `DeepFilterLib` 0.5.6 wheel `DeepFilterLib-0.5.6-cp311-none-win_amd64.whl` (518,210 B, sha256 `e53fa759448dbee8ad7ad10d3313bbd8ca80e6989542f6971b95693de500cebf` = PyPI's) with `numpy` 1.26.4 (sha256 = PyPI's) in the python.org 3.11.9 embeddable build (sha256 `009d6bf7…`) | repo `main` @ `d375b2d8309e0935d165700c91da9de862a99c31` (2024-10-17, the last upstream commit); model files dated 2023-05-23; libDF / DeepFilterLib 0.5.6 | scored: `tmp/export/enc.onnx` 1,954,042 B, sha256 `7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916` (the only model file the LSNR needs); `config.ini` 2,067 B, sha256 `415eb925d44990d938fb739f514aa3662c1ec0ea836cff044fa1291b82cb4290`. Not used for the score (CPU bench only): `erb_dec.onnx` 3,292,397 B, sha256 `ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895`; `df_dec.onnx` 3,340,803 B, sha256 `23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a` | `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE` and `README.md` at the commit, read in full on 2026-10-20: "Licensed under either of Apache License, Version 2.0 … MIT license … at your option"; `LICENSE-MIT` "Copyright (c) 2021 Hendrik Schröter"; `LICENSE-APACHE` (10,837 B, sha256 `1eaee808…`) = the stock Apache-2.0 text (whitespace-only differences) with the appendix filled in "Copyright 2021 Hendrik Schröter"; README: "All code in this repository is dual-licensed"; the weights sit in the same repository (`models/`); no added terms. Record: `build/vad/offtheshelf/dfn3/provenance.json` |
| earshot | PyPI `earshot` 1.2.2 wheel `earshot-1.2.2-cp38-abi3-win_amd64.whl` (200,331 B, sha256 `9500235e773d9af776deaee5987ec4ef12961aa5c82445ea83ebc1417a9c0421` = PyPI's; the runtime); sdist `earshot-1.2.2.tar.gz` (sha256 `a2aad729…` = PyPI's) and crate `static.crates.io/crates/earshot/earshot-1.2.2.crate` (sha256 `afea6647…` = crates.io's), both read as source; github.com/pykeio/earshot | 1.2.2, tag commit `c400f15bd232dda30a297eec90235bd09066cab7` (crate 2026-08-19) | `src/weights.bin`: 39,940 B, sha256 `27d6a6640685ac694a359cf2d55cca3b10dd70417d15fab82c10bbb2fcafdd19`; identical in the crate, the sdist and the repo at the tag, and embedded byte for byte in the wheel's `_earshot.pyd` (398,848 B, sha256 `e358b7bb7a76f1c0023f76cefff4c2db898f561cdbddfaac85260d0b8c3413b8`) | `LICENSE-MIT` ("Copyright (c) 2025-2026 pyke.io") and `LICENSE-APACHE` (stock Apache-2.0 text) at the tag; dual MIT OR Apache-2.0 (Cargo.toml, pyproject, PyPI, crates.io agree); no extra terms; training data not documented. Record: `build/vad/offtheshelf/earshot/provenance.json` |

## The score adapter and its reproduction check (2026-10-20, before any candidate score)

**What was built** (`scripts/voice-detector/offtheshelf/`, on branch `voice-detector`):

- **`adapt.py`:** puts any candidate's native score files (any hop, any rate)
  onto the 12.5 ms grid that `opselect_r3/r5/r6` read.
  - Output: "file"-rule directories with `net.json` (`frame_ms` = the true
    frame + look-ahead) and a manifest.
  - Each grid file carries `score.py`'s per-hop decision value p_k. The
    frames that opselect's alignment reads for hop k all hold p_k, so the
    readings are exact for any native hop.
  - The adapter re-reads every file it writes through opselect's own
    alignment: exact for `last` and `max`, within 1e-6 for `mean`.
  - A grid file is valid only for the dump it was built from.
  - Use opselect with `--no-spl`: there are no spliced files.
- **`screen.py`:** scores only the listed streams and never aborts on
  unlisted ones. A listed stream without a file stops the run. It implements
  §4–§7 (`select`, `readonce`) and the 10-06 rows (`bench10`).
- **`fscore.py`:** the filter-route scorer of §2.
- **`selftest.py`:** the reproduction check below.

**Reproduction check** (`selftest.py`, 0 mismatches in total):

| check | result |
|---|---|
| `always`, `energy`, WebRTC (m2-f30-w90k1-h1250; 30 ms hop, first frame at 31 ms) on all 4,305 10-06 streams via the 12.5 ms grid, at the candidate's point and 3 more points; WebRTC also at w = 3 | every V1 / V2 row count (109 rows) and all 10,554 onset delays equal `score.py`'s functions: 0 mismatches in 16 point checks |
| the same, against `score.py`'s own `stream_rows()` | WebRTC: V2 279 / tuning / A / B = **13.14 / 11.32 / 16.50 / 12.58 %**; VocalSet f 0.998 %, PVQD + VOICED u 0.33 %. `energy`: V2 75.82 / 75.75 / 75.96 / 78.00 %. `always`: all 0. Identical to 10-06 |
| subset scoring: a seeded synthetic score (10 ms hop, first frame at 26 ms) written only for the 2,835 listed streams, with no file for 6,715 unlisted vvoice / H1 / H2 / H4 streams | selection and read-once readings at 4 points × w 1 / 5 equal `score.py`'s functions: 0 mismatches, nothing aborted |
| `fscore.py` identity (base vs base) | 0 voice lost, 0 created, 0 % removed, 0 ms onset delay |

**Correction (LOW).** The harness note prints `energy` at 0 dB with a 20 s
lead as 68.58 %. `score.py`'s own 10-06 output (`build/vad/scores/baselines.json`)
says 68.598 %, which rounds to 68.60 %. The adapter reproduces the latter;
the note's figure was a rounding slip.

## Results (2026-10-20)

### A. Selection record (committed and pushed before any held-out A read)

**Order and integrity checks**
- The plan commits are 53397cb (16:08:38 −0500) and 669e07a (16:10:00).
  The earliest score file of any candidate is from 16:19:29, and every grid
  file is later still. No `screen/` output existed before this scoring step.
- For every candidate and every smoothing, all 2,750 grid files match the
  sha256 of the score file they were built from (0 mismatches). No grid holds
  a held-out A clip: each grid's noise set is the 194 tuning clips.
- Every `select.json` records the list hashes `c2e0b939…` and `d55c35ae…`.
  sha256 (first 16 hex) of the records: firered `1eb04e2369469b0e`, gtcrn
  `6f50204428764948`, rnnoise `fd250b7246edc95f`, dfn3 `3b327b73d199d38e`,
  earshot `82d1e3f15bd06f4b`, gtcrn-filter `2be551032e91a54e`.

**The chosen points** (selection rule §6; "x of limit" = worst gating group /
row limit)

| candidate | chosen point | tuning-194 removed | worst gating row at the pick | best removal with V1 relaxed to 2 / 5 / 10 % | cheapest point that removes ≥ 60 % |
|---|---|---|---|---|---|
| firered | w1, p ≥ 0.01, 1000 ms | **1.83 %** | H4 +10 dB, men 2.60 % (0.87 of limit) | 1.83 / 2.20 / 2.52 % | w1, p ≥ 0.07, 50 ms (60.2 %): H2 +20 dB men 82 % vetoed, 19 rows fail |
| gtcrn (detector) | **none**: no grid point passes | — | least-vetoing point (w1, p ≥ 0.001, 5000 ms, 1.77 %): H2 last 10 s clean, men 12.1 % (12.1 × limit), 10 rows fail | none / none / none | w1, p ≥ 0.05, 1500 ms (62.3 %): H2 last 10 s 0 dB men 72 %, 20 rows fail |
| rnnoise | w1, p ≥ 0.005, 200 ms | **5.61 %** | H2 last 10 s clean, men 0.93 % (0.93) | 6.08 / 7.69 / 15.01 % | w5, p ≥ 0.98, 3000 ms (63.2 %): H2 last 10 s +10 dB men 63 %, 19 rows fail |
| earshot | w1, p ≥ 0.1, 0 ms | **0.79 %** | H2 last 10 s +20 dB, men 0.32 % (0.11) | 0.79 / 1.81 / 2.89 % | w1, p ≥ 0.65, 50 ms (60.1 %): H2 last 10 s clean men 38 %, 24 rows fail |
| dfn3 (information only) | w1, LSNR ≥ −15 dB, 0 ms (= always voice; −15 is the model's floor) | **0.00 %** | 0 | 0 / 0 / 0 % | w5, −7.5 dB, 5000 ms (60.3 %): H2 last 10 s clean women 51 %, 21 rows fail |

Onset delay at every pick: median 0 ms in every sex group.

**"Cheapest" in the last column** (defined 2026-10-20, after review) = among
the points that remove ≥ 60 % on tuning-194, the one with the smallest worst
row-to-limit ratio. Picking instead the point with the fewest failing rows
gives 16–22 failing rows instead of 19–24: firered 16 (e.g. w5, p ≥ 0.4,
5000 ms, 61.0 % removed), gtcrn 19 (w3, p ≥ 0.05, 2000 ms, 64.0 %), rnnoise 19
and dfn3 21 (the same points as in the table), earshot 22 (w3, p ≥ 0.7,
400 ms, 60.3 %). At those points the worst held-voice row still loses
63–99 % of its correct hops, and clean holds lose 11–51 % in their last 10 s,
the same ranges as at the "cheapest" points.

**Gating rows at the pick: worst sex group, % of correct hops vetoed** (the
GTCRN filter column is "voice lost" by `fscore.py`; **bold** = fails)

| row (limit) | firered | rnnoise | earshot | dfn3 | GTCRN filter |
|---|---|---|---|---|---|
| FDA (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **m 25.9** |
| PTDB-TUG (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **m 33.3** |
| vocadito (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **8.1** |
| Hillenbrand (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **m 17.6** |
| vvoice speech (1 %) | 0.00 | u 0.05 | 0.00 | 0.00 | **f 23.7** |
| vvoice vowels (1 %) | 0.00 | m 0.46 | 0.00 | 0.00 | **f 13.4** |
| vvoice singing (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **m 6.5** |
| vvoice clinical (1 %) | 0.00 | m 0.03 | 0.00 | 0.00 | **m 13.2** |
| vvoice exercises (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **u 8.7** |
| vvoice children (1 %) | 0.00 | f 0.71 | 0.00 | 0.00 | **f 36.8** |
| H1 clean (1 %) | 0.00 | 0.00 | 0.00 | 0.00 | **m 17.8** |
| H2 clean (1 %) | 0.00 | m 0.11 | f 0.01 | 0.00 | **m 18.8** |
| H2 clean, last 10 s (1 %) | 0.00 | m 0.93 | f 0.11 | 0.00 | **f 31.0** |
| vmix20 +10 dB (3 %) | 0.00 | u 0.78 | 0.00 | 0.00 | **f 18.6** |
| vmix20 0 dB (3 %) | 0.00 | m 0.13 | u 0.08 | 0.00 | **u 21.1** |
| vmix0 +10 dB (3 %) | 0.00 | u 0.74 | 0.00 | 0.00 | **f 19.5** |
| vmix0 0 dB (3 %) | 0.00 | u 0.29 | 0.00 | 0.00 | **u 26.2** |
| H1 +20 / +10 / 0 dB (3 %) | 0.00 / 0.00 / 0.00 | f 0.05 / f 0.94 / m 0.08 | 0 / 0 / 0 | 0 / 0 / 0 | **m 6.5 / m 17.6 / m 23.1** |
| H2 +20 / +10 / 0 dB (3 %) | m 2.11 / 0.00 / 0.00 | 0.00 / f 0.73 / f 0.98 | m 0.08 / 0 / 0 | 0 / 0 / 0 | **m 21.5 / f 15.1 / f 22.5** |
| H2 last 10 s +20 / +10 / 0 dB (3 %) | m 0.48 / 0.00 / 0.00 | 0.00 / f 2.23 / m 0.51 | m 0.32 / 0 / 0 | 0 / 0 / 0 | **m 41.7 / m 19.2 / m 22.1** |
| H4 +10 / 0 dB (3 %) | m 2.60 / f 0.90 | m 0.70 / m 0.20 | 0 / 0 | 0 / 0 | **m 24.6 / m 23.1** |

(f / m = women / men, u = sex unknown. Every sex group in every row had
≥ 400 correct hops, so every group gated.)

**Tuning-194 removal at the pick, per noise class** (% of falsely painted
hops; the filter column is net removal, new false paint counted against it)

| class | false hops (current app) | firered | rnnoise | earshot | dfn3 | GTCRN filter (net) |
|---|---:|---:|---:|---:|---:|---:|
| all 194 | 79,223 | 1.83 | 5.61 | 0.79 | 0.00 | **−41.2** |
| stationary-tonal | 38,760 | 3.09 | 7.39 | 1.56 | 0.00 | −27.4 |
| mixed | 32,490 | 0.78 | 4.53 | 0.08 | 0.00 | −44.4 |
| broadband | 6,068 | 0.00 | 1.14 | 0.00 | 0.00 | −79.6 |
| intermittent-tonal | 1,905 | 0.00 | 1.84 | 0.00 | 0.00 | −143.8 |

**Reported, not gating (at the pick)**
- Voice lost per native rate is at most 0.49 % (FireRedVAD, 16 kHz streams),
  then RNNoise 0.30 % (16 kHz); every other rate and candidate is ≤ 0.22 %.
- Mixes' noise-only lead / gaps / tail removed: RNNoise 9–13 %, FireRedVAD
  0–4.5 %, Earshot ≤ 0.7 %, DFN3 0 %.
- **Without the held-voice rows:** if H1, H2 and H4 did not gate at all, the
  best tuning-194 removal would be FireRedVAD 35.6 %, RNNoise 30.6 %,
  Earshot 22.8 %, GTCRN 8.0 % and DFN3 0 %. The voice-in-noise mixes at 0 dB
  bind there. So no candidate reaches 60 % even on speech-only rows.

**The GTCRN filter route** (`fscore.py select`; one fixed configuration)
- Voice lost fails all 28 gating rows, 6.5–41.7 % in the worst group.
- Net removal on tuning-194 is **−41.2 %**: it removes 35.4 % of the false
  hops but creates new false paint equal to 76.5 % of them. Every noise class
  gets worse (above).
- Onset delay: median 25 ms in every sex group (p90 50–75 ms); 0.7–2.4 % of
  voice onsets never paint.
- **Checks (information, not pre-registered).** The filtered audio lags the
  unfiltered stream by exactly 512 samples (32 ms, as designed; audio
  cross-correlation on 12 FDA / PTDB / Hillenbrand streams). The filtered
  pitch track matches the base track best at a 1-hop shift, with a median
  difference of 0.04–0.20 semitones, so on clean speech much of the "voice
  lost" is the filter's own 32 ms lag (≥ 5 % pitch error during fast
  glides). Allowing that 1-hop lag still fails 27 of 28 rows: FDA 2.3 %,
  PTDB 5.2 %, Hillenbrand 4.7 %, held-voice rows 5.7–40 %. Only vocadito
  passes (0.73 %). On the H1 / H2 / H4 rows, 40–83 % of the hops that turn
  WRONG are octave-class: men's notes go an octave up, women's an octave down.
- **Where the new false paint sits (information, added 2026-10-20 after
  review).** Mostly on clips the current app already handles well:

  | tuning-194 clips, by the share of hops the current app paints | clips | false hops: current app → filtered |
  |---|---:|---|
  | < 5 % | 75 | 1,272 → 20,853 |
  | 5–30 % | 59 | 16,767 → 33,833 |
  | ≥ 30 % (the worst clips) | 60 | 61,184 → 57,153 |

  Held-out A shows the same pattern (33 clips under 5 %: 541 → 17,261; 29
  clips at ≥ 30 %: 36,598 → 33,017). One held-out A air-conditioner clip goes
  from 17 to 958 painted hops while the filter lowers its level about
  24-fold (RMS). This fits the filter, placed before the notch as planned
  (§2), defeating the notch and the ghost veto; the mechanism was not
  checked. So the result is for GTCRN **placed before the notch**; other
  placements were not tested. The outcome does not change: its removal alone
  (35.4 %) is under the 60 % bar, and it loses voice on every gating row.

**After selection:** no detector reaches 60 % on tuning-194 at a feasible
point. The best is RNNoise at 5.61 %. By the survive rule (§7) none can
survive, whatever held-out A shows. The filter route has already failed V1
and has negative removal. Held-out A is still read once, as the plan orders:
- for firered, rnnoise, earshot and dfn3, at their picks;
- for the filter route.

GTCRN's detector score has no pick, so its held-out A is not read.

### B. Held-out A, read once (after the selection record was pushed, 233b669)

`screen.py readonce` ran once per candidate at its pick and `fscore.py
readonce` once for the filter route. In every case the tuning-194 value
equals the selection record exactly.

| candidate | chosen point | tuning-194 removed | held-out A removed | all 279 | survives |
|---|---|---:|---:|---:|---|
| firered | w1, p ≥ 0.01, 1000 ms | 1.83 % | 2.45 % | 2.05 % | **no** (< 60 % on tuning-194) |
| gtcrn (detector) | none | — | not read | — | **no** (no feasible point) |
| rnnoise | w1, p ≥ 0.005, 200 ms | 5.61 % | 3.72 % | 4.94 % | **no** (< 60 %) |
| earshot | w1, p ≥ 0.1, 0 ms | 0.79 % | 0.31 % | 0.62 % | **no** (< 60 %) |
| dfn3 (information only) | w1, LSNR ≥ −15 dB (always voice) | 0.00 % | 0.00 % | 0.00 % | **no** (< 60 %; fails V4 anyway) |
| GTCRN filter route | one fixed configuration | **−41.2 %** net | **−50.6 %** net (removed 36.7 %, created 87.3 %) | −44.5 % net | **no** (fails all 28 voice-lost rows; net removal negative) |

**The 279 clips per noise class** (tuning-194 and held-out A pooled, %
removed at the pick; filter = net)

| class | false hops | firered | rnnoise | earshot | dfn3 | GTCRN filter |
|---|---:|---:|---:|---:|---:|---:|
| stationary-tonal | 53,683 | 3.88 | 7.83 | 1.33 | 0 | −41.9 |
| mixed | 58,596 | 0.73 | 2.96 | 0.08 | 0 | −35.0 |
| broadband | 7,936 | 0.00 | 0.92 | 0.05 | 0 | −111.8 |
| intermittent-tonal | 2,221 | 0.00 | 1.58 | 0.00 | 0 | −118.5 |

**The worst machine rooms** (the ten with the most false paint, 279 pooled)

| room | false hops | firered | rnnoise | earshot | dfn3 | GTCRN filter |
|---|---:|---:|---:|---:|---:|---:|
| electric fan | 10,299 | 1.56 | 4.64 | 0.17 | 0 | −14.2 |
| mains hum | 8,535 | 10.28 | 3.13 | 0.00 | 0 | +0.5 |
| refrigerator | 7,909 | 0.25 | 2.34 | 0.08 | 0 | −47.8 |
| exhaust fan | 7,708 | 0.00 | 3.23 | 0.00 | 0 | −38.7 |
| HVAC | 6,717 | 0.18 | 0.52 | 0.18 | 0 | −133.7 |
| air conditioner (DCASE) | 5,915 | 0.00 | 0.27 | 0.00 | 0 | −61.2 |
| pump (DCASE) | 4,824 | 0.00 | 5.08 | 0.00 | 0 | −36.9 |
| electronics whine | 4,511 | 0.11 | 3.19 | 0.02 | 0 | −7.8 |
| microwave | 4,417 | 0.00 | 6.93 | 0.00 | 0 | −50.6 |
| hair dryer | 4,229 | 0.00 | 0.24 | 0.00 | 0 | −10.8 |

The highest single-room removals are on small rooms: a 70-hop hallway, a
transformer (FireRedVAD 38.7 %, RNNoise 36.6 %) and DCASE valves (RNNoise
38–74 %). None of them changes the totals.

### C. Was each tool fed audio the way it was designed for?

| candidate | input | what was checked |
|---|---|---|
| firered | 16 kHz, int16-range float, official CMVN, official streaming ONNX with cache; raw probability before its own 5-frame smoothing (the grid's w = 5 covers that smoothing) | our fbank against the official front end + PyTorch model: probabilities within 3.5e-5 on 10 streams; ONNX vs PyTorch within 3e-7; truncation 0 |
| gtcrn | the app's own 16 kHz pitch stream, float, official streaming ONNX with caches | output vs the repo's own `enh.wav` within 3.05e-5 (1 LSB of 16-bit); truncation 0; filtered audio lags by exactly 512 samples |
| rnnoise | 48 kHz, int16 range, 480-sample frames (the library's native format), v0.2 weights confirmed byte for byte | truncation 0 |
| dfn3 | 48 kHz float in [−1, 1], official encoder | our front end vs the official libdf: LSNR within 0.0026 dB; truncation 0 |
| earshot | 16 kHz float through the official `predict_f32` | truncation 0 |

**One setup limit (information, not pre-registered).** All 279 noise clips,
both voice-in-noise mixes and Hillenbrand are 16 kHz at the source. So the
two 48 kHz models (RNNoise, DFN3) see no noise content above 8 kHz. This does
not explain the failure, because the binding rows are the held voices, and
most held-voice audio is full band:
- At points that remove 33–92 % of tuning-194, held voices from 48 kHz sources
  are still vetoed far above the 1–3 % limits: RNNoise 9.2–15.4 %, FireRedVAD
  18–31 %, DFN3 38–49 %, Earshot 11.5 %.
- Held voices from 16 kHz sources are vetoed more: 13–24, 33–48, 89–93 and
  17 %.
- Whether full-band noise clips would be easier to remove was not tested;
  there are none on disk.

**Synthetic held voices (information, added 2026-10-20 after review).** About
half of the held-voice gating rows are synthetic voices, which §3 and §4 did
not say ("held vowels and hums", "long holds").
- In the selection list, 79 of 192 H1 streams, 117 of 192 H2 streams and 58
  of 96 H4 streams are synthetic hums or vowels: 58 %, 60 % and 80 % of the
  correct hops those rows count. Both H2 +20 dB rows (whole hold and last
  10 s) hold synthetic voices only.
- Some tools score them very low. FireRedVAD's median on clean synthetic hums
  is 0.08–0.22 (0.98–0.99 on clean real holds); DFN3 gives synthetic vowels
  its −15 dB floor (median). RNNoise and Earshot do not single them out.
- **Re-check:** selection re-run with `screen.py`'s own evaluator, with only
  real held voices gating the H1 / H2 / H4 rows and synthetic ones moved to
  information. The two H2 +20 dB rows then have no gating group, so 26 rows
  gate. The best tuning-194 removal that passes every row:

  | candidate | best passing point | tuning-194 removed |
  |---|---|---:|
  | firered | w5, p ≥ 0.02, 3000 ms | 3.70 % |
  | rnnoise | w1, p ≥ 0.16, 5000 ms | 7.22 % |
  | earshot | w1, p ≥ 0.3, 5000 ms | 11.92 % |
  | gtcrn (detector) | no passing point | — |
  | dfn3 | always voice | 0.00 % |

  Every candidate stays far below 60 %. Of the points that remove ≥ 60 %,
  the one with the fewest failures still fails 13–20 of the 26 rows. The
  verdict does not change. This re-check is information only: the
  pre-registered picks and §B stand.

### D. Deviations

1. **Held-out A inference before the selection commit** (plan §9 step 6):
   - FireRedVAD ran its 85 held-out A clips early but kept them outside
     `cand/`. They were recomputed after the push, and all 85 are byte-identical
     to the staged copies.
   - DFN3 ran them early into `cand/noise/`. They were not recomputed. Nothing
     adapted or scored them before the push, and DFN3's pick is "always
     voice", so its held-out number is 0 by construction.
2. **GTCRN detector files:** the filter route's held-out A run also wrote
   GTCRN detector score files for those clips. They were never adapted or
   read.
3. **RNNoise held-out A:** one worker stopped with a passing
   `FileNotFoundError` after 84 of 85 clips. A re-run wrote the last clip; its
   audio loads normally.
4. **Speech-corpus audio read from the main checkout** (widened 2026-10-20
   after review; this item first named only the GTCRN chain re-runs). The
   stream records of FDA, PTDB-TUG, vocadito and Hillenbrand point into the
   main checkout's `tests/dsp/data`. So `load_audio` in all five runners and
   the GTCRN chain re-runs read those 1,436 selection streams from there.
   The base dumps, made before this screen, were made from the same files.
   - The reads were read-only. Every runner writes only under
     `build/vad/offtheshelf/`.
   - This worktree has no FDA or PTDB-TUG audio (gitignored corpora). Its
     vocadito and Hillenbrand files are tracked copies, but the records point
     at the main checkout's.
   - The noise clips, the mixes and the H rows were read from this worktree.
   - The house rule says not to touch the main checkout. Whether these reads
     are accepted is the user's call. Re-reading from a local copy was not
     done; it would need new byte-parity checks.
5. **Earshot:** frame + look-ahead is 80 ms, not the ≤ 48 ms expected in §1.
   This is still inside V3. Its scores never go below 0.0568, so grid
   thresholds 0.001–0.05 all mean "always voice".
6. **First-available time:** +1 ms was applied to every stream for every
   candidate, because one spec serves all streams. This is 1 ms conservative
   on native-rate streams.
7. **DFN3:** the front-end check limit was raised from 0.001 to 0.01 dB after
   the first comparison measured 0.0026 dB. The tract runtime's two
   shortcuts were left out so the raw model output is scored.
8. **FireRedVAD:** its fbank parity was checked with `kaldi_native_fbank`
   1.22.3; the repo pins 1.15.
9. **Extra numbers:** the lag check, lag-tolerant loss, octave share,
   "without the held-voice rows" and per-rate held-voice vetoes were not
   pre-registered. They are information only and changed no pick or verdict.
   The same holds for the review re-checks added on 2026-10-20 (real-only
   held voices, fewest-fails points, where the filter's false paint sits).
10. **Provenance timing** (added 2026-10-20 after review). Plan §11 asked for
    each provenance row before the runner's first score. The note's rows were
    committed only with the selection record (233b669), after all scoring.
    By file time, FireRedVAD, RNNoise and Earshot wrote `provenance.json`
    before their first score file; GTCRN (18:15 vs 16:24) and DFN3 (16:37 vs
    16:23) wrote it after. Every scored model file was downloaded before the
    first score, and every sha256 on disk matches §11, so no result is
    affected.

**CPU in our runtimes** (not the browser; per 25 ms of audio): FireRedVAD
0.14 ms batched, 1.4–1.6 ms with one call per 25 ms; GTCRN 1.99 ms; RNNoise
1.21 ms (Node WebAssembly); DFN3 encoder 0.48 ms (full filter 2.19 ms);
Earshot 0.015 ms. Every candidate stayed far inside the 4 CPU-hour budget.

### E. Verdict

**No candidate survives, so the off-the-shelf route is closed.**
- No detector removes more than 5.6 % of the false pitch line on tuning-194
  while keeping the held-voice rows. The 60 % bar is out of reach for all of
  them.
- Even if the held-voice rows did not gate, the best would be 36 %
  (FireRedVAD).
- At the least costly point that removes ≥ 60 % (the smallest worst
  row-to-limit ratio, §A), each tool fails 19–24 of the 28 gating rows; at
  the point with the fewest failing rows, 16–22. Either way its worst
  held-voice row loses 63–99 % of correct hops, and even clean holds lose
  11–51 % in their last 10 s. All five tools treat a steady held voice like
  steady noise, as the desk research expected.
- With only real held voices gating (about half of the held-voice rows are
  synthetic, §C), the best is 11.9 % (Earshot).
- The GTCRN filter, placed before the notch, is worse than doing nothing on
  the noise clips: net removal is −41 % on tuning-194 and −51 % on held-out
  A. The new false paint is mostly on clips the current app already handles
  (§A); its removal alone is 35 %, under the bar too. It also breaks
  6.5–42 % of correct hops.

**Stage B:** not started; no candidate earned it. Re-opening this route would
need, at the least:
- full-band noise clips (all of today's noise clips are 16 kHz);
- the rebuilt VocalSet / PVQD / VOICED / mix / held-out B audio;
- a non-VocalSet singing check;
- the browser CPU bench;
- the after-speech (G3) case.

Nothing in this screen suggests that would change the outcome. The choice
between a custom round 7 and stopping the detector work is the user's.

## Review applied (2026-10-20)

A read-only review re-checked the order, the lists, the adapter, the front
ends, the GTCRN filter plumbing, the records and the numbers (its own replays
match the note). It found no HIGH issue. Its five findings were each checked
before being applied; none was rejected and none changes a pick or a verdict,
so nothing was re-scored and the plan is unchanged.

| finding | checked | applied in |
|---|---|---|
| MEDIUM: about half the held-voice rows are synthetic voices, not said | stream counts and the real-only re-selection reproduced exactly | §C (new paragraph), §E |
| LOW: "the filter makes things worse" lacked its condition | per-clip counts reproduced exactly | Outcome, §A (new bullet), §E |
| LOW: "least costly point" undefined | both definitions recomputed from the selection records | §A (definition), §E |
| LOW: D4 named only GTCRN, but every runner read the speech corpora from the main checkout | the stream records and the runners' write paths | §D item 4 |
| LOW: provenance not recorded before the first score for every runner | file times and model sha256 on disk | §D item 10 |

## Addendum: relaxed rules (post hoc, information only, 2026-10-20)

User question, 2026-10-20: "what if we accept filtering sustained notes /
vowels for now? would it be good enough then?"

**What this is.** A re-score of the selection data under relaxed gating
rules. It is post hoc and information only: nothing is picked, and the
pre-registered verdict above stands (Stage A closed). Only the tuning-194
clips are read. Held-out A was already read once per candidate, at its
pre-registered pick, so it is not read again. Every number below is
therefore the best point of a grid on the same clips it is scored on. It is
optimistic, and no held-out check of it exists.

**Candidates**
- The screen's five, from their existing score files.
- **Silero VAD v6.2.3**, with the 2026-10-06 runner and settings, run on the
  2,750 selection streams (`offtheshelf/silero/run_silero_sel.py`):
  - 16 kHz, 512-sample chunks with 64 samples of context, fresh state per
    stream;
  - frame 36 ms + look-ahead 0, first frame available at 33 ms;
  - the 1,630 selection streams that the 10-06 run also scored are
    byte-identical to its files.
  - Grid: the screen's probability thresholds plus 0.0001 / 0.0002 / 0.0005,
    smoothing w 1 / 2 (32 / 64 ms), the screen's 16 hangovers. The grid
    point nearest its defaults is p 0.5 with a 100 ms hangover
    (`min_silence_duration_ms`) and no hysteresis. Silero's own streaming
    iterator also ends speech only below p 0.35; the grid does not model
    that, so this point is not exactly Silero's default behaviour.
- **WebRTC VAD**, with the 10-06 runner and wheel on the same streams
  (`offtheshelf/webrtc/run_webrtc_sel.py`):
  - modes 0–3 × 10 / 20 / 30 ms frames × last / max / "k of the last w
    frames" (30–100 ms windows, as on 10-06), the screen's 16 hangovers;
  - the 1,630 overlapping streams give decisions identical to the 10-06
    cache.

**Rules.** "Held rows" are H1, H2 (with its last-10-s rows), H4 and the two
clean sustained-vowel rows: vvoice "vowels" (Coswara) and vvoice "clinical"
(Saarbrücken).

| rule | held rows | other rows | 0 dB mix rows | onset delay (V3) |
|---|---|---|---|---|
| R1 | do not gate | as pre-registered: clean ≤ 1 %, mixes ≤ 3 %, per sex, groups ≥ 400 hops | ≤ 3 % | median ≤ 100 ms in every sex group, over the voice onsets of the gating streams |
| R2 | do not gate | as R1 | ≤ 10 % (curve: 3 / 5 / 10 / 20 % / no limit) | as R1 |
| R3 | as R1 / R2 | as R1 / R2 | as R1 / R2 | not required |
| "h" (sensitivity, not asked for) | as R1 / R2 | the mix rows count only mixes whose voice is speech, children or singing; the mixes' held voices (held vowels, Saarbrücken vowels, exercise holds) do not count | as R1 / R2 | as R1 |

- **Evaluator:** `common.Block.evaluate` (= `score.py`) and `screen.py`'s
  per-hop reading. Silero went through `adapt.py`. WebRTC's per-hop values
  are built in memory the same way; on RNNoise w5 the in-memory values match
  the grid files on all 2,874,239 hops.
- **Reproduction:**
  - the pre-registered rule gives each pick again (1.83 / 5.61 / 0.79 % /
    none / 0.00 %);
  - "without the held-voice rows" gives 35.6 / 30.6 / 22.8 / 8.0 / 0 % again
    (§A; GTCRN is 8.05 %, so 8.0, not 8.1 as §A first printed).
- **Script:** `offtheshelf/relaxed.py` (`eval`, `report`, `point`);
  records under the gitignored `build/vad/offtheshelf/relaxed/`.

### Results: best tuning-194 removal (%)

| candidate | R1 | R2, 0 dB ≤ 5 % | R2, 0 dB ≤ 10 % | R2, ≤ 20 % | R2, no limit | R3 (no V3) | R1 h | R2 h, 0 dB ≤ 10 % / no limit |
|---|---:|---:|---:|---:|---:|---|---:|---|
| firered | 35.6 | 58.3 | **70.2** | 70.2 | 70.2 | = R1 / R2 | 79.8 | 80.1 / 80.1 |
| rnnoise | 30.6 | 36.4 | 36.4 | 36.4 | 36.4 | = R1 / R2 | 41.9 | 41.9 / 41.9 |
| earshot | 22.8 | 27.8 | 36.1 | 36.1 | 36.1 | = R1 / R2 | 36.1 | 36.1 / 36.1 |
| gtcrn (detector) | 8.0 | 13.6 | 37.8 | 37.8 | 37.8 | = R1 / R2 | 30.0 | 60.8 / 76.6 |
| dfn3 (fails V4) | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | = R1 / R2 | 0.0 | 0.0 / 0.0 |
| silero | none | none | none | none | none | none | none | none / none |
| webrtc | 12.0 | 13.0 | 15.1 | 15.1 | 15.1 | = R1 / R2 | 15.1 | 15.1 / 15.1 |

The points:

| candidate | R1 | R2 (0 dB ≤ 10 %) | R1 h |
|---|---|---|---|
| firered | w1, p ≥ 0.2, 5000 ms | w5, p ≥ 0.55, 5000 ms | w5, p ≥ 0.55, 2000 ms |
| rnnoise | w5, p ≥ 0.5, 2000 ms | w5, p ≥ 0.75, 3000 ms | w1, p ≥ 0.8, 1500 ms |
| earshot | w1, p ≥ 0.4, 5000 ms | w3, p ≥ 0.45, 1000 ms | w3, p ≥ 0.45, 1000 ms |
| gtcrn | w1, ≥ 0.01, 5000 ms | w3, ≥ 0.02, 3000 ms | w1, ≥ 0.02, 3000 ms |
| dfn3 | always voice (LSNR ≥ −15 dB) | always voice | always voice |
| webrtc | mode 1, 20 ms, 5 of 5, 750 ms | mode 2, 20 ms, 5 of 5, 1250 ms | mode 2, 20 ms, 5 of 5, 1250 ms |

**What binds**
- **The onset-delay rule never binds.** R3 equals R1 / R2 for every
  candidate, and the median onset delay is 0 ms in every sex group at every
  best point. The delay is counted from the moment the app starts painting a
  voice, about 120 ms after the voice starts, and that covers the detectors'
  own 20–100 ms.
- **R1:** the 0 dB mixes bind for FireRedVAD, RNNoise, Earshot and GTCRN;
  for WebRTC, the singing exercises (vvoice "exercises").
- **R2:** FireRedVAD passes 60 % only with the grid's longest hangover.
  - 7 of its 290 points that pass R2 remove ≥ 60 % (61.0–70.2 %), all at
    5000 ms, p 0.4–0.6.
  - Shorter hangovers fail the +10 dB mix rows, because they blank the
    held voices inside those mixes.
  - RNNoise and Earshot are then held back by children's speech (vvoice
    "children", 1 %), the singing exercises and the +10 dB mixes; GTCRN by
    the +10 dB mixes.
- **h:** FireRedVAD has 97 points ≥ 60 % under R1 h, with hangovers from
  400 ms up. GTCRN reaches 60 % under h only with the 0 dB limit at ≥ 10 %.
- **Silero passes no rule.** Choir singing (vvoice "singing", Cantoria)
  fails at every grid point.
  - Silero scores 10 % of the choir frames below 2e-5. Even at p ≥ 0.0001
    with a 5 s hangover, women's choir loses 3.7 % (limit 1 %), and that
    point removes only 18.4 %.
  - At p 0.5, 100 ms hangover, no hysteresis (the grid point nearest its
    defaults) it removes 99.5 % of tuning-194, but:
    - real held voices: 93–99 % blanked;
    - speech in noise, women / men: 8 / 17 % lost at +10 dB, 42 / 7 % at
      0 dB;
    - choir: 12–45 % lost; vocadito 11 %; Hillenbrand 1.8–4.1 %; children
      3.7–7.9 %;
    - speech onset delay: median 0 ms, p90 500–550 ms.
  - The 10-06 note's 750 ms male onset median was measured on its own
    onsets (VocalSet, PVQD + VOICED and the old mixes, now without audio on
    disk). Here, even with the held-voice onsets counted, the medians are
    0–25 ms.

### What a user would see: FireRedVAD, the only candidate at ≥ 60 % under R1 / R2

Selection data, **real voices only**. Each cell is women / men, % of correct
hops blanked, pooled; "worst:" gives the worst single row behind the pooled
figure (a row = one source or mix kind, one sex group of ≥ 400 hops; added
2026-10-20 after review). "Held" pools the Coswara and Saarbrücken sustained
vowels, the real H1 / H2 / H4 holds and the held voices inside the mixes.
"Speech" pools FDA, PTDB-TUG, vvoice speech and children, and the speech and
children's-speech mixes.

| | **R1 h point (the lead reading)** | R2 point (0 dB ≤ 10 %) | R1 point |
|---|---|---|---|
| setting | w5, p ≥ 0.55, 2 s | w5, p ≥ 0.55, 5 s | w1, p ≥ 0.2, 5 s |
| tuning-194 false line removed | **79.8 %** | 70.2 % (marginal, below) | 35.6 % |
| held notes / sustained vowels blanked, clean | 2.8 / 6.4; worst: H2 holds, men 10.5 (Coswara vowels, men 9.9) | 1.0 / 1.8; worst: H1 holds, men 3.4 | 0.0 / 1.1; worst: H1 holds, men 3.1 |
| … last 10 s of long clean holds (H2 only) | 15.6 / 29.0 | 7.1 / 14.4 | 0.0 / 12.6 |
| … in noise, +10 dB | 9.3 / 20.2; worst: H1, men 35.1 | 3.0 / 10.1; worst: H1, men 19.4 | 0.9 / 4.0; worst: H1, men 11.0 |
| … in noise, 0 dB | 23.6 / 32.7; worst: H2, men 42.7 | 12.7 / 19.4; worst: H2, men 27.4 | 4.2 / 6.0; worst: H2, men 12.4 |
| normal speech lost, clean | 0.30 / 0.11; worst: children, women 0.99 | 0.16 / 0.08; worst: children, women 0.53 | 0.00 / 0.00 |
| … in noise, +10 dB | 0.19 / 2.16; worst: children's mixes, men 3.37 | 0.11 / 0.73; worst: children's mixes, men 1.10 | 0.00 / 0.20; worst: children's mixes, men 0.30 |
| … in noise, 0 dB | 2.85 / 0.69; worst: children's mixes, women 4.87 | 0.63 / 0.00; worst: children's mixes, women 1.07 | 0.00 / 0.00 |
| singing (vocadito, choir, exercises), clean | ≤ 0.08; worst: singing exercises 0.48 (sex unknown) | ≤ 0.08; worst: singing exercises 0.48 | 0.0 |
| Hillenbrand vowels | 0.0 | 0.0 | 0.0 |
| speech onset delay, median / p90 (ms) | 0 / 0 | 0 / 0 | 0 / 0 |
| removed per noise class: stationary-tonal / mixed / broadband / intermittent-tonal | 75.9 / 84.8 / 79.4 / 74.5 | 66.6 / 75.9 / 68.6 / 51.9 | 36.4 / 38.8 / 14.1 / 32.4 |

Groups of unknown sex: speech clean up to 0.32 % (vvoice speech), speech in
noise up to 1.14 % (+10 dB), singing exercises 0.48 % (above); their held
voices lose less than the women / men cells. The pooled "speech in noise"
cells pass at the R1 h point, but its children's-speech rows alone would not
(3.37 % at +10 dB, limit 3 %; 4.87 % at 0 dB): R1 h gates the mixes' non-held
voices pooled (speech, children's speech and singing per mix set, SNR and
sex), as defined above.

**Robustness within the tuning data (added 2026-10-20 after review).** The
best-of-grid selection was repeated 1,000 times on resampled selection data:
voice streams drawn with replacement within each gating row and sex (a mix
id's 20 s-lead and lead-0 streams together), with the 194 noise clips either
fixed or also resampled; each draw re-picks the best passing grid point.

| reading | removal as picked | median of draws (5–95 %) | draws ≥ 60 % | hangover re-picked |
|---|---:|---|---:|---|
| R1 h | 79.8 % | 77.6–77.8 % (69–86 %) | 100 % | 0.75–2 s in 58–61 % of draws; 3–5 s in 19–22 %; ≤ 0.5 s in 20 % |
| R2 (0 dB ≤ 10 %) | 70.2 % | 62.1–62.3 % (46–74 %) | 60–66 % | 5 s in 88–89 % |

At the R2 point the binding rows are the +10 dB mixes, men: 2.80 % against
the 3 % limit (both mix sets). This is still selection data only; it shows
how stable the pick is, not how it does on new audio.

**Private check (information).** On one private recording of a quiet room
with fans and no voice, the app's painted false line was mostly removed at
the R2 point and about half at the R1 point; the in-app snapshot holds no
audio, so no detector could be applied to it; the results are kept outside
this repository.

**Limits: why this is not a ship decision**
- **Best of grid, scored on its own clips.** Held-out A cannot be read again,
  and held-out B has no audio on disk. The R2 pass rests on 7 grid points,
  all at the longest hangover.
- **The 5 s hangover.** The gate stays open for 5 s after any voice, so
  false paint in pauses after speech (the 10-06 G3 case) is not removed. The
  noise clips are the cold case. The R1 h point (2 s) is less latch-like.
- **Held voices in noise lose a lot.** At the R2 point, men's held notes in
  0 dB noise are about one-fifth blank, and the last 10 s of men's long
  clean holds about 14 %.
- **Unchanged from the screen:**
  - the noise clips are 16 kHz;
  - about half of the held-voice audio is synthetic (the user-view table
    uses real voices only);
  - Stage B is still needed: the rebuilt VocalSet / PVQD / VOICED / mix /
    held-out B audio, a non-VocalSet singing check, the browser CPU bench
    (FireRedVAD: 2.3 MB; 1.4–1.6 ms per 25 ms in our runtime with one call
    per 25 ms), and the G3 case.

**Answer** (rewritten 2026-10-20 after review). If sustained notes and vowels
may be blanked, one tool reaches the 60 % bar on the tuning clips:
FireRedVAD.
- **If held voices may be blanked everywhere, also inside the noise mixes
  (the "h" reading), it removes about 80 %** (79.8 %; w5, p ≥ 0.55, 2 s
  hangover). This holds up when the tuning data are resampled: median about
  78 %, ≥ 60 % in every draw, and the re-picked hangover is mostly 0.75–2 s.
- If held voices inside the mixes still count and the 0 dB mixes may lose
  up to 10 % (R2), it removes 70 %, but that is **marginal**: median 62 %,
  ≥ 60 % in only 60–66 % of draws, every passing point ≥ 60 % at the 5 s
  hangover, and the +10 dB men's mix row at 2.80 % against its 3 % limit.
- Normal speech at the h point: pooled 0.30 / 0.11 % lost (women / men), worst
  row 0.99 % (children's speech, women); in noise 2.16 % pooled at +10 dB
  (men), worst row 3.37 % (children's speech, men); singing ≤ 0.08 % pooled,
  worst row 0.48 % (singing exercises). No added onset delay.
- The cost is on held voices (women / men): clean 2.8 / 6.4 % blanked (worst
  row 10.5 %, men's long holds), the last 10 s of long holds 15.6 / 29.0 %,
  in +10 dB noise 9.3 / 20.2 %, at 0 dB 23.6 / 32.7 %.
- Under R1 as written (0 dB mixes ≤ 3 %, held voices in them counted), it
  stays at 36 %.
- Under R1 / R2 no other tool comes close: GTCRN 38 %, RNNoise 36 %,
  Earshot 36 %, WebRTC 15 %, Silero none. GTCRN's detector score reaches
  61–77 % only in the "h" reading, with the 0 dB limit at 10 % or more.
- **Tuning data only.** Every figure here is the best point of a grid,
  scored on the clips it was picked on. It is not a validated result; a
  held-out confirmation is needed before any ship decision.

### Addendum review applied (2026-10-20)

A read-only review of this addendum re-scored it with its own code. Each
point was re-checked before it was applied; none changes the verdict of the
screen.

| finding | checked by | applied in |
|---|---|---|
| lead with the "h" reading: about 80 %, stable under resampling | its bootstrap re-run (median 77.6–77.8 %, 100 % of draws ≥ 60 %) | top summary, robustness table, Answer |
| R2's 70.2 % is marginal | same bootstrap (median 62.1–62.3 %, 60–66 % of draws ≥ 60 %); the +10 dB men's mix rows at 2.80 % | top summary, robustness table, Answer |
| pooled figures hide worse rows (singing exercises 0.48 %, children's speech 0.99 %, women) | per-row re-score at the three points (`relaxed.py` readings, split by source and mix kind) | user table, Answer |
| GTCRN without the held-voice rows is 8.0 %, not 8.1 % | 8.048 % from both `relaxed.py` and the selection record | §A, Reproduction |
| the Silero "defaults" point has no hysteresis | Silero's iterator ends speech below p 0.35 | Candidates, What binds |
| keep the "tuning data only" warning | — | top summary, Answer |
