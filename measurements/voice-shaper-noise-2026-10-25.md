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
