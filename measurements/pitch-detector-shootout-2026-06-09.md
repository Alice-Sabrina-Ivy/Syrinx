# Pitch-detector shootout: SwiftF0 vs half-period referee vs Praat-style AC — 2026-06-09

Follow-up to [swift-f0-vs-praat-sessions-2026-06-09.md](swift-f0-vs-praat-sessions-2026-06-09.md)
(SwiftF0 confidently octave-ups on weak-fundamental low-F0 phonation;
25.6 % octave-up in the user's 80–110 Hz register). User direction:
"maybe we should fall back to a Praat-like pitch detector instead of an
ML based one" + green light to evaluate the half-period referee.

Both candidates evaluated on identical frames, plus two ensembles. One
extraction pass per dataset (`scripts/pitch-shootout-extract.js`) over:

- **Four corpora** (laryngograph/expert ground truth; the independent
  oracle): per-hop production streaming sim, 112 913 scored frames.
- **2026-05-26 user session** (53 min real voice, Praat reference,
  126 689 hops). Caveat: AC-vs-Praat agreement carries methodological
  affinity (same algorithm family); corpus ground truth is the
  independent check against tuning toward Praat's own biases.

Configurations:

- `swift` — production SwiftF0, confidence gate 0.5.
- `swift+referee@m` — when SwiftF0 reports p ≥ 100 Hz, compute
  normalized autocorrelation on the same 1024-sample buffer at the
  period of p (r_T) and at twice that period (r_half); report p/2 when
  r_half ≥ r_T − m. Margin swept post-hoc from cached (r_T, r_half).
- `boersma-ac` — frame-local Praat-style AC detector
  ([tests/dsp/boersma-ac.js](../tests/dsp/boersma-ac.js)): Boersma-1993
  window-corrected normalized autocorrelation, Praat-default costs
  (voicingThreshold 0.45, octaveCost 0.01), floor 50 / ceiling 600 Hz,
  NO path search (frame-local lower bound on Praat-like quality).
- `E1` — swift+referee@−0.02; SwiftF0 nulls filled with AC output.
- `E2` — AC primary; AC nulls filled with refereed SwiftF0.

## Results

### User session, 80–110 Hz band (the reported failure regime)

| config | correct % | octave-up % | null % | flip % (Praat self: 4.3) |
|---|---|---|---|---|
| swift (production) | 49.1 | 25.6 | 19.1 | 5.5 |
| swift+referee@−0.02 | 62.7 | 10.6 | 19.1 | 10.2 |
| boersma-ac | 73.0 | 9.5 | 3.8 | 14.0 |
| **E1 (referee + AC null-fill)** | **74.3** | **13.1** | **1.9** | 11.4 |
| E2 (AC primary) | 74.3 | 9.7 | 1.9 | 12.3 |

(Baseline's low flip rate is deceptive — it sits *consistently* on the
wrong octave for long runs. The display median absorbs 1–2-frame flips;
sustained wrong runs are what users see as 2× errors.)

### Corpora (ground truth) — correct % / octave-up % / octave-down % / null %

| corpus | swift | swift+ref@−0.02 | boersma-ac | E1 | E2 |
|---|---|---|---|---|---|
| fda | **90.2** /0.0/0.0/4.6 | 89.3 /0.0/1.1/4.6 | 68.8 /0.6/1.5/14.7 | 89.4 /0.2/1.2/3.1 | 77.9 /0.6/2.0/3.1 |
| hillenbrand | 61.8 /0.1/0.1/7.2 | 61.0 /0.0/1.3/7.2 | 58.4 /2.4/2.4/5.8 | 61.8 /0.8/1.4/3.6 | 59.1 /2.4/2.5/3.6 |
| ptdb-tug | 74.5 /0.3/0.0/5.6 | 73.8 /0.2/1.0/5.6 | 86.1 /0.5/1.8/9.2 | 76.4 /0.3/1.2/2.5 | **90.1** /0.6/1.9/2.5 |
| vocadito | **97.8** /0.4/0.1/1.1 | 96.8 /0.0/1.4/1.1 | 87.7 /0.1/3.4/5.2 | 97.2 /0.0/1.6/0.5 | 92.3 /0.1/3.4/0.5 |

(Hillenbrand "other" runs ~31 % for every config — artifact of the ±5 %
tolerance against the synthetic central-70 % steady reference;
comparative use only.)

### Referee margin sweep (why −0.02)

Positive margins are catastrophic (margin +0.05: vocadito octave-down
62.6 %, fda 24.0 % — raw AC's subharmonic bias unleashed). Margin must
require r_half **strictly greater** than r_T. At −0.02: session
octave-up 25.6→10.6 %, corpus cost ≈ +1.0–1.4 pp octave-down, vocadito
correct 97.8→96.8. At −0.05 the correction halves in strength. −0.02
is the knee.

### Compute cost

Boersma AC: **0.113–0.119 ms/frame** (Node, same order in browser JS) —
~50–100× cheaper than SwiftF0's browser-WASM inference (5–11 ms). The
referee adds two lag correlations ≈ 0.05 ms. Cost is a non-issue for
any configuration, including running both detectors on every hop.

## Interpretation

1. **The half-period referee transfers to the real-voice regime** (the
   May negative finding was specific to synthetic dominant interferers,
   as hypothesized): −59 % octave-up at ~1 pp corpus cost. But alone it
   can't touch the null problem (19 % of voiced frames in-band).
2. **Frame-local Praat-style AC is shockingly competitive for 0.12
   ms/frame**: it beats SwiftF0 outright on PTDB-TUG (86.1 vs 74.5) and
   on the user's actual voice, but in v0 form regresses FDA (68.8 vs
   90.2) and vocadito/singing (87.7 vs 97.8) and flips more without
   path search. "Replace the ML detector entirely" is not yet supported
   by ground truth — SwiftF0 is still clearly better on two of four
   corpora.
3. **E1 dominates the baseline almost everywhere**: session correct
   49→74 %, null 19→2 %, octave-up 26→13 %, while corpus correct stays
   within 0.8 pp of baseline on fda/vocadito, improves on ptdb-tug and
   null-rate everywhere. It uses SwiftF0 where SwiftF0 is strong and AC
   where SwiftF0 is blind.

## Recommendation

Integrate **E1** into pitch-worker.js: per hop, run SwiftF0 as today;
when it reports ≥ 100 Hz, apply the half-period referee at margin
−0.02; when it reports null, fall back to Boersma-AC output (with its
own voicing decision). Total added cost ≈ 0.17 ms/hop. Longer term, if
the residual 13 % in-band octave-up matters, add bounded-lookback path
search to the AC side (prior art: the retired pYIN L=4 Viterbi) —
that's also the upgrade path toward the user's "Praat-like fallback"
end state, pending tuning that closes the FDA/vocadito gap.

Open items before production: hysteresis/path-search decision for flip
suppression (frame-local flip rates are 2× baseline; the 5-frame
display median masks single flips but a 2–3-frame run flips the
median), and a re-run of the session comparison post-integration as
acceptance.

## Reproduction

```
node scripts/pitch-shootout-extract.js --corpora build/pitch-compare/shootout-corpora.json
node scripts/pitch-shootout-extract.js --wav=<SESSION.wav> --praat=build/pitch-compare/praat-contours.json \
    build/pitch-compare/shootout-session.json
python -u scripts/pitch-shootout-analyze.py build/pitch-compare/shootout-corpora.json \
    build/pitch-compare/shootout-session.json measurements/pitch-detector-shootout-2026-06-09.json
```
