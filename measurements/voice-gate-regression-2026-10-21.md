# Voice gate (FireRedVAD): pitch regression check (2026-10-21)

Branch `firered-merge` (head 19279e0) against its base `cue-strip`
(9084946), with the voice gate **on**. The question: how much correctly
painted voice does the gate hide, per band (target 160–400 Hz, low
75–160 Hz) and per display stage (painted trace, readout)? Public corpora
only below. Results on the private session recordings are kept outside this
repository.

**Verdict:** no regression on the corpora. With the gate on, no correctly
painted or read-out value is hidden on FDA, PTDB-TUG, vocadito or
Hillenbrand, in either band. With the gate off, the head is bit-identical to
the base.

## Regression tests (CLAUDE.md checklist), on firered-merge

| test | result |
|---|---|
| `tests/audio/pitch-gate-test.js` | 26 / 26 |
| `tests/audio/pitch-paint-gate-test.js` | 112 / 112 |
| `tests/audio/display-hook-test.js` | 23 / 23 |
| `tests/audio/steadiness-test.js` | 45 / 45 |
| `tests/dsp/boersma-ac-test.js` | 41 / 41 |
| `tests/dsp/pitch-worker-above-range-test.js` | 7 / 7 |
| `tests/dsp/noise-notch-test.js` | 101 / 101 (the usual KNOWN LIMITATION lines) |

## Method

- **Trees.** Base = `git archive 9084946 src`. Head = this branch's `src`.
- **The committed session oracle does not run the detector.**
  `scripts/session-oracle/lib/chain.mjs` starts the pitch worker without
  `vad` in `init`. As the worker's header says, the detector then never runs,
  and the hook frames it builds carry no decision. So the oracle as committed
  measures the gate as "off".
- **A gate-on driver (not committed)** reuses the oracle's `loadSrc`, refs
  and scoring conventions. It replaces `runWorkers` / `buildFrames` /
  `driveHook` with versions that:
  - start the REAL pitch worker with `vad`;
  - load the model through the worker's own test seam
    `setVadModelLoaderForTests`. This uses onnxruntime-web (WASM) in Node with
    the app's `public/models/firered/` files and a fresh runner per stream.
    The worker's queue, detector and gate are the app's code;
  - wait for `vad-status: ready` before the first chunk, so every message
    carries a decision. In the app, the first moments after Start are not
    gated while the model loads, so this check is stricter than the app;
  - wait for each chunk's post (the worker's asynchronous path);
  - run the worker with a frozen `performance.now`. The oracle fakes the
    clock at +1 s per call for the hook's throttle, and the lag safeguard
    would otherwise switch the detector off as "slow". The results are
    therefore those of a device that keeps up;
  - put each message's `vad.voice` into `latestPitchRef` before
    `handleAnalysisResult`, as `handlePitchMessage` does, and drive the REAL
    hook twice on the same worker output: once with the gate on, once off.
- **Sanity checks, all passed:**
  - Every pitch message carried a decision (sessions and corpora), and no
    message arrived after its chunk.
  - Wherever the gated trace shows a value, it equals the ungated value
    (0 mismatches): the gate only hides.
  - Head with the gate off equals the base on every column of every session
    hop and on every corpus count.
  - On one vocadito track, the gate-off driver reproduces `corpus.mjs`
    exactly.
- **Corpus scoring:** `corpus.mjs` conventions (classes, alignment, the PTDB
  +20 ms offset). "Correct" = within 5 % of the reference.

## Corpora: correct % of reference-voiced hops, gate off / on

Posted = the worker's posted pitch (the gate never changes it). Painted =
the live trace. Readout = the Hz readout, including dim held values.
Removed = hops that are correct with the gate off but not with it on.

| group | band (Hz) | n hops | posted | painted | readout | removed |
|---|---|---|---|---|---|---|
| FDA men | 75–160 | 2134 | 85.73 / 85.73 | 83.32 / 83.32 | 83.32 / 83.32 | 0 |
| FDA men | 160–400 | 157 | 89.54 / 89.54 | 86.62 / 86.62 | 86.62 / 86.62 | 0 |
| FDA women | 160–400 | 2591 | 88.28 / 88.28 | 87.77 / 87.77 | 87.77 / 87.77 | 0 |
| PTDB-TUG men | 75–160 | 4438 | 85.82 / 85.82 | 82.65 / 82.65 | 82.90 / 82.90 | 0 |
| PTDB-TUG men | 160–400 | 139 | 90.51 / 90.51 | 82.73 / 82.73 | 82.73 / 82.73 | 0 |
| PTDB-TUG women | 75–160 | 273 | 85.71 / 85.71 | 70.33 / 70.33 | 70.33 / 70.33 | 0 |
| PTDB-TUG women | 160–400 | 4385 | 95.73 / 95.73 | 93.77 / 93.77 | 93.77 / 93.77 | 0 |
| Hillenbrand men | 75–160 | 5980 | 61.13 / 61.13 | 64.38 / 64.38 | 64.38 / 64.38 | 0 |
| Hillenbrand men | 160–400 | 756 | 54.69 / 54.69 | 57.28 / 57.28 | 57.28 / 57.28 | 0 |
| Hillenbrand women | 75–160 | 77 | 40.00 / 40.00 | 38.96 / 38.96 | 38.96 / 38.96 | 0 |
| Hillenbrand women | 160–400 | 8760 | 61.74 / 61.74 | 64.63 / 64.63 | 64.63 / 64.63 | 0 |
| vocadito (sung) | 75–160 | 5531 | 99.26 / 99.26 | 98.59 / 98.59 | 98.64 / 98.64 | 0 |
| vocadito (sung) | 160–400 | 15807 | 98.03 / 98.03 | 96.96 / 96.96 | 97.06 / 97.06 | 0 |

(FDA women 75–160 Hz has 17 hops, 0 % correct in every tree; it is left out.)

The base column is identical to "off" in every row and is not repeated. Each
Hillenbrand file is an isolated /hVd/ word that starts with the gate closed,
so word onsets are covered: nothing correct was hidden there either.

**False painting on reference-unvoiced hops** (% of those hops painted, gate
off → on): FDA men 63.53 → 63.53, FDA women 54.60 → 54.39,
PTDB-TUG men 14.39 → 14.38, PTDB-TUG women 15.81 → 15.81,
vocadito 52.56 → 51.81. These clean corpora have almost no non-speech
stretch longer than the 2 s hangover, so they cannot show the gate's
benefit. That benefit was measured in the screen and the confirmation
([offtheshelf-screen-2026-10-20.md](offtheshelf-screen-2026-10-20.md),
[firered-confirmation-2026-10-21.md](firered-confirmation-2026-10-21.md)).

## Private session recordings

Same driver over the four oracle sessions (references from `build_refs.py`
without PENN; `analyze.py` plus the `session_fv.py` definition applied to the
run outputs). In aggregate, the gate hid about 1 % of correctly painted
target-register (160–400 Hz) voice of the main speaker, at most 0.15 % in
every other band and speaker, and close to 40 % of the painting in
stretches no reference voices. Results on the private session recordings are
kept outside this repository.
