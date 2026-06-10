# Display jump break for harmonic spike excursions — 2026-06-10

Live-use report (screenshot, post-PR #83 deploy): full-height vertical
spike lines from the ~107 Hz voice trace to ≥400 Hz, several with flat
tops near 400 Hz, recurring every few seconds. The PR #83 onset
confirmation didn't stop these — and per the run-length data it never
could have.

## Characterization (2026-05-26 session, production pipeline + shipped display)

Two-octave-class excursions in the *displayed* series (≥12 st from the
1-s local median): **1 961 runs**, median length **4 frames** (p90 = 11)
— long enough to defeat both confirm-3 and the median-5 by construction.
Frequency ratios against the local median cluster at **2.1× (octave-up)
and 0.38× (fry-region octave-down)**, with a 450–600 Hz tail (the 3–4×
class seen in the screenshot). No single dominant absolute frequency →
transient harmonic/subharmonic locks in the detector, not a stationary
room tone.

## Tracker-level levers: measured, all poor trades

(2026-05-26 session; bigSpikes = two-octave displayed runs; corr = 80–110 Hz
band agreement vs Praat, crude-attribution variant — relative deltas are
the signal.)

| tracker config | bigSpikes | band corr |
|---|---|---|
| ojc 0.15, L2 (production) | 1 961 | 87.8 % |
| ojc 0.35, L2 | 1 703 (−13 %) | 84.7 % (−3.1 pp) |
| ojc 0.35, L4 | 1 611 | 68.4 % (wrong-octave stickiness) |
| ojc 0.15, L2 + gap-memory(12) | 1 902 | 87.9 % |
| ojc 0.35, L2 + gap-memory(12) | 1 469 (−25 %) | 84.9 % (−2.9 pp) |

(gap-memory = unvoiced lattice states carry a decaying last-voiced
frequency so post-gap re-entry pays octave-jump cost. Helps only in
combination, and the combination costs ~3 pp detector-level band
accuracy — which would also pollute session recordings.) The tracker is
near its accuracy/spike Pareto edge; transition costs cannot remove
sustained excursions whose candidates genuinely dominate for 3–11 frames.

## Shipped: display jump break (DISPLAY_JUMP_BREAK_SEMI = 12)

A ≥12-semitone step between consecutive *painted* values is treated as a
fresh onset: the new level must re-earn ONSET_CONFIRM_FRAMES (3) before
painting, and the reference persists through unvoiced gaps (so post-gap
re-entry on a wrong harmonic also re-confirms). A voice cannot move an
octave in one 25 ms hop, so no legitimate glide trips it (real glides
move ≤ ~2 st/frame); genuine register leaps simply paint 50 ms late.

| display config | connected ≥12 st jumps | painted spike frames | band corr |
|---|---|---|---|
| shipped (confirm-3) | 1 791 | 10 734 | 74.3 % |
| + jump break | **0** | 9 238 (−14 %) | 72.0 % (−2.3 pp) |

The screaming visual — full-height lines joined to the real trace — is
eliminated entirely; surviving excursions render as short detached
dashes, and sub-confirm-length ones disappear. The −2.3 pp is
display-only (recording keeps raw per-frame values) and is the cost of
re-confirming after each genuine large leap and after each excursion's
return.

## Rejected

- Tracker retuning (table above): worse trades, and detector-level
  changes would alter recorded data.
- Semitone jump *clamp* (prior measurement, pitch-spike-flicker md):
  −9–13 pp accuracy; octave-lock mechanism family.

Residual: short detached dashes near harmonics may still appear
occasionally. If they remain annoying in practice, the next candidates
are confirm-4 for jump-break re-entry only, or revisiting gap-memory
with a corpus regression pass.
