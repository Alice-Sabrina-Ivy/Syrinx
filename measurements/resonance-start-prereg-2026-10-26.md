# Resonance cue: a sooner "where you started" — pre-registration (2026-10-26)

Committed before any candidate result is computed (CLAUDE.md hard rule 3,
cue-strip modules). Root cause and the shipped rule's numbers:
[resonance-start-reference-2026-10-26.md](resonance-start-reference-2026-10-26.md).

## Question

The Dashboard's resonance column shows a start-relative word ("about where
you started" / "brighter than your start" / "darker than your start") only
once `startU` is set: the median of the readouts over the first
`START_COLLECT_S` = 12 s of admitted voiced speech after the 5 s readout
fills. On LibriSpeech reading that is a median ~31 / ~34 s of audio after
listening starts (women / men), ~22 s after the dot goes live; meanwhile the
header says "finding your start…". Can the words come sooner without
making an unchanged voice read "brighter / darker than your start" more
often, and without changing the pitch-only warning?

## Data

- **Primary:** LibriSpeech test-clean, all 40 readers (20 F / 20 M), each
  one stream built like the cue-strip smoke's `speech-*.wav`
  (`scripts/cue-strip-smoke-wavs.mjs`): the reader's 25 utterances of
  `rlab.loaders.libri_pool("test-clean", 25)` in stream order, 0.3 s gaps,
  x3 to 48 kHz, peak 0.5 (~200 s each). The same streams the root-cause
  measurement used (its shipped-rule numbers are the baseline S0).
- **Confirmation:** LibriSpeech dev-clean, all 40 readers (20 F / 20 M),
  same recipe (`libri_pool("dev-clean", 25)`). The selected candidate must
  pass every guard here too; if it fails, nothing ships and the note says so.
- Chain: `scripts/resonance/start-reference.mjs` — the REAL pitch worker with
  the real FireRedVAD model, the posted hints relayed as the hook relays
  them, the resonance worker's chain (lab engine "frames" mode, narrowband
  detector, resonance cue) replayed as the worker runs it (checked against
  the REAL resonance worker: startU / fill / voicedS equal at every 0.2 s
  post). **Arm "gated"** (voice gate on, the app default) decides; the
  ungated arm is reported.
- Each stream is an unchanged voice. Its long-run value = the median of the
  plain 5 s readout (`uPlain`) over the stream's second half.

## Row model (for the words)

Per 0.2 s worker post, `cueStripModel.js` `resonanceRowState` and
`resonanceHeader` on the post (u withheld until the narrowband detector
decided, as the worker posts), with voiced = the newest relayed hint's
`voiced` (gated) and holding = a voiced hint within the last 5 s (the
hook's silence hold), workerStatus "ready". A **word post** = state live or
holding and a header among the three start-relative words. A **false word**
= a word post saying brighter / darker (every stream is an unchanged voice).

## Candidates

The final `startU` is unchanged in P0–P6 (the pitch-only warning reads
`startU`); they add a **shown start** used only by the header and the start
ring: `startU` when set, else — once the collection has `k` s of admitted
voiced time — the median of the readouts collected so far (the same
samples the final start is the median of; it becomes the final start
exactly when the shipped rule sets it).

| id | shown start before `startU` | final `startU` |
|---|---|---|
| S0 | none ("finding your start…") — shipped | shipped |
| P0 | provisional from the first full readout (k = 0) | shipped |
| P2 | provisional after k = 2 s of collection | shipped |
| P4 | provisional after k = 4 s | shipped |
| P6 | provisional after k = 6 s | shipped |
| C6 | none | median of the readouts over the first **6 s** (not 12) |

## Target

T: the time (audio s from the start of listening) of the first word post,
median over readers, **≤ 20 s for women and for men** (S0: ~31 / ~34 s).

## Guards (each for women and for men separately; the worse decides)

- **G1 start accuracy:** q90 over readers of |final startU − long-run| ≤
  S0's + 0.05 u.
- **G2 false words, whole span:** false-word share of word posts, pooled
  over readers, from each reader's first word post to the stream's end ≤
  S0's + 2.0 points.
- **G3 false words, early span:** the same share over the posts from the
  candidate's first word post up to S0's first word post for that reader
  (the time the candidate adds) ≤ S0's whole-span share + 5.0 points.
- **G4 switch jump:** q90 over readers of |shown start on the post before
  `startU` is set − `startU`| ≤ 0.30 u (the header's dead band), so the
  words rarely change at the switch.
- **G5 pitch-only warning:** the `startU` series of every stream (value and
  time) bit-identical to S0's. A candidate that changes it (C6) is eligible
  only if the pitch-only warning's study harness
  (`scripts/heard-as/pitch-only/`) is re-run and its pre-registered checks
  still hold; if that is not done, C6 is measured and reported only.

## Selection rule

Among the candidates that meet T and pass G1–G5 for both sexes on the
primary set, pick the one with the lowest max-over-sexes median first-word
time; within 0.5 s of it, the larger k (the more conservative). Then the
confirmation set: the pick must pass G1–G5 there too (T is reported, not
required). If no candidate qualifies, nothing changes in the cue; the
fallback is a progress hint in the header text ("finding your start… N %"
from `startProgress`), which is a UI-text change only.

## Reported, no bar

Time to first word q90; the ungated arm; the gate's effect on S0; the
words' share over the early span by reader; what the user sees meanwhile.
