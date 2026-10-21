# Voice gate: the resonance row follows the gate (2026-10-21)

Branch `voice-gate-followup` (from `cue-strip` 1a1713f). Public data and
synthetic stimuli only; the private check is descriptive and its results
are kept outside this repository.

## Why

Review of the merged voice gate (FireRedVAD, setting "Hide pitch when no
voice is heard (experimental)", on by default): the Dashboard resonance
row ("Resonance · approx.") takes its state from the RAW pitch display
flags (`useAudioPipeline`: `voiced: displayPitched`, `holding:
displayHolding` → `cueStripModel.js` `resonanceRowState` / `dotOpacity` /
`resonanceHeader`). The gate only hides the pitch row's own flags
(`pitchVoiced` / `pitchHolding`). So with the gate on, noise that the pitch
chain voices still takes the resonance row out of "idle": "keep talking…"
with nobody speaking (the review estimated 28–54 % of noise-only time), and
a held vowel the detector hides shows "keep talking…" instead of "needs
running speech".

User decision 2026-10-21: make the resonance row not react to noise.

## Plan (pre-registered, 2026-10-21, before any result)

**Candidate (CAND).** While the gate setting is on and the detector is
ready (not missing / slow / loading), the resonance row's `voiced` /
`holding` come from the gated pitch display flags `pitchVoiced` /
`pitchHolding` — the ones that drive the hidden pitch line and the pitch
row. Otherwise exactly as now. **BASE** = `cue-strip` 1a1713f (the row on
the raw flags). The resonance worker and its gated pitch hint are the same
in both, so where both draw a dot it is the same position. The gated flags
are never true where the raw ones are false, so CAND's row state is always
BASE's state or "idle"; the run measures how often, and where.

**Driver.** `scripts/resonance/voice-gate-resonance.mjs --row` (extends the
driver of [noise-detector-tryout-resonance-2026-10-21.md](noise-detector-tryout-resonance-2026-10-21.md)):

- the REAL pitch worker with the real FireRedVAD model (test seam
  `setVadModelLoaderForTests`, ready before the first chunk), 1200-sample
  chunks at 48 kHz;
- the REAL resonance worker, twice: ungated hint and gated hint (as before);
- the REAL DSP worker (intensity for the silence gate);
- the REAL hook (`useAudioPipeline` `handleAnalysisResult`, the session
  oracle's React mock, gate setting on): one DSP frame per chunk, each
  consuming the latest pitch message and its detector decision; per chunk
  the raw `voiced` / `holding` and the gated `pitchVoiced` / `pitchHolding`;
- the REAL row logic (`cueStripModel.js`: `resonanceRowState`, `dotOpacity`,
  `rowValue`, `resonanceClamp`, `axisPos`, `resonanceHeader`) on the latest
  resonance `state` post, every 25 ms chunk, three arms:
  - **PRE**: ungated hint, raw flags (before the merge);
  - **BASE**: gated hint, raw flags (1a1713f);
  - **CAND**: gated hint, gated flags.
- Workers run with a frozen `performance.now` (no overload / "slow"
  switch-off: a device that keeps up); the hook with the session oracle's
  clock (+1 s per call: its 200 ms state throttle never drops a frame).

**Audio.** The same sets as the earlier note, regenerated with
`scripts/resonance/voice-gate-prep.py` (same counts as that note): N1 tuning
noise (166 streams, 14 069 s), N2 fresh noise (103, 6 341 s), S1 LibriSpeech
(40 readers, 20 / 20, 2 637 s), S2 PTDB-TUG (17 streams, 1 219 s), S3 FDA
(5 streams, 332 s), H1 synthetic holds (24, made by the driver), H2 PVQD
held /a/ and /i/ (97 recordings, 2 284 s), D1 speech then noise (10, 600 s).
Full sets: a timing probe (two synthetic holds, timing only) gives ~5×
real time per process; two processes → about 50 minutes. Streams run in a
fixed seeded order (`--shuffle=20261021`, then `--shard=i/2`); if the run
is not finished at 13:45 CDT it is stopped and the streams done by then (a
seeded random subset of every set) are the result, stated with their
counts.

**Metrics** (time = share of 25 ms chunks; per set, and per sex where the
set has one).

- Row states: share of time in each state, per arm.
- Noise only (N1, N2; per class and pooled):
  - row not idle = any state other than "idle" and "starting" ("starting…"
    is the 0.2 s before the worker's first post, the same in every arm);
  - drawn dot = `dotOpacity(state) !== null` and `u !== null` (what the
    CueStrip draws);
  - "keep talking…" = state "warming";
  - beyond the scale = a drawn dot pinned at an end: the vtln clamp OR u off
    the axis (below −1 or above 2.2; `axisPos(...).beyond !== 0`, the dot
    with the chevron); also the header text "beyond the scale" (states live
    / holding only).
  - BASE vs CAND, reduction = 1 − CAND / BASE; PRE shown.
- Speech (S1–S3): share of time CAND's state equals BASE's; the state
  changes where it differs; |Δu| between the drawn positions on chunks
  where both draw (median, p95); drawn-dot share BASE / CAND; time of the
  first drawn dot.
- Held vowels (H1 hold 0.5–4.5 s; H2 annotated holds): state shares inside
  the holds per arm; chunks where CAND draws a dot and BASE does not.
- D1 (information): state shares during the noise part.
- Detector: share of pitch messages with a decision (expected: all).

**GUARDS (must hold to build).**

1. Speech, each sex (S1–S3 pooled): CAND's row state identical to BASE's on
   ≥ 99 % of the time, and median |Δu| ≤ 0.02.
2. Held vowels (H1 + H2): no new drawn positions — no chunk where CAND draws
   a dot and BASE does not.

**REPORTED (no bar; the user already chose to build):** the noise-only
reductions.

**Correction of the earlier note.** The same run gives PRE vs BASE (the
earlier note's two arms) with corrected wording: the worker position (the
stored u, the earlier metric) next to the drawn dot; beyond the scale =
clamp OR off-axis; whether the gated hint was never worse than the ungated
one on any noise stream; and the "dot stays for the rest of the clip"
sentence (the worker keeps its position; the row draws it only while the
pitch display is voiced or holding). Written as a dated correction section
in [noise-detector-tryout-resonance-2026-10-21.md](noise-detector-tryout-resonance-2026-10-21.md).

**Private check.** The user's own room recording (PC fans and coil whine,
60 s, no speech) through the same driver (`--row --wav=`), descriptive;
results kept outside this repository.

## Results

(after the run)
