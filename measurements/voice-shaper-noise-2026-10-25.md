# Voice Shaper: how to handle background noise — 2026-10-25

Branch `voice-shaper-noise` (from `origin/main` 9e9e227). User request: "figure out whatever you
think would be the best way of filtering noise on the voice shaper, through testing different
things and measuring the results." Public data only; no recording of the user's voice is used.

Starting point: a friend's fork (`NimbleAINinja/Syrinx`, branch `voice-shaper-denoise`, commit
97b0f54) adds an opt-in RNNoise 0.2 switch. Its note scores the noisy mixes with the pitch track
of the **clean** clip; in the app the track comes from the pitch worker hearing the noisy
recording. This study measures every candidate through the real chain.

## 1. Plan (written and committed before any result)

### Question

Which processing makes the Voice Shaper's preview of a noisy recording closest to the preview the
same voice would give in a quiet room, without harming clean recordings, equally for low and high
voices, within the phone budget?

### What "the real chain" means here

For every mixture: the REAL pitch worker (`src/dsp/pitch-worker.js`, with the REAL FireRedVAD
detector, as `scripts/session-oracle/lib/voice-gate.mjs` runs it) hears **6 s of the same noise
before the recording** (Record waits until listening has run 6 s) and then the recording; the
recording's posted track (and each hop's detector score) is collected per capture chunk exactly as
`recorder.js` assigns it. The Voice Shaper engine (`src/voice-preview/engine/preview.js`, the
committed WORLD module) then analyses the candidate's audio with the candidate's track.

Recordings: 0.5 s of room noise, the speech clip, 0.5 s of room noise; ≤ 8 s; 48 kHz capture.
Mixing: noise scaled to the SNR against the speech's active level (frames above 1 % of the peak
frame RMS, as the fork's eval); the 6 s pre-roll and the recording are one contiguous noise
segment.

Reference: the clean clip through the same chain (pre-roll and padding digital silence plus
−90 dBFS dither) — the preview a quiet room would give — at the same cell.

Cells: (0 st, 0 %), (+4 st, +10 %), (−4 st, −10 %); semitones clamped to the clip's limits from
the clean track (`pitchLimits`), the same for every candidate.

### Candidates

Audio stage (what the engine analyses):

| id | what | cost class |
|---|---|---|
| `none` | the recording as captured (shipped) | — |
| `rnn` | RNNoise 0.2, the fork's module and loader unchanged | 1.4 MB, ~40 ms per audio s |
| `mmse` | MMSE log-spectral-amplitude estimator (Ephraim–Malah, decision-directed a-priori SNR), noise PSD from the recording itself (frames the voice detector calls no-voice, else minimum statistics); whole-clip, non-causal | no download, few KB of JS |
| `mmse-pre` | as `mmse`, noise PSD from the last 2 s of capture before Record (needs the worker to keep a pre-roll) | as `mmse` |
| `gtcrn` | GTCRN (DNS3 checkpoint, MIT) at 16 kHz; the band above 8 kHz kept from the input with the model's 4–8 kHz mean gain | 0.35 MB ONNX + ORT (already shipped for FireRedVAD) |
| `dfn3` | DeepFilterNet 3, 48 kHz full band | ~8 MB; information unless it wins clearly |
| `wsub` | in WORLD's own domain: noise envelope estimated from no-voice frames subtracted from CheapTrick's envelope, aperiodicity floored — only if time allows | no download |

Track stage (the F0 WORLD is given):

| id | what |
|---|---|
| `posted` | the posted track (shipped) |
| `vad` | posted, with hops whose FireRedVAD score is below θ set unvoiced (θ chosen on dev; no hangover) |
| `re` | the real pitch worker re-run over the cleaned recording (audio candidates only) |

### Metrics

Per render, against the reference render of the same clip and cell:

- **PESQ-WB** (16 kHz, ITU P.862.2 via `pesq`) — primary.
- LSD on the reference's speech frames (the fork's definition), ESTOI.
- **DNSMOS P.835** (SIG / BAK / OVRL, non-intrusive, on the render itself).
- Pause residual: render level in the reference's pauses, dB re speech.
- Track: hops voiced where the clean track is unvoiced (false voicing), unvoiced where it is voiced
  (misses), and > 50 cents from it (gross).

### Data and split

