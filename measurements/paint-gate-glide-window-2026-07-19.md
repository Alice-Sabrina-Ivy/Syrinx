# Paint gate: window the off-level candidate run — 2026-07-19

Follow-up to the 2026-06-10 excursion-break work (private measurement,
kept outside this repo), from the same-day code review that produced
[pitch-l2-retune-2026-07-19.md](pitch-l2-retune-2026-07-19.md). Validation
harness: `scripts/paint-gate-glide-validate.js` (new; run once before and
once after the change — synthetic gate-level scenarios with the real
`createPaintGate` module, at the post-retune detector config fl1280 /
vt0.35 / median-3).

## The defect

`offRun` — the list of consecutive off-level values the excursion break
uses to decide "sustained, internally-consistent new level → accept" —
was unbounded. The accept requires the run's min–max spread to stay
under `EXCURSION_SEMI` (9.5 st). If the off-level portion of a fast
glide itself spans ≥ 9.5 st, the early mid-glide values keep the spread
over the threshold **forever**: the genuinely-held target note can never
be accepted, and the trace stays blank until the next unvoiced gap
resets the segment. (Also made the per-frame spread computation O(run
length) on an array that grew for the rest of the voiced segment.)

**Trigger precision** (baseline measurements below): a 1-octave fast
glide does NOT trigger it — only values ≥ 9.5 st off the (lagging)
established level enter `offRun`, and for a +12 st glide those span
< 9.5 st, so the run stays consistent and accepts normally. The
permanent suppression needs the off-level portion to span ≥ 9.5 st,
i.e. fast glides of roughly ≥ 1.6 octaves — a standard full-siren
exercise done quickly. Slow wide glides also don't trigger it (each
step stays on-level relative to the moving established level and paints
throughout).

## The fix

`offRun` becomes a sliding window of the last `EXCURSION_SUSTAIN` (16)
off-level values. The accept question changes from "was the ENTIRE
off-level run consistent" to "were the last ~400 ms consistent" —
mid-glide values scroll out once the target holds. Harmonic locks are
structurally unaffected: they are typically shorter than the 16-frame
window, so they still never produce a full consistent window (synthetic
locks of 4–15 frames below). Spread computation is now O(16).

## Synthetic gate-level scenarios (before → after)

Establish 110 Hz, glide up SPAN st in G frames, hold target 2 s:

| scenario | unwindowed (baseline) | windowed |
|---|---|---|
| +12 st in 100 ms | recovers 350 ms into hold | same (350 ms) |
| +12 st in 200 ms | recovers 325 ms | same |
| +19 st in 200 ms | recovers 275 ms | same |
| +19 st in 400 ms | recovers 225 ms | same |
| **+24 st in 400 ms (fast 2-oct siren)** | **NEVER RECOVERS (2 s hold fully blank)** | **recovers 200 ms into hold** |
| +24 st in 600 ms | paints throughout | same |
| harmonic locks 4/8/11/15 frames @380 Hz | 0 octave-class painted | 0 (unchanged) |
| instant 110→220 jump | accepted at 16 frames | 16 (unchanged) |

The only behavioral change is the trapped case; every other scenario is
identical before/after.

## Session regression check

The harness also replays a private session recording through the
production display chain (`--skip-session` omits it). Results on the
private session recordings are kept outside this repository.

## Tests

`tests/audio/pitch-paint-gate-test.js`: +2 regression cases (fast
+24 st siren's held target paints within EXCURSION_SUSTAIN frames;
keeps painting after accept). 15/15 pass; lint + build green.

## Reproduction

```
node scripts/paint-gate-glide-validate.js [--skip-session]
node tests/audio/pitch-paint-gate-test.js
node scripts/pitch-median-window-sweep.js [--wav=PATH]
```
