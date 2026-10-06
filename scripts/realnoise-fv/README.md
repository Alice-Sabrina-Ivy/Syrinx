# Real-noise false voicing (2026-10-05)

Attribution and candidate tooling for false voicing on REAL noise. Decision
record: [measurements/realnoise-false-voicing-attribution-2026-10-05.md](../../measurements/realnoise-false-voicing-attribution-2026-10-05.md).

Data are the real corpora of the notch voice-discrimination work
([scripts/notch-adversarial/realdata/](../notch-adversarial/realdata/README.md)),
read in place: set `NOTCHVD_ROOT` (or `--data-root=`) to the `build/notchvd`
of the checkout that built them. Only public sources are ever selected
(`lib/sets.mjs` allowlists). Ground-truth corpora come from
`tests/dsp/data/corpora.js`; `SYRINX_CORPORA_DIR` reads another checkout's
gitignored PTDB-TUG / FDA audio. Every output lands under `build/` (gitignored).

## Files

| file | what |
|---|---|
| `lib/hooks.mjs`, `lib/register.mjs` | Node loader: the session oracle's react mock + Vite-style imports, plus two taps on the pitch worker's imports |
| `lib/tap-boersma.mjs`, `lib/tap-notch.mjs` | observation-only taps (detector candidates, tracker decode, harmonic-guard verdict; the notch's tracks / cascade / line verdict) with opt-in counterfactual switches (`--cf=noVeto,noGuard`, `--notch-opts=<JSON>`) |
| `lib/sets.mjs` | noise-only set, public-mix filter, the tuning / held-out split of noise sources |
| `lib/worker.mjs` | drive the pitch worker of any number of src trees in one process |
| `attr.mjs` | per-hop dump of the PRODUCTION chain (real pitch worker, DSP worker, `handleAnalysisResult`) over noise / voice-in-noise / gated sets or a corpus, incl. the replayed gender VAD; `--lead=S` crops the voice-in-noise mixes to an S-second noise-only lead (the mixes carry 20 s) |
| `attr.py` | attribution tables from the dumps (painted / fresh / held, worker funnel, detector, notch coverage, silence gate, gender VAD, worst clips) |
| `cmp.py`, `vinscore.py`, `score.py` | compare dump tags: noise-only by class; voice in noise (Praat truth of the voice layers); ground-truth corpora (corpus.mjs conventions, gender-symmetric) |
| `vinlead.py` | voice in noise as base / candidate pairs per noise-only lead: cost by register and voice gender (max(F_err, M_err)), per-stream worker / painted losses in frames (display-only losses marked), painted false voicing per stream on the noise segments (lead, tail, gaps between phrases; +2 pp rule), gender-model ticks over voiced audio |
| `fvwin.py` | painted false voicing of the noise-only clips per 5 s window (a clip-mean gain can hide worse windows) |
| `armed.mjs` | how often the candidate guard is armed at all on the clean corpora (`fg_armed` tree: the candidate + observation-only counters) and its margin to the threshold |
| `cmpcells.mjs` | cell-by-cell base / candidate check of the notch work's synthetic interferer suites (`scripts/notch-adversarial`, which load any trees via `NOTCH_ADV_TREES`) |
| `replay.mjs` | re-drive the real display hook of any tree over existing dumps (display candidates, exact; `--parity`) |
| `evalmix.mjs`, `aggmix.py` | gated / held-series / voice-in-noise mixes through the production chain; tree comparison |
| `held.mjs` | the notch work's synthetic held-note suite on any trees (agg-held.mjs-compatible rows) |
| `harmfeat.py`, `harmfeat_audio.py`, `floorfeat.py`, `simguard.py`, `simfloor.py` | offline features (harmonic prominence, harmonic excess over a learned background) and worker-level guard simulations on the dumps (`simfloor.py`: causal background-floor variants — voicing-gated, segment-frozen) |
| `mktree.py` | candidate src trees (`build/rnfv-trees/<name>/src`): hold-bridge (incl. `h_max0`, no bridge), onset-confirm and learned-background-guard variants (incl. `fg_armed`, counters only) |
| `clips_csv.py` | per-clip table committed with the measurement |
| `shiprule.py` | the pre-registered ship-rule rows of the pitch-hold bridge rework ([measurements/pitch-hold-bridge-rework-2026-10-06.md](../../measurements/pitch-hold-bridge-rework-2026-10-06.md)): goal (painted false voicing on the 279 noise-only clips, tuning / held-out, and the second held-out set `noiseho`) and G1–G4 (corpora, voice in noise at the 20 s and no lead incl. per-stream and noise-after-speech rules, clean-speech continuity), PASS / FAIL per row; `--paint=paintF` scores the trace as it stands at the end of the stream |
| `bridge-rate-check.mjs` | a display change's transfer from the 16 kHz corpora to 44.1 / 48 kHz: a resampled subset of the noise-only clips and voice-in-noise mixes through the real worker at each rate, base and candidate hook |
| `held-painted.mjs` | the held-note suite scored on the PAINTED trace of any number of hook trees over one worker run per scenario (`held.mjs` scores the posted pitch, which a display change cannot move); `--suite=lowband`: the 80–120 Hz breathy holds of `scripts/notch-adversarial/scenarios.mjs` `lowBandScenarios()` |
| `evidence.py` | offline replica of the pitch-hold bridge's voice-evidence rule (`src/audio/bridgeEvidence.js`) over the dumps; `check` must report 0 mismatching hops against a real-hook replay before any row built on it is quoted (fix round 2026-10-06) |
| `bridge-review.py` | the decision-record rows the ship rule does not score: goal with clip-bootstrap CIs, time-weighted, by stream time / duration / source / class; noise clips that produce strong-evidence frames vs not; warm-start counterfactual; what the user sees (trace, readout, glow dot, any); notch timing of the evidence; voice in noise per stream by F0 bin and gender; readout / style flicker |
| `afterspeech.mjs`, `afterspeech.py` | painted false voicing on real noise after one PTDB-TUG sentence and between sentences every 15 s (real workers, any number of hook trees), by time since the last sentence |
| `cpp-vs-f0.mjs` | production cpp.js on one synthetic vowel vs F0, on the DSP worker's 50 ms and 64 ms windows (`--sr=48000` for the mic rate) |
| `held-painted-agg.py` | summary of `held-painted.mjs` outputs: suite mean, runs > 0.5 pp below base, per family / F0, losing runs |
| `cand/noise-floor-guard.js`, `cand/noise-floor-guard-test.mjs` | the (not adopted) learned-background voicing veto and its contract test (`python scripts/realnoise-fv/mktree.py fg`, then `node scripts/realnoise-fv/cand/noise-floor-guard-test.mjs`) |

Commands: the measurement file's "Reproduction" section.

**DSP fields reach the hook** (2026-10-06): `attr.mjs`, `replay.mjs` and the
session oracle's `lib/chain.mjs` hand the DSP worker's `cpp` / `hnr` /
`spectralTilt` to `handleAnalysisResult` per frame, as production does (they
used to pass null: harmless while the display read only the intensity, but
the pitch-hold bridge's voice evidence reads CPP). Dumps gained `cpp`, `hnr`,
`tilt` and `paintF` (the trace entry's value at the end of the stream);
`attr.mjs --set=noiseho` runs the second held-out noise set
(`NOTCHVD_ROOT=<...>/notchvd-heldout`); `lib/tap-notch.mjs` resolves the
notch's own relative imports (V19g's `noise-notch.js` imports
`../utils/constants.js`, which a `data:` URL cannot).

**Fix round** (2026-10-06): the DSP worker posts `bridgeCpp` (CPP on the last
64 ms) and the hook pairs each voiced flag with the CPP of the chunk its pitch
frame ended on, by both messages' contextTime. Dumps gained `bcpp`;
`lib/chain.mjs` builds both contextTimes into the frames it hands the hook;
`replay.mjs` refuses a dump without `bcpp` (the evidence would fail open)
unless `--allow-no-bcpp`. `shiprule.py` adds a gender-symmetric G2 verdict row
and G4 context columns that grow with fragmentation.

**Checking any future background-floor guard** (review fixes 2026-10-05):
voice in noise with NO noise-only lead and with short leads (`--lead=0,1,3,8`),
not only the mixes' 20 s lead; worker and painted losses in frames, by register
and voice gender; painted false voicing on the noise segments AFTER speech per
stream (the 400 ms hold bridge can paint more from fewer worker frames); 5 s
windows of the noise-only clips; the synthetic interferer suites.
