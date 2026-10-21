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
| `lib/voice-gate.mjs` | the `--voice-gate` option of `run.mjs` / `corpus.mjs` (2026-10-21): the same chain with the real FireRedVAD model in the real pitch worker and the detector's decisions fed to the real hook, gate on vs off (below) |
| `lib/hooks.mjs`, `lib/register.mjs`, `lib/react-mock.mjs` | Node loader: one-render React mock, Vite-style extensionless imports |
| `lib/tap-boersma.mjs` | observation-only shim between `pitch-worker.js` and the real `boersma-ac.js` that records frame-local and decoded values (the worker never posts them). Return values pass through untouched |
| `lib/wav.mjs` | 16-bit PCM reader |
| `run.mjs` | session runner → `build/session-oracle/runs/<tag>/<session>.hops.f32` + `.meta.json` |
| `build_refs.py` | references → `build/session-oracle/refs/<session>.npz` (+ `.spk.json` for the alice-only pass) |
| `subharmonic.py` | spectral odd-multiple arbiter |
| `analyze.py` | band tables, switch latency, spike events, arbiter checks |
| `corpus.mjs` | FDA / PTDB-TUG / Hillenbrand / vocadito through the same chain, per file, worker + displayed level |
| `lowband-attr.mjs`, `lowband_attr.py`, `lowband_score.py` | low-register voicing pass (2026-10-04): per-hop stage dump (top-8 candidates, unvoiced strength, decode, guard verdict, posted, painted) over sessions + corpora; stage attribution of misses; band / octave / VDE / max(F,M) scores |
| `noise-fv.mjs` | noise-only false voicing through the real chain, every committed noise-synth class, posted + painted (`--seeds=N` pools generator seeds) |
| `session_fv.py` | real-session false voicing: hops >= 0.3 s from any Praat AC / CC / R1 voicing, posted + painted. Run with every voicing / guard change |
| `guard-probe.mjs`, `guard_probe.py` | every harmonic-guard call of the real worker with per-harmonic prominence under the production and inter-harmonic floors; frame-level rule-design table |
| `lowband/` | the 2026-10-04 variant trees (`variants.py`), runner (`run_variant.sh`), guard table (`table.py`) and summary (`summary.py`) — private measurement, kept outside this repo |

## Data

- Sessions: `$SYRINX_SESSIONS_DIR/<YYYY-MM-DD>/session.wav`
  (16 kHz mono) and the session label table
  `acoustic/frames_enrollment-2026-05-07-v2.parquet` (speaker labels
  alice / outside / unknown plus one label for the second voice in the
  recordings, code `second` here; session-label `f0_hz` = Praat AC 100–500, "R1").
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
python scripts/session-oracle/build_refs.py --praat-from=build/session-oracle/refs --penn-from=DIR  # + reuse the Praat cache

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

## Voice gate (`--voice-gate`, 2026-10-21)

The shipped pitch display has a voice gate ("Hide pitch when no voice is
heard", on by default; `src/dsp/firered-vad.js`): the pitch worker runs
FireRedVAD on its 16 kHz stream and tags each pitch message with a
decision, and the hook hides the pitch display while the decision is "no
voice". Without the option the oracle drives the hook with no decisions,
which is the display with the setting off. With it:

- the REAL pitch worker loads the REAL model through its test seam
  `setVadModelLoaderForTests` (only the loading differs from the app:
  onnxruntime-web's WASM build in Node, the files from the local copy
  `build/models/firered/` — `node scripts/fetch-firered-model.mjs`);
- the worker phase runs with a frozen `performance.now`, so the detector
  never switches itself off as "slow" (a device that keeps up); any detector
  status other than "ready" aborts the run;
- the REAL hook is driven twice from the same worker run: with each
  message's decision in `latestPitchRef` (gate on → `<tag>`) and without
  (gate off → `<tag>-gateoff`). A `vadv` column records the decision each
  display hop consumed.

```bash
node scripts/fetch-firered-model.mjs     # once: the local model copy
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
  --src=src --tag=head --refs=build/session-oracle/refs --voice-gate      # -> head/, head-gateoff/
python scripts/session-oracle/analyze.py head-gateoff head
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/corpus.mjs \
  --corpus=voc --src=src --tag=head --voice-gate                          # -> head, head-gateoff, head.voice-gate
node scripts/session-oracle/corpus.mjs --report=base,head-gateoff,head
```

`corpus.mjs --voice-gate` also writes `<tag>.voice-gate/`: decision counts,
late messages, mask violations (a gate-on painted value that differs from
gate off — must be 0: the gate only hides) and false painting / readout on
reference-unvoiced hops, gate off → on. `--report` prints them and says
whether each tag's counts are identical to the first tag's in every
stage × group × band.

**Check (2026-10-21, vocadito, src of `voice-gate-followup`):** it
reproduces the voice-gate merge's corpus check (run then with an
uncommitted driver) exactly — every cell of `--report=plain,head-gateoff,head`
identical (plain = the oracle without the option; e.g. all < 400 Hz
correct 98.53 / 98.31 / 97.34 / 97.43 % at dec / post / paint / readout),
31 222 "voice" / 1 228 "no voice" / 0 undecided messages, no late message,
no mask violation, false painting on reference-unvoiced hops 52.56 →
51.81 % (vocadito_34: 45.42 → 38.93 %). `run.mjs --voice-gate` on a public
clip: every column of the gate-off pass equals the run without the option.
The gate-on pass differs only in `paint`, `ro` and (since the 2026-10-21
review fix below) `style`: on the hops the gate hides, and on hops where
the detector says "voice" but the dim held readout stays blank because the
gate hid the painted frames before it (`gateHidPaintRef`, intended; 7 hops
on vocadito_34).

