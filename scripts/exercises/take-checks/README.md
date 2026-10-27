# Take checks harness

How much voice the guided exercises' frame tap (`src/exercises/bridge.js`, the frame a
session recording stores) receives during a spoken take and during a take with no speech,
through the shipped chain. Pre-registration and results:
[measurements/exercise-take-checks-2026-10-27.md](../../../measurements/exercise-take-checks-2026-10-27.md).
Public data only (LibriSpeech dev-clean / test-clean, synthetic noise).

## Files

| file | role |
|---|---|
| `stimuli.mjs` | the takes: LibriSpeech single / double takes (0.8 s lead, 0.6 s tail; clean / quiet / noisy), negatives n1–n6, 48 kHz; 3.0 s of the take's background before each take |
| `chain.mjs` | the session oracle's production chain (real pitch worker with FireRedVAD, real DSP worker) and the REAL hook (`useAudioPipeline`'s `handlePitchMessage` / `handleAnalysisResult`) with the exercises frame tap installed; counts `a` / `b` / median f0 over the frames that arrive inside the take window |
| `parity.mjs` | the check before any number: on one input, the harness's frames = the frames the hook's `start()` path hands the tap (fake capture and Worker shells, the messages through the hook's own onmessage handlers) = the session oracle's own drive; writes `parity.txt` |
| `run.mjs` | every take of one set (`sel` / `conf` / `neg`), sharded, one JSON row per take × condition |
| `merge.mjs` | joins the shards into `rows-<set>.jsonl`, checks completeness |
| `summarize.mjs` | §1 applied mechanically: pass shares per cell and candidate, selection, confirmation, negatives, "too short", R4 try pitch → `summary.txt` / `summary.json` |

## Run (repo root, Git Bash)

```bash
node scripts/fetch-firered-model.mjs                      # once: build/models/firered/
mkdir -p build/exercise-take-checks/tree && git archive HEAD src | tar -x -C build/exercise-take-checks/tree
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/exercises/take-checks/parity.mjs
for s in sel conf; do for i in 0 1 2 3 4 5 6; do
  SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/exercises/take-checks/run.mjs --set=$s --shard=$i/7 &
done; done
SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/exercises/take-checks/run.mjs --set=neg &
wait
node scripts/exercises/take-checks/merge.mjs
node scripts/exercises/take-checks/summarize.mjs
```

Needs `ffmpeg` with soxr on `PATH` (FLAC decoding, 16 → 48 kHz) and LibriSpeech at
`TAKE_CHECKS_LIBRI` (default `build/resonance-lab/data/LibriSpeech`, the resonance lab's copy; dev-clean and test-clean).
`--src=` points every script at a src tree (default: the `git archive` copy above, so edits in
the working tree during a run do not change it). Outputs go to `build/exercise-take-checks/`
(gitignored). About 0.7 s per stream on a desktop; the full run (1 956 streams) takes a few
minutes in 16 shards.

## Conventions

- **Chain:** as the session oracle's `--voice-gate` drive (README there): 25 ms chunks at
  48 kHz, a device that keeps up (the pitch message of frame kk reaches the hook with display
  hop kk + L; its `ts` and the DSP frame's `absoluteTime` are the hop's audio-clock time), the
  worker phase on a frozen performance clock (the detector is never switched off as "slow"),
  no pitch hints relayed to the DSP worker (they set only its formant ceiling). The setting
  "Only show pitch while I'm speaking" is on (the default).
- **Take window:** Record is pressed after 3.0 s of listening; a frame counts when it arrives
  after Record and no later than Stop (take start < arrival ≤ take end, arrival = the end of
  the chunk the DSP frame analysed).
- **Counts:** `a` = 0.025 s × frames with `voiced` and `f0 > 0` (`createFrameLog`'s rule, the
  tree's own module); `b` = as `a` minus frames with `voiceGate === "hidden"`. `medA` /
  `medB` = median f0 of those frames. `a8` / `b8` count only frames up to 8.0 s after Record
  (the take recorder's cap — reported, not part of §1).
