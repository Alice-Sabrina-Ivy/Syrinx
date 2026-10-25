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