**Fix (2026-10-21, review):** `style` (and `styleA`) read the raw
`voiced` / `holding`, so in the gate-on pass it equalled gate off on every
hop. It now records what the pitch display shows, `pitchVoiced` /
`pitchHolding` (falling back to `voiced` / `holding` for trees without
them; identical without a decision, so runs without `--voice-gate` do not
change). No analysis reads `style`, so no published number changes.

## Conventions (2026-10-03)

- **References**: `cons` (primary) = majority over the AC family (session-label R1 /
  Praat AC 50–600; a family supports a value if either member is within 5 %),
  Praat SHS and PENN; ≥ 2 families within 5 %, octave ties dropped, Praat
  voicing required. `strict` = session-label R1 where Praat CC agrees within 5 %.
  `cons_arb` = `cons` minus frames whose octave the arbiter disputes. `r1` =
  session-label R1 alone (what the 2026-10-03 detector-octave file called
  "strict"). PENN runs only on Alice spans with any reference ≥ 140 Hz plus
  ~150 s of the second voice, so `cons` outside those spans is a 2-of-2 AC/SHS
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
  intensity on every hop of the private session recordings; painted
  differs only on a handful of hops, all on the 400 ms hold boundary
  where the chain harness's unrounded timestamps refuse a hold the real
  hook (which rounds) allows.
- `analyze.py` then reproduces the phase-1 production baseline exactly
  (results on the private session recordings are kept outside this
  repository).
- `build_refs.py` reproduces the cached phase-1 Praat contours bit-exactly and
  the consensus / strict / arbiter tracks with 0 mismatches.
- The tap is observation-only: with `SO_TAP=0` the posted pitch, confidence,
  notch count, intensity, painted, readout, style and recorded columns are
  identical (5 min of 2026-05-26; the alice-only columns too since the
  2026-10-04 lookback fix below).

## Fixes (2026-10-04)

- `conn12` for the alice-only pass (`paintA`) ignored that pass's line breaks
  and over-counted connected ≥ 12 st pairs the trace never stroked (vs 0 as
  rendered). `run.mjs` now
  records `brkA`; `analyze.py` scores `paintA` against it (NaN for older runs
  without the column). The committed measurements quote only the `paint`
  pass's `conn12`, so no published number changes. All other columns of a
  re-run are bit-identical.
- `SO_TAP=0` runs stored `lookback: null` (only the tap reported the tracker's
  L), so the alice-only mask silently used L = 0 and `analyze.py` crashed.
  `lib/chain.mjs` now falls back to the src tree's `PATH_DEFAULTS.lookback`
  (what the worker's `createPathTracker()` uses) and `analyze.py` drops the
  tap-only columns (`fl`/`c0f`/`uv`/`dec`, all-zero placeholders) of untapped
  runs. Check: 5 min of 2026-05-26, tapped vs untapped — every non-tap column
  identical, **including `paintA` / `roA` / `styleA` / `brkA`**.
- `build_refs.py --praat-from=DIR` read `<DIR>/<session>.npz`, but the script
  caches Praat contours as `<session>.praat.npz` (`<session>.npz` is its
  reference output, without `ac_t`), so it could not reuse its own cache. It
  now reads `<DIR>/<session>.praat.npz`, falling back to the legacy layout.
  `--praat-from=build/session-oracle/refs` reproduces `t`, `spk`, `cal`, `ac`,
  `shs`, `cc` and `strict` of the cached refs bit-exactly (2026-05-07).