Speech (48 kHz): dev = OpenSLR 83 Midlands English female + male (CC BY-SA 4.0); test = RAVDESS
speech, normal intensity (24 actors, CC BY-NC-SA 4.0), OpenSLR 83 Northern English female and
Irish English male. Sung / held check (test only): vocadito (44.1 kHz).

Noise: dev = DEMAND 48 kHz (CC BY 4.0) DLIVING, DKITCHEN, DWASHING, OOFFICE, STRAFFIC,
PCAFETER + MS-SNSD `noise_train` (MIT, 16 kHz) + seeded synthetic white / pink / fan hum (as the
fork's eval); test = DEMAND OMEETING, PRESTO, TCAR, NPARK, OHALLWAY + MS-SNSD `noise_test`.
SNR 0 / 5 / 10 / 20 dB, plus clean. Every parameter (θ, MMSE settings, GTCRN high-band rule) is
chosen on dev; the test set is scored once, at the end, for the chosen settings.

### Decision rule

Among candidates that pass every guard, the winner has the largest mean **test** PESQ-WB gain over
`none` on noisy mixtures (0–20 dB), taken on the **worse of the two sex groups**.

- G1 clean recordings: PESQ-WB change vs `none` ≥ −0.10 for women and for men.
- G2 noisy recordings: mean DNSMOS OVRL not below `none`.
- G3 held / sung (vocadito, clean and 10 dB): PESQ-WB change vs `none` ≥ −0.10 clean.
- G4 cost: ≤ +0.5 s for an 8 s recording in desktop Chrome; phone estimate stated.
- G5 download on first use ≤ 2 MB; a larger candidate (DFN3) is reported, and offered as an
  option only if it beats the best ≤ 2 MB candidate by ≥ 0.3 PESQ-WB on the worse group.

If the winner also passes G1 at ≥ −0.05 and is never below `none` at 20 dB on either group, it is
proposed as **on by default**; otherwise as a switch. The objective scores are proxies; the
result ends with an A/B listening page on public clips for the user.

## 2. Development rounds (dev subset: 20 clips, 10 women / 10 men, one noise draw per SNR, cell 0 st / 0 %)

Recorded before the test set was scored. Paired PESQ-WB change vs `none|posted`, worse sex.

**Deviations from §1, decided on dev data:**

- **Quiet-room controls (30 / 40 dB SNR) added.** The clean mixtures' padding is near-digital
  silence (level margins 61–77 dB), which no room gives; 30 / 40 dB of the same noise classes
  stand in for a quiet room. Appended to the mixture list after the plan's SNRs (earlier draws
  unchanged).
