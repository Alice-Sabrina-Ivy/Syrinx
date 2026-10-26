# Resonance cue: why "finding your start…" lasts ~30 s, and a sooner start (2026-10-26)

Public data only (LibriSpeech test-clean and dev-clean, CC BY 4.0). Pre-registration:
[resonance-start-prereg-2026-10-26.md](resonance-start-prereg-2026-10-26.md)
(committed 42c6881 before any candidate result; sha256 0ce40d83…).

## 1. Symptom

The Dashboard's Resonance column shows its start-relative words ("about
where you started" / "brighter than your start" / "darker than your start")
only once the resonance cue has `startU`; until then the header says
"finding your start…". In `scripts/cue-strip-smoke.mjs --viewport=desktop`
on the owner's PC the column still said "finding your start…" after the
part-1 speech sample of `speech-woman.wav`.

## 2. Method

- **Streams.** All 40 test-clean readers (20 F / 20 M), each built exactly
  like the smoke's `speech-*.wav` (`scripts/cue-strip-smoke-wavs.mjs`: the
  reader's 25 utterances of `libri_pool("test-clean", 25)`, 0.3 s gaps, x3 to
  48 kHz, peak 0.5; 160–230 s each). Reader `ls121` is the smoke's woman,
  `ls1089` its man. Confirmation: all 40 dev-clean readers, same recipe.
  These streams have only the utterances' own pauses and the 0.3 s gaps —
  reading with natural pauses, an unchanged voice throughout.
- **Chain** ([scripts/resonance/start-reference.mjs](../scripts/resonance/start-reference.mjs)):
  the REAL pitch worker with the real FireRedVAD model (the voice gate's
  detector, test seam `setVadModelLoaderForTests`, frozen clock so it never
  switches itself off as "slow"), 1200-sample chunks; its posted hints
  relayed as the hook relays them — arm **gated** = `voiced: false` on hops
  the gate hides (setting on, the app default), arm **ungated** = the posted
  hint (setting off). The resonance worker's chain (lab engine "frames" mode,
  narrowband detector on voiced grid frames, `resonanceCue.js`) is replayed
  as `resonance-worker.js` runs it, and the REAL resonance worker runs beside
  it on the gated arm: `startU`, `fill`, `voicedS` (and, after the change,
  `shownStartU`) equal at all 37 799 posts of the 40 streams, 0 mismatches.
  Every bin's drop reason is logged (held note / onset being watched / latch
  after a held note / narrowband), and the cue's start collection is
  replicated from its snapshot and checked against its `startU` on every bin.
