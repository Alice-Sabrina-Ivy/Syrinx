# SwiftF0 vs Praat on real user session audio — 2026-06-09

Follow-up to the user report "still seeing huge inaccuracies when
comparing Syrinx with other pitch trackers" (octave-up readings + pitch
"stepping like a ladder" on an 85–95 Hz voice, in a quiet room, while
another live tracker reads correctly). User suggested testing real
speech from `C:\Coding Projects\Calliope\sessions` against Praat.

**Headline: confirmed and quantified. In the user's primary register
(80–110 Hz), SwiftF0 disagrees with Praat on half of all voiced frames
— 25.6 % octave-up, 19.1 % null — and the failures are *confidently
wrong* (octave-up frames have the same confidence distribution as
correct frames, median 0.82). The mechanism is weak-fundamental
phonation, not environmental interference and not the capture chain.**

## Method

- Praat reference: `scripts/praat-pitch-extract.py` (parselmouth 0.4.7,
  autocorrelation `to_pitch`, floor 50 Hz / ceiling 600 Hz, 10 ms step).
- Syrinx side: `scripts/swift-f0-session-extract.js` — the production
  pitch-worker streaming simulation (25 ms chunks, rolling 1024-sample
  16 kHz buffer, per-chunk inference, confidence gate 0.5, ~56 ms
  attribution offset), same machinery as swift-f0-streaming-verify.js.
- Comparison: `scripts/compare-praat-swift-sessions.py` — nearest-frame
  alignment, classification per Praat-voiced frame, banding by Praat F0,
  octave-flip counting, and a per-frame spectral H1−H2 measurement
  (level of the partial at f0 minus the partial at 2·f0, 64 ms Hann).
- Audio: three session WAVs (16 kHz 16-bit mono, ~88 min total) from
  the user's Calliope project — real voice, real mic chain, real rooms.
  Raw audio NOT committed; aggregate JSON in
  `measurements/swift-f0-vs-praat-sessions-2026-06-09.json`.

## Results (classification % of Praat-voiced frames)

### 2026-05-26 session (53 min, low-register practice — the problem regime)

| Praat band | n | correct | octave-up | null | octave-down | other |
|---|---|---|---|---|---|---|
| 50–80 Hz | 4 398 | 3.1 | **56.6** | 38.4 | — | 1.9 |
| **80–110 Hz** | **19 782** | **49.1** | **25.6** | 19.1 | — | 6.1 |
| 110–150 Hz | 5 829 | 55.0 | **19.6** | 22.7 | — | 2.7 |
| 150–220 Hz | 8 966 | 60.5 | 1.4 | 31.4 | 4.4 | 2.3 |
| 220–350 Hz | 9 565 | 80.0 | 0.8 | 15.5 | 0.8 | 3.0 |

Octave-flip rate between consecutive reports (the "ladder" signature):
**SwiftF0 5.5 % vs Praat 1.7 %** — 3.2×.

### 2025-09-08 session (30 min, mid register)

80–110 Hz (n=3 901): 91.6 correct / 1.9 octave-up. But 50–80 Hz
(n=399): **62.9 % octave-up**. Flip rate 1.21 % vs Praat 0.59 %.

### 2026-05-07 slice (5 min, high register practice)

80–110 Hz (n=409): 87.3 correct. Dominant issue is nulls: 40.6 % of
150–220 Hz frames below the confidence gate (display renders as
holds/gaps).

## Mechanism: weak fundamental (H1−H2), not interferer, not chain

Per-frame spectral measurement on 80–110 Hz frames, 2026-05-26 session:

| frame class | n | H1−H2 median (p25 … p75) |
|---|---|---|
| SwiftF0 correct | 400 | **+11.9 dB** (+3.9 … +16.8) |
| SwiftF0 octave-up | 400 | **−3.0 dB** (−6.8 … +1.8) |

2025-09-08 session: correct −1.2 dB vs octave-up **−19.1 dB** — same
direction, starker.

SwiftF0 octave-ups precisely on frames where the fundamental partial is
weak relative to the 2nd harmonic. Praat's autocorrelation recovers the
period regardless of which partial dominates — hence "other trackers
don't do this." Because the contrast is *between frames of the same
recording through the same chain*, a fixed mic-chain rolloff or room
interferer cannot explain it: this is phonation-dependent (breathy /
pressed voice qualities produce H2 > H1, and both are common in voice
training). This refines the May "harmonic-stack interferer" framing —
the synthetic 175 Hz interferer reproducer was mimicking what the
user's own voice does naturally on weak-H1 frames.

## Confidence is uninformative on these failures

80–110 Hz band, 2026-05-26: octave-up frames conf p25/median/p75 =
0.67/0.82/0.93; correct frames 0.70/0.82/0.92. Identical. No threshold
change can help; the SwiftF0 CNN genuinely believes 2·f0.

Examples (t_s, Praat Hz, SwiftF0 Hz, conf): (1.5, 91.9, 182.6, 0.70),
(20.9, 91.2, 183.2, 0.87), (20.9, 91.5, 180.6, 0.66).

## Caveats

- Praat is the reference, not ground truth; on 50–80 Hz fry Praat can
  err too. But the H1−H2 evidence is tracker-independent, and Praat's
  own flip rate is 3× lower on the same audio.
- Session WAVs are 16 kHz through Calliope's capture chain — not
  byte-identical to Syrinx's live chain. The within-recording H1−H2
  contrast makes chain effects a non-explanation for the octave errors.
- Coaching sessions may contain frames from other audio sources; the
  80–110 Hz dominance in the 2026-05-26 session matches the user's
  self-reported range, and n is large.
- The high null rates in 150–220 Hz (31–41 % on two files) are a
  second, distinct issue: SwiftF0 confidence < 0.5 on frames Praat
  considers voiced. Worth its own look (display shows holds/gaps).

## Implications for fix directions

1. **The May frame-local half-period autocorrelation check deserves
   re-evaluation against THIS failure set.** It was ruled out against
   the synthetic harmonic-stack reproducer, where the audio genuinely
   was more periodic at the interferer's frequency — an unwinnable
   case. Here the true period IS the dominant periodicity (Praat finds
   it from the same samples), so an autocorrelation referee has the
   information it needs. The earlier negative finding does not transfer
   to this regime.
2. PENN re-evaluation (fixed this class in May testing, ruled out on
   compute cost) — fallback if (1) fails on real-voice data.
3. Confidence-threshold or model-side changes: ruled out by the
   confidence-distribution finding above.

## Reproduction

```
python -u scripts/praat-pitch-extract.py build/pitch-compare/praat-contours.json <wavs...>
node scripts/swift-f0-session-extract.js build/pitch-compare/swift-contours.json <wavs...>
python -u scripts/compare-praat-swift-sessions.py build/pitch-compare/praat-contours.json \
    build/pitch-compare/swift-contours.json measurements/swift-f0-vs-praat-sessions-2026-06-09.json
```
