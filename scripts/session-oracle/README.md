# Session oracle

Reproducible end-to-end pitch oracle on real practice sessions (2026-10-03,
target-voice half-pitch pass). It runs the **production code itself** — the
real `src/dsp/pitch-worker.js`, the real `src/dsp/dsp-worker.js` and the
real main-thread display decision (`src/audio/useAudioPipeline.js`
`handleAnalysisResult`) — over a session WAV at production cadence, and
scores every stage against independent references:

| stage | what it is |
|---|---|
| `fl` | frame-local argmax of the detector's candidates |
| `dec` | bounded-Viterbi path-tracker decode (before ghost veto / above-range null / harmonic guard) |
| `post` | the pitch the worker posts to the main thread |
| `paint` | the value painted on the live trace |
| `ro` | the readout (Hz) in the hook's React state, incl. dim held readouts |
| `paintA` / `roA` | the same, alice-only display pass (non-Alice hops replaced by a pitchless frame at the session's 10th-percentile intensity — "practising alone with the room noise left in") |

Decision data: [measurements/target-voice-combined-validation-2026-10-03.md](../../measurements/target-voice-combined-validation-2026-10-03.md).

## Files

| file | role |
|---|---|
| `lib/chain.mjs` | drives the real workers + hook over one audio stream (25 ms chunks, both workers fed the same chunk, each DSP frame consuming the latest pitch message) |
| `lib/hooks.mjs`, `lib/register.mjs`, `lib/react-mock.mjs` | Node loader: one-render React mock, Vite-style extensionless imports |
| `lib/tap-boersma.mjs` | observation-only shim between `pitch-worker.js` and the real `boersma-ac.js` that records frame-local and decoded values (the worker never posts them). Return values pass through untouched |
| `lib/wav.mjs` | 16-bit PCM reader |
| `run.mjs` | session runner → `build/session-oracle/runs/<tag>/<session>.hops.f32` + `.meta.json` |
| `build_refs.py` | references → `build/session-oracle/refs/<session>.npz` (+ `.spk.json` for the alice-only pass) |
| `subharmonic.py` | spectral odd-multiple arbiter |
| `analyze.py` | band tables, switch latency, spike events, arbiter checks |
| `corpus.mjs` | FDA / PTDB-TUG / Hillenbrand / vocadito through the same chain, per file, worker + displayed level |

## Data

- Sessions: `C:/Coding Projects/private-session/sessions/<YYYY-MM-DD>/session.wav`
  (16 kHz mono) and the private-session frame table
  `acoustic/frames_enrollment-2026-05-07-v2.parquet` (speaker labels
  alice / second / outside, private-session `f0_hz` = Praat AC 100–500, "R1").
  Sessions 2025-09-08, 2026-05-07, 2026-05-26 are tuning sessions;
  **2026-06-09 is held out**. Not in the repo (personal recordings).
- Corpora: `tests/dsp/data/` (`corpora.js` loaders; PTDB-TUG and FDA audio are
  fetched by `scripts/fetch-ptdb-tug-subset.sh` / `scripts/fetch-fda-subset.sh`).
- All outputs go to `build/session-oracle/` (gitignored).

Python: `numpy pandas pyarrow soundfile praat-parselmouth`; PENN references
additionally need `torch` + `penn` (CPU is fine, ~20 min per session).

## Commands (repo root)

```bash
# 1. references (Praat AC/SHS/CC + consensus + strict + arbiters; PENN optional)
python scripts/session-oracle/build_refs.py --penn            # full rebuild (~20 min/session for PENN)
python scripts/session-oracle/build_refs.py --penn-from=DIR   # reuse <DIR>/<session>.penn.npz (t, f0)

# 2. run the production chain of any src tree over the four sessions
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
  --src=src --tag=head --refs=build/session-oracle/refs
#    a baseline / any commit: extract its src first
mkdir -p build/trees/base && git archive <rev> src | tar -x -C build/trees/base
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
  --src=build/trees/base/src --tag=base --refs=build/session-oracle/refs
#    (one session per process parallelises well: --sessions=2026-06-09)

# 3. score (first tag = baseline)
python scripts/session-oracle/analyze.py base head

# 4. corpora through the same chain (shard for speed), then the report
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/corpus.mjs \
  --corpus=hil --src=src --tag=head --shard=0/2      # fda | ptdb | hil | voc
node scripts/session-oracle/corpus.mjs --report=base,head
```

## Conventions (2026-10-03)

- **References**: `cons` (primary) = majority over the AC family (session-label R1 /
  Praat AC 50–600; a family supports a value if either member is within 5 %),
  Praat SHS and PENN; ≥ 2 families within 5 %, octave ties dropped, Praat
  voicing required. `strict` = session-label R1 where Praat CC agrees within 5 %.
  `cons_arb` = `cons` minus frames whose octave the arbiter disputes. `r1` =
  session-label R1 alone (what the 2026-10-03 detector-octave file called
  "strict"). PENN runs only on Alice spans with any reference ≥ 140 Hz plus
  ~150 s of second voice, so `cons` outside those spans is a 2-of-2 AC/SHS
  agreement.
- **Alignment** (phase-1 alignment sweep): the value describing audio at
  reference time t is at hop `round((t + 0.040 + lag·hop + δ)/hop − 1)`,
  lag = L (2) for display stages, δ = 0 (worker) / +30 ms (display).
- **Classes**: correct |q−1| < 0.05, half |q−0.5| ≤ 0.05, up |q−2| ≤ 0.2,
  up3 ×3/×4, null. Bands 75–110, 110–160, 160–200, 200–260, 260–400, ≥ 400
  (`cons`/`strict` are capped near 600 Hz), plus 160–400 / 75–160.
- **Switches / events**: see the header of `analyze.py`.

## Verification (2026-10-03)

- On origin/main (f92b11a) src the runner reproduces the phase-1
  `chain-harness.js` baseline bit-exactly on every worker column
  (frame-local, decoded, posted, confidence, notch count) and the DSP
  intensity of all 429 019 hops; painted differs on 26 hops, all on the
  400 ms hold boundary where the chain harness's unrounded timestamps
  refuse a hold the real hook (which rounds) allows.
- `analyze.py` then reproduces the phase-1 production baseline exactly:
  Alice 160–400 Hz decoded 88.37 % correct / 8.92 % half (cons, pooled),
  displayed 58.52 % correct / 32.71 % blank.
- `build_refs.py` reproduces the cached phase-1 Praat contours bit-exactly and
  the consensus / strict / arbiter tracks with 0 mismatches.
- The tap is observation-only: with `SO_TAP=0` the posted pitch, confidence,
  notch count, intensity, painted, readout, style and recorded columns are
  identical (5 min of 2026-05-26).

## Fixes (2026-10-04)

- `conn12` for the alice-only pass (`paintA`) ignored that pass's line breaks
  and over-counted connected ≥ 12 st pairs the trace never stroked (63 per
  33 painted minutes on the combined chain vs 0 as rendered). `run.mjs` now
  records `brkA`; `analyze.py` scores `paintA` against it (NaN for older runs
  without the column). The committed measurements quote only the `paint`
  pass's `conn12`, so no published number changes. All other columns of a
  re-run are bit-identical.
