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
| `attr.mjs` | per-hop dump of the PRODUCTION chain (real pitch worker, DSP worker, `handleAnalysisResult`) over noise / voice-in-noise / gated sets or a corpus, incl. the replayed gender VAD |
| `attr.py` | attribution tables from the dumps (painted / fresh / held, worker funnel, detector, notch coverage, silence gate, gender VAD, worst clips) |
| `cmp.py`, `vinscore.py`, `score.py` | compare dump tags: noise-only by class; voice in noise (Praat truth of the voice layers); ground-truth corpora (corpus.mjs conventions, gender-symmetric) |
| `replay.mjs` | re-drive the real display hook of any tree over existing dumps (display candidates, exact; `--parity`) |
| `evalmix.mjs`, `aggmix.py` | gated / held-series / voice-in-noise mixes through the production chain; tree comparison |
| `held.mjs` | the notch work's synthetic held-note suite on any trees (agg-held.mjs-compatible rows) |
| `harmfeat.py`, `harmfeat_audio.py`, `floorfeat.py`, `simguard.py`, `simfloor.py` | offline features (harmonic prominence, harmonic excess over a learned background) and worker-level guard simulations on the dumps (`simfloor.py`: causal background-floor variants — voicing-gated, segment-frozen) |
| `mktree.py` | candidate src trees (`build/rnfv-trees/<name>/src`): hold-bridge, onset-confirm and learned-background-guard variants |
| `clips_csv.py` | per-clip table committed with the measurement |
| `cand/noise-floor-guard.js`, `cand/noise-floor-guard-test.mjs` | the (not adopted) learned-background voicing veto and its contract test (`python scripts/realnoise-fv/mktree.py fg`, then `node scripts/realnoise-fv/cand/noise-floor-guard-test.mjs`) |

Commands: the measurement file's "Reproduction" section.