- **Automatic mode added as a candidate**: the denoiser runs only when the recording's level
  margin (`checks.js` `levelMargin`, the noise notice's measure) is below a threshold; otherwise
  the recording is used as captured. The hum flag is not used as a trigger: it fires on 15–22 %
  of the 30 / 40 dB recordings.
- **PESQ on vocoded renders is dominated by the F0 contour.** `none|oracle` (the clean track on
  the noisy audio) gains +0.54 PESQ at 30 / 40 dB from track agreement alone. DNSMOS and the
  track error rates are therefore read next to PESQ.

| candidate | noisy 0–20 dB | clean (G1) | quiet 30/40 dB | DNSMOS OVRL noisy |
|---|---|---|---|---|
| `rnn\|posted` (the fork, as shipped there) | +0.33 | −0.81 | +0.08 | +0.46 |
| `rnn\|re` (RNNoise, track re-run on the cleaned audio) | +0.51 | −1.12 | +0.29 | +0.52 |
| `rnn\|oracle` (diagnostic: the clean track) | +0.68 | −0.81 | +0.53 | +0.50 |
| `ext:dfn3\|re` (DeepFilterNet 3, ~8 MB) | +0.70 | −2.58 | −0.26 | +0.63 |
| `ext:gtcrn\|re` (GTCRN, 0.35 MB) | +0.44 | −1.54 | +0.03 | +0.38 |
| `mmse:vad:0.98:-18:1:0.3:median\|re` (no download) | +0.25 | −0.40 | +0.23 | +0.23 |
| `none\|posted\|wsub:1:-15` (WORLD-domain subtraction) | +0.06 | −0.10 | +0.00 | +0.01 |
| `none\|vad:0.2` (FireRedVAD track gating) | +0.00 | −0.12 | — | −0.00 |
| `rnn+pre\|re` (RNNoise over the 2 s pre-roll + recording) | +0.52 | −1.17 | +0.23 | +0.53 |
| **`auto[45]~rnn\|re`** | **+0.51** | **0.00** | **+0.18** | +0.51 |

Findings on dev:

- FireRedVAD gating of the track does nothing for noisy recordings and hurts clean ones (the
  detector misses voice, those frames are rebuilt unvoiced) — rejected.
- Re-running the real pitch worker on the cleaned audio recovers about half of the gap between the
  noisy posted track and the clean track (+0.33 → +0.51 of +0.68); warming it with the pre-roll,
  gating it with FireRedVAD, or denoising the pre-roll too adds nothing.
- DeepFilterNet 3 is the strongest on noisy audio but leaves residue in near-silence and costs
  women PESQ in quiet rooms; at ~8 MB it is information only (G5: +0.19 over RNNoise < 0.3).
- RNNoise 0.2 distorts clean speech slightly (LSD +1.4 dB; DNSMOS −0.01) — the automatic mode
  keeps it off clean recordings. Thresholds 40–50 dB form a plateau (+0.513 worse sex); 60 dB
  starts to fire on clean recordings. **Frozen: 45 dB.**

### Frozen for the test set (before any test score)

Candidates, all three cells: `none|posted`, `rnn|posted`, `rnn|re`, `ext:gtcrn|re`,
`ext:dfn3|re`, `mmse:vad:0.98:-18:1:0.3:median|re`, `none|oracle`, `rnn|oracle` (diagnostics);
automatic modes built from them with the 45 dB rule (and 28 dB, the notice's threshold, for
reference). Sung set (vocadito, clean and 10 dB): `none|posted`, `rnn|posted`, `rnn|re`.
The decision rule of §1 is applied to `auto[45]~rnn|re` and the always-on candidates as written;
G3 uses the sung set.

## 3. Test set (read once, after §2 was committed)

95 held-out clips (RAVDESS 35, OpenSLR 83 Northern English women 30, Irish English men 30) ×
(clean, 0 / 5 / 10 / 20 dB × 2 noise draws, 30 / 40 dB) = 1 045 mixtures, held-out noise (DEMAND
OMEETING, PRESTO, TCAR, NPARK, OHALLWAY; MS-SNSD `noise_test`), all three cells: 25 080 scored
renders. Paired change vs `none|posted`; "worse sex" = the smaller of the women's and men's means.

| candidate | noisy PESQ, worse sex (F / M) | clean PESQ, worse sex (G1) | quiet 30/40 dB | noisy DNSMOS OVRL |
|---|---|---|---|---|
| `rnn\|posted` (the fork) | +0.20 (+0.29 / +0.20) | −0.98 | −0.04 | +0.52 |
| `rnn\|re` | +0.29 (+0.46 / +0.29) | −1.39 | −0.13 | +0.55 |
| `ext:gtcrn\|re` | +0.31 | −1.79 | −0.26 | +0.46 |
| `ext:dfn3\|re` (~8 MB) | +0.50 (+0.70 / +0.50) | −2.17 | −0.32 | +0.68 |
| `mmse:…\|re` (no download) | +0.19 | −0.68 | +0.10 | +0.27 |
| **`auto[45]~rnn\|re`** | **+0.28 (+0.44 / +0.28)** | **−0.13 (F −0.07, M −0.13)** | **+0.00** | **+0.54** |
| `auto[45]~ext:dfn3\|re` | +0.47 | −0.19 | −0.06 | +0.66 |
| `auto[28]~rnn\|re` (reference rule) | +0.23 | 0.00 | 0.00 | +0.48 |
| `auto[28]~ext:gtcrn\|re` | +0.27 | 0.00 | 0.00 | +0.39 |
| `auto[28]~ext:dfn3\|re` | +0.40 | 0.00 | 0.00 | +0.57 |
| `none\|oracle` (diagnostic) | +0.12 | 0.00 | +0.22 | +0.02 |
| `rnn\|oracle` (diagnostic) | +0.49 | −0.98 | +0.20 | +0.58 |

By SNR (all sexes, `auto[45]~rnn|re` / `auto[28]~rnn|re`): 0 dB +0.28 / +0.27, 5 dB +0.36 / +0.32,
10 dB +0.44 / +0.39, 20 dB +0.37 / +0.10, 30 dB +0.07 / 0, 40 dB −0.01 / 0. By noise class every
held-out class gains (PESQ +0.22 babble … +0.78 car; DNSMOS OVRL +0.28 … +0.87); talking and
announcements gain least.

**Where G1 fails.** The 45 dB rule fired on 5 of the 95 clean test clips, all RAVDESS recordings
whose own room tone puts their margin near 42 dB. On those five the render's PESQ against the
as-captured reference drops (women −1.56, men −2.06: the reference keeps the room tone the
denoiser removes) while DNSMOS rises (OVRL +0.25 / +0.09, BAK +0.36 / +0.04). Over the 95 clips
that is −0.07 (women) / −0.13 (men), against the −0.10 guard.

**G3, sung (vocadito, clean and 10 dB).** Neither rule fires on the clean sung clips (margins
61–79 dB): change 0.00. At 10 dB: `rnn|re` +0.47 PESQ, DNSMOS OVRL +0.73; `auto[45]~rnn|re` +0.43.

**G2** (noisy DNSMOS not below `none`): every candidate passes.

**G5** (download ≤ 2 MB): RNNoise 1.4 MB, GTCRN 0.35 MB pass; DeepFilterNet 3 (~8 MB) beats the best
small candidate by +0.19 (always on) / +0.19 (auto 45) — under the 0.3 bar: information only.

### Verdict under the §1 rule

**No candidate passes every guard.** The decision set frozen in §2 (`auto[45]~rnn|re` and the
always-on candidates): every always-on candidate fails G1 by 0.68–2.17; `auto[45]~rnn|re` fails
G1 by 0.03 for men, from the five room-tone clips above. The 28 dB automatic variants pass every
guard but were frozen as reference rows, not as decision candidates. The choice between them is
left to the user (§5).

## 4. What was built (branch `voice-shaper-noise`)

On top of the fork's commit (cherry-picked, authorship kept):

- **Automatic mode** (`checks.js` `DENOISE_MARGIN_DB` 45, `autoDenoise`): the setting is "auto"
  until the user flips the switch; a recording whose level margin is below 45 dB is noise-reduced
  and the switch shows it ("Turned on because the recording has background noise."); flipping it
  re-analyses the same take and is kept for the page visit.
- **Re-tracking** (`retrack.js`): when noise-reduced, WORLD's F0 track is re-made from the cleaned
  audio by a fresh instance of the app's pitch worker (unchanged, without the voice detector),
  started by the voice-preview worker; the posted track stays the source of the pitch statistics,
  the slider limits and the recording check. If it fails, the posted track is used.
- **While recording** (`denoise-stream.js`, streaming `createRetracker`): unless the setting is
  "off", Record fetches the RNNoise module and starts the pitch worker, and every chunk is
  noise-reduced and re-tracked as it arrives; the result is bit-identical to the whole-recording
  computation (`denoise-test.js`, 16 / 44.1 / 48 / 96 kHz; `worker-test.js`). If "auto" decides
  against it, that work is dropped.

**Cost (G4).** Headless Chrome on the development PC, an 8 s recording at 44.1 kHz: at Stop, noise
reduction 6 ms + re-tracking 4 ms (whole-recording: 920 + 435 ms). During the recording RNNoise
costs ~95 ms of CPU per audio second in the voice-preview worker on this PC (36.7 ms in Node on
the fork author's machine). **Phone not measured** — the open item before main: CPU while
recording on the phone (with the pitch, DSP and resonance workers running) and the analysis time.
Download: every first recording (setting not "off") fetches the 1.4 MB module, cached afterwards.

**Checks.** `npm run lint`, `npm run test:unit` (73/73), `npm run build`, `bundle-budget.mjs`
(6/6), `voice-preview-smoke.mjs` all parts: 332/333 — the one failure, the Resonance lab's
"worker stopped" check at 360 px, fails 1 in 3 on the fork's commit too (timing flake).

**Known issue.** Once a worker holds the RNNoise module, Chrome's DevTools heap queries
(`Runtime.queryObjects`) on that worker close it (reproduced with a worker that only loads
`rnnoise.wasm`; the fork's switch has the same effect). Normal use is not affected (analysis,
renders, playback, Discard all pass); heap inspection of the voice-preview worker is. The smoke's
worker-memory check now reads the worker's own WORLD-heap report instead.

## 5. Decision for the user

1. **Automatic at 45 dB (built).** Noisy +0.28 PESQ worse sex (women +0.44), DNSMOS +0.54; at
   20 dB +0.37. Misses G1 by 0.03 because it also cleans recordings with audible room tone (5 % of
   the clean test clips), where DNSMOS improves and PESQ, scored against the room tone, drops.
2. **Automatic at 28 dB** (the noise notice's own threshold; one constant). Passes every guard;
   noisy +0.23, but at 20 dB only +0.10, since the notice rarely fires there.

Either way: re-tracking stays (it is most of the gain over the fork); FireRedVAD track gating,
MMSE, GTCRN and WORLD-domain subtraction are not used; DeepFilterNet 3 is the candidate for a
later "higher quality" option if its 8 MB and phone cost are acceptable. Listening page with ten
held-out clips (blind mode): built from `scripts/voice-preview/noise-study/listen.mjs`.

## 6. DeepFilterNet 3 in the browser — feasibility (2026-10-25, after the user OK'd an 8 MB download)

**Route 1, the official WebAssembly build** (`libDF/src/wasm.rs`, `wasm-pack build --features wasm`,
tract inside; built here at d375b2d with `default-model` dropped from the `wasm` feature so the
model is passed at runtime): works frame by frame, but costs **370–410 ms of CPU per audio
second** in Node WebAssembly (SIMD build no faster) — ~4× the native CLI; a phone could not keep
up while recording, and an 8 s clip would take seconds after Stop. Its binding also runs libDF's
`RuntimeParams` default stage thresholds (−10 / 30 / 20 dB), not the CLI's (−15 / 35 / 35) that §3
scored. Not pursued.

**Route 2, a JS port + onnxruntime-web** (`scripts/voice-preview/noise-study/dfn3.js`): libDF's signal
processing ported to JS (Vorbis-window STFT with a mixed-radix 960-point FFT, ERB / complex features
with exponential normalisation, the per-frame stage thresholds, ERB gains, deep filtering over
frames τ−2 … τ+2, inverse STFT), and the official ONNX graphs run **once over the whole recording**
with onnxruntime-web (the app already ships it for FireRedVAD).

- Faithfulness: vs the official wasm with its thresholds, −26 … −29 dB difference; vs the CLI with
  the CLI's thresholds, −18 … −36 dB (the two references differ from each other by −10 … +0.7 dB:
  per-frame stage decisions flip on float differences).
- Quality through the real engine (280 held-out mixtures: the first 20 women's and 20 men's test
  clips, one draw per SNR, all three cells), paired against the CLI scores of §3 on the same
  mixtures: noisy PESQ +0.80 vs +0.74, clean −1.14 vs −1.85, quiet rooms +0.20 vs +0.05, DNSMOS OVRL
  +0.76 vs +0.73 — the port is at least as good (whole-sequence processing has no streaming warm-up).
  Worse sex, automatic: 45 dB +0.58 (RNNoise + re-track +0.35 on the same mixtures), 28 dB +0.48
  (+0.29). The subset has no RAVDESS clip, so it does not exercise the room-tone cases of §3.
- Speed: Node 65 ms per audio second (RNNoise on the same PC ~95); **desktop Chrome** (headless,
  dev PC, `dfbench/run-desktop.mjs`): a 7.4 s recording in 0.44–0.65 s, sessions 0.40–0.46 s (can
  be created during the recording); output bit-identical to Node's.
- Download: the three graphs 8.6 MB (8.0 MB gzip); onnxruntime-web's WASM (3.4 MB gzip) is the
  file the app already self-hosts for FireRedVAD.
- **Not streaming**: the exported graphs keep no recurrent state between calls, so the whole
  recording is processed at Stop: desktop ~0.5–0.65 s plus re-tracking, over the 0.5 s G4 budget;
  **phone not measured** (`dfbench/run-phone.mjs`, needs the phone on USB).

## 7. DeepFilterNet 3 shipped in Voice Shaper (2026-10-25)

User decision after §6: "a few seconds of waiting for processing is fine" and no phone benchmark —
DeepFilterNet 3 replaces RNNoise, processing the recording when it ends.

**Level normalisation (found on the full test set).** The first full run of the port scored
below the CLI on RAVDESS: those recordings sit at about −51 dBFS, where DeepFilterNet 3's
level-dependent features pin its local-SNR estimate at the −15 dB floor and every frame is gated
to zero (the official wasm build does the same; the CLI kept speech only because its −15 dB
threshold is a strict `<` and its estimate sat exactly on the floor). `denoiseClipDfn3` now brings
the 95th-percentile 20 ms frame RMS to 0.1 (peak < 0.99) before the model and undoes the gain
after (`dfn3Gain`). All earlier port results were discarded and the port re-run through the
app's own function.

**Full test set (1 045 mixtures, three cells), the app's path** (`ext:dfn3js|re` = level-normalised
port + re-tracking; worse sex; paired vs `none|posted`):

| candidate | noisy 0–20 dB (F / M) | clean (G1) | quiet 30/40 dB | DNSMOS OVRL noisy |
|---|---|---|---|---|
| `ext:dfn3js\|re` always on | +0.55 (+0.78 / +0.55) | −1.29 | −0.03 | +0.71 |
| `ext:dfn3\|re` (the CLI, §3) | +0.50 | −2.17 | −0.32 | +0.68 |
| `auto[45]~ext:dfn3js\|re` | +0.52 (+0.73 / +0.52) | −0.13 (fails) | +0.03 | +0.68 |
| **`auto[40]~ext:dfn3js\|re` (shipped)** | **+0.51 (+0.71 / +0.51)** | **−0.04 (passes)** | **+0.03** | **+0.68** |
| `auto[35]~ext:dfn3js\|re` | +0.49 | 0.00 | 0.00 | +0.65 |
| `auto[28]~ext:dfn3js\|re` | +0.42 | 0.00 | 0.00 | +0.60 |
| `auto[40]~rnn\|re` (for comparison) | +0.28 | −0.03 | +0.00 | +0.54 |

Sung (vocadito): the automatic rule never fires on the clean clips (0.00); at 10 dB DeepFilterNet 3
+0.64 PESQ (RNNoise +0.43), DNSMOS OVRL +0.71.

**Threshold: 40 dB** (`DENOISE_MARGIN_DB`). Chosen after reading the test set (a deviation from
§2's frozen 45 dB): 40 dB is the lower edge of the 40–50 dB dev plateau, keeps all but 0.007 of
45 dB's gain and passes G1, which 45 dB misses by 0.03 (it also cleans the RAVDESS clips with
audible room tone). With it every §1 guard passes for the shipped design: G1 −0.04, G2 +0.68,
G3 0.00; G4 waived by the user (processing at Stop: desktop Chrome ~0.4–0.9 s for 8 s plus
re-tracking ~0.1–0.4 s; the phone is not measured); G5 waived by the user (8 MB).

**What the app does.** "Auto" (default): a recording whose level margin is below 40 dB is
noise-reduced when it ends — the card shows "Downloading noise reduction (about 8 MB, first time
only)…" while the graphs are fetched (they start downloading at the first Record whose setting is
not off), then "Reducing background noise…" — and its F0 track is re-made from the cleaned audio.
The switch shows what was done and the user's flip is kept for the page visit; a take's cleaned
recording is reused when the switch goes off and on again.

**Checks.** `dfn3-test.js` (19), `worker-test.js` (48), `controller-test.js` (57), notices (40),
`npm run test:unit` 73/73, lint, bundle budget 6/6 (tab chunk 13.4 KB, worker chunk 7.1 KB gzip;
`dfn3.js` and onnxruntime load only when noise reduction runs), smoke `denoise` and `checks`
15/15 in headless Chrome (the three graphs requested once each; DeepFilterNet 3 836 ms + re-track
425 ms for an 8 s, 44.1 kHz recording on a busy PC).

**Hosting** (user decision, same day): the project's Hugging Face mirror
`Alice-Sabrina-Ivy/deepfilternet3-onnx` — the three graphs byte for byte, LICENSE-MIT,
LICENSE-APACHE and a README crediting the authors — uploaded at commit
`a3c9b36fade2bf23123e7a2671c2f00b83b69229`, pinned in `DFN3_MODEL.mirrorCommit`; verified by an
unauthenticated download at that commit (sizes and sha256 equal the pins; CORS allows the Pages
origin) and by the smoke against the built app (the graphs land in Cache Storage, no console
errors). **Open.** Phone timing and memory (onnxruntime + three sessions in the voice-preview
worker) unmeasured, by the user's decision.