- **Words.** Per 0.2 s post, `cueStripModel.js` `resonanceRowState` +
  `resonanceHeader` on the post as the worker sends it (position withheld
  until the narrowband detector decided), voiced = the newest relayed hint,
  holding = a voiced hint within 5 s (the hook's silence hold).
- **Built app** ([scripts/resonance/start-reference-browser.mjs](../scripts/resonance/start-reference-browser.mjs)):
  `vite preview` of `dist/`, Chrome for Testing 1243 (headless, fresh profile,
  PID-scoped cleanup), fake mic = `speech-woman.wav` / `speech-man.wav`,
  first visit answered as the smoke does (masculine, "Likely heard as" on by
  default), the row and the resonance worker's posts read every 0.5 s.

## 3. Root cause: the start rule is slow by design; nothing resets or stalls it

`startU` is the median of the readouts over the first `START_COLLECT_S` =
12 s of **admitted voiced** time after the 5 s **voiced** readout fills, so
it needs ~17 s of voiced speech. Reading is ~52–60 % voiced on the
readout's clock (median per stream: men 0.52, women 0.60), so the collection
alone takes a median 21.6 / 23.4 s of audio (women / men) after the dot goes
live. The 2026-10-07 note's "12 s of voiced speech is about 20 s of live
reading" was about right; the start then comes ~30–34 s after listening
starts, ~3× the 9–11 s the row needs to go live.

Nothing else contributes on this material:

| | women (20) | men (20) |
|---|---|---|
| readout full (dot live), audio s, median / q90 | 8.9 / 10.8 | 10.8 / 13.1 |
| narrowband detector decided, median s | 5.1 | 5.8 |
| **startU set, audio s, median / q90 / max** | **30.6 / 35.8 / 40.0** | **33.8 / 40.7 / 44.1** |
| startU − fill, median s | 21.6 | 23.4 |
| bins dropped: onset watched / latch after held / held / narrowband | 643 / 237 / 66 / 0 of 26 224 (3.6 %) | 675 / 29 / 7 / 0 of 30 450 (2.3 %) |
| narrowband turned on, readout restarts after idle | 0, 0 | 0, 0 |

(test-clean, gated arm.) Dev-clean: startU at 30.3 / 36.5 s (women, median /
q90) and 33.1 / 43.0 s (men).

- **Voice gate: not a cause.** Gated vs ungated: the same medians and q90s
  to 0.1 s; 5 of 40 readers' start moves, by 0.2–0.9 s, and the dropped-bin
  counts differ by 2 bins in total. On clean reading the gate hides almost no
  voiced hop.
- **Drops, narrowband, restarts, fill, bookkeeping:** 2.3–3.6 % of bins
  dropped (the documented 2.7 %), almost all at utterance onsets the gate is
  still watching ("warming"); no narrowband event, no idle reset, no
  overload in any run; the restart readout does not touch the start
  collection (it reads the plain readout); `delta` / `droppedVoicedS` agree
  with the replica on every bin.
- **The smoke clip:** `ls121`'s start comes at 40.0 s in Node and at 41.9 s
  in the built app (row live at 12.7 s) — near the slow end of the women's
  range. Part 1's "75 s" sample is a timeout: `sample()` returns as soon as
  both rows are live and the resonance trail has 3 dots, ~16–20 s into
  listening, and the screenshots `02-woman-live-masculine` and the desktop
  `01c-*` follow within ~5 s — before the earliest start of any of the 40
  readers (25.6 s), so those screenshots always show "finding your start…". (This run cannot see the owner's machine; an
  overload back-off would also restart the collection, but it shows as
  "paused — device busy" and did not occur here.)

**What the user saw meanwhile:** warming ("keep talking…") → settling →
live with a dot and trail but no start ring, and the header "finding your
start…" for ~22 s of live reading (~31–34 s from Start). The screen-reader
summary said the same. The pitch-only warning (which reads `startU`) is
inactive over the same span, by its own design.

## 4. Candidates (pre-registered) and results

S0 = shipped. Pk = a **shown start** for the header and the start ring only:
`startU` once set, before it the median of the readouts collected so far
(once k s are collected); `startU` unchanged. C6 = `startU` after 6 s of
collection. Guards: G1 |final start − the reader's long-run value| q90 ≤ S0
+ 0.05 u; G2 false "brighter / darker" share of word posts (unchanged voice)
≤ S0 + 2 points; G3 the same over the span a candidate adds ≤ S0's whole-span
share + 5 points; G4 the start's jump when `startU` is set q90 ≤ 0.3 u; G5
`startU` series identical (the pitch-only warning's input). Target: median
first word ≤ 20 s, women and men.

**Primary (test-clean, gated):**

| cand | sex | first word q50 / q90 s | \|start − long-run\| q50 / q90 u | false words, whole span | false words, added span (posts) | jump q90 u | startU = S0 |
|---|---|---|---|---|---|---|---|
| S0 | women | 30.6 / 36.2 | 0.14 / 0.31 | 23.2 % | — | — | yes |
| S0 | men | 33.8 / 40.7 | 0.09 / 0.35 | 18.5 % | — | — | yes |
| **P0** | women | **8.9 / 10.9** | 0.14 / 0.31 | 21.1 % | 5.6 % (1951) | 0.00 | yes |
| **P0** | men | **10.8 / 13.1** | 0.09 / 0.35 | 18.0 % | 13.6 % (2120) | 0.01 | yes |
| P2 | women | 12.5 / 14.9 | 0.14 / 0.31 | 21.4 % | 5.4 % (1635) | 0.00 | yes |
| P2 | men | 14.6 / 17.9 | 0.09 / 0.35 | 18.3 % | 16.0 % (1753) | 0.01 | yes |
| P4 | women | 15.8 / 19.7 | 0.14 / 0.31 | 21.8 % | 6.0 % (1309) | 0.00 | yes |
| P4 | men | 19.4 / 22.4 | 0.09 / 0.35 | 18.5 % | 18.2 % (1373) | 0.01 | yes |
| P6 | women | 19.0 / 23.9 | 0.14 / 0.31 | 22.1 % | 6.0 % (996) | 0.00 | yes |
| P6 | men | 23.1 / 27.7 | 0.09 / 0.35 | 18.5 % | 17.7 % (1015) | 0.01 | yes |
| C6 | women | 19.0 / 23.9 | 0.12 / 0.22 | 20.0 % | 6.8 % (996) | — | no |
| C6 | men | 23.1 / 27.7 | 0.10 / 0.61 | 22.1 % | 20.5 % (1015) | — | no |

Verdicts: P0, P2, P4 qualify; P6 misses the target (men 23.1 s); C6 fails
G1 / G2 (men), G5 and the target. The ungated arm gives the same verdicts
(every figure within 0.2 s / 0.1 point).

**Selection (the pre-registered rule): P0** — the lowest max-over-sexes
median first word (10.8 s; P2 is 3.8 s later, outside the 0.5 s tie band).

**Confirmation (dev-clean, gated), P0:** first word 9.0 / 12.2 s (women)
and 9.4 / 12.6 s (men) vs S0 30.3 / 36.6 and 33.1 / 43.1; false words
whole span 17.6 % vs 19.4 % (women), 17.4 % vs 18.7 % (men); added span
3.5 % / 8.2 %; start error unchanged (0.11 / 0.40, 0.14 / 0.32); jump 0.00;
startU identical. Every guard passes for both sexes.

Why the false-word share falls rather than rises: the shown start is the
running median of the readouts it is compared with, so during the
collection an unchanged voice reads "about where you started" more often
than it does later against the frozen start. The S0 whole-span shares
(18–23 %) are the restart readout's known cost on an unchanged voice
(2026-10-21: "about where you started" 83 % of live time); they are not
changed by this work.

## 5. The fix (shipped on this branch)

`resonanceCue.js` snapshot gains `shownStartU` = `startU` once set, else the
median of the readouts collected so far (`null` before the readout fills);
the worker posts it; `cueStripModel.js` `shownStart(snap)` (→ `shownStartU`,
falling back to `startU`) feeds `resonanceHeader` and the start ring in
`CueStrip.jsx`. `startU`, its timing and `startProgress` are unchanged, so
the pitch-only warning's input is bit-identical (all 40 streams: `startU`
value and time equal to the tree before the change; its unit test, incl.
the golden replay, passes; its study harness was not re-run because its
input did not change). The tree's own header equals P0's post for post on
all 40 test-clean streams.

Built app, after the change: first start-relative word at 11.3 s
(`speech-woman.wav`, was 41.9 s) and 12.2 s (`speech-man.wav`), together
with the dot going live; `startU` still at 41.5 / 35.9 s.

| time to the first start-relative word (audio s) | women median / q90 | men median / q90 |
|---|---|---|
| before (S0), test-clean | 30.6 / 36.2 | 33.8 / 40.7 |
| after (P0), test-clean | 8.9 / 10.9 | 10.8 / 13.1 |
| before, dev-clean | 30.3 / 36.6 | 33.1 / 43.1 |
| after, dev-clean | 9.0 / 12.2 | 9.4 / 12.6 |

**What changes for the user:** the header says "about where you started"
as soon as the dot is live, and the start ring appears with it. For the
first ~22 s of live reading the ring follows the running median (it moves),
then stays put. A change of resonance made during those ~22 s is partly
absorbed into the start — as it already was in the final start, which is
the median over the same span; it now also shows as "about where you
started" while it happens, where before the header said "finding your
start…". "finding your start…" remains only for a live row with no
collected readout (e.g. right after a phone-quality notice clears).

## 6. Not covered

- Real-world rooms, phones and mid-session pauses longer than the 0.3 s
  gaps (the start's timing is in voiced seconds; pauses only stretch it).
- A deliberate change of resonance in the first ~30 s (no manipulated
  streams in this pass): reported as the behaviour above, not measured.
- The owner's PC: if the smoke there still shows "finding your start…"
  after ~45 s of listening, something this run did not see (e.g. an overload
  back-off, which restarts the engine) is involved; the probe
  `start-reference-browser.mjs --chrome=<path>` logs the worker's statuses.
