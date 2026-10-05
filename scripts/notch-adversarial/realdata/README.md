# Real-data corpora for the notch voice-vs-machine question (2026-10-05)

Data phase of the "can a voice line be told from a machine line directly?"
investigation (jitter / shimmer / fast F0 micro-variation / co-varying formant
envelope vs mechanically steady motors, mains and electronics). Every earlier
notch decision ran on synthetic noise (`scripts/noise-synth.js`); these
scripts build **real** noise and **real** held-voice corpora plus end-to-end
mixes, with loaders for the JS suite. Decision record:
[measurements/notch-realdata-corpora-2026-10-05.md](../../../measurements/notch-realdata-corpora-2026-10-05.md);
discrimination results: [measurements/notch-voice-machine-discrimination-2026-10-05.md](../../../measurements/notch-voice-machine-discrimination-2026-10-05.md).

**No audio is committed.** Everything lands under `build/notchvd/` (gitignored;
`NOTCHVD_ROOT` overrides): `dl/` raw download cache, `data/` 16 kHz mono
float32 WAVs at the recording's original level, per-source manifests, census,
indexes. Licenses are per clip in the manifests; several sources are
non-commercial or research-only (ESC-50 CC BY-NC, DCASE CC BY-NC-SA, some
Freesound CC BY-NC, Hillenbrand / FDA research use) — local research use only,
never redistributed.

**Private session recordings (opt-in).** `fetch_voice.py --sources=...,sessions`
cuts voiced runs (and "outside"-labelled steady runs, into corpus A) from the
private session recordings (`SYRINX_SESSIONS_DIR`; CLAUDE.md, "Private session
data"). It is never in the default sources. A build that includes it feeds
those clips into the indexes, the `voice_in_noise` "other" programs and every
analysis, so nothing computed on such a build is committed; the committed
results use the public sources only.

## Rebuild (repo root; ~1.5 GB download, ~3 GB data incl. mixes)

```bash
R=scripts/notch-adversarial/realdata
# corpus A — real noise (one process per source is fine; network-bound)
python $R/fetch_noise.py --sources=mssnsd,demand,esc50,dcase,freesound --jobs=3
# corpus B — real voice (PTDB-TUG / FDA audio are gitignored: copy them read-only
# from the main checkout's tests/dsp/data first)
node   $R/export_refs.mjs                      # corpus F0 refs via tests/dsp/data/corpora.js
python $R/fetch_voice.py --sources=vocalset,vocadito,hillenbrand,ptdb,fda,voiced,pvqd --jobs=3
node   $R/render_synth.mjs                     # synthetic held notes (suite scenarios) as source `synthetic`
# census + labels, shipped-notch probe, indexes, mixes
python $R/census.py --jobs=4 --png=tonal       # data/census/noise_census.json (+ spectrogram PNGs)
for i in 0 1 2 3; do node $R/probe.mjs --tag=src --shard=$i/4 & done; wait   # real worker on noise-only clips
python $R/build_index.py                       # data/index_{noise,voice,mix}.json + data/summary.md
python $R/build_mixes.py --jobs=4              # data/mix/<set>/*.wav + manifests/mix.<set>.json
python $R/build_index.py                       # again, to index the mixes
node   $R/mix-parity.mjs                       # JS renderMix == Python render (<= half a PCM16 LSB)
```

## Files

| file | what |
|---|---|
| `common.py` | layout, 16 kHz mono conversion (first channel, polyphase), clip writer, per-source manifests, cached fetch (curl fallback for hosts that 403 python-requests) |
| `remotezip.py` | read single members of a remote ZIP over HTTP Range (VocalSet 2.1 GB, DCASE 1-1.9 GB, DEMAND ~100 MB zips — only the needed files are transferred) |
| `fetch_noise.py` | corpus A: MS-SNSD, DEMAND (ch01), ESC-50 machine / tonal classes, DCASE 2020 T2 (MIMII + ToyADMOS), Freesound HQ previews (search-page scrape, per-sound license) |
| `fetch_voice.py`, `heldseg.py`, `export_refs.mjs`, `render_synth.mjs` | corpus B: VocalSet long tones, vocadito, Hillenbrand, PTDB-TUG, FDA, VOICED, PVQD, the opt-in private `sessions` source (above), the suite's synthetic held notes; held-segment detection |
| `census.py` | tonal-line census with the notch's own peak finder + line-envelope demodulation; labels |
| `probe.mjs` | the real `src/` pitch worker over noise-only clips: notch promotion time / lines / false voicing |
| `build_index.py` | manifests + census + probe + exact-duplicate detection -> `data/index_*.json`, `data/summary.md` |
| `build_mixes.py`, `mix-parity.mjs` | evaluation streams as clip-layer specs, pre-rendered |
| `linefeat.py` | DISCRIMINATE phase: per tracked line (notch peak finder, 80-400 Hz), 25 ms phase-vocoder IF + amplitude at f and 2f (64 ms Hann DFT bins), per-1 s-window micro-variation features; voice / noise / mix modes, white-noise degradation, window length, extra partners -> `build/notchvd/linefeat/*.csv` |
| `linefeat_analyze.py` | AUC / 99 %-voice operating points per feature, confound check, degraded voice, grouped-CV logistic combinations, per-class tables |
| `linefeat_rules.py` | explicit causal "confidently machine" rules (pooled cross-harmonic coherence, evidence floor `--minwin`), grouped-CV threshold selection, per-class + mix + supplement evaluation |
| `realeval.mjs`, `agg-real.mjs` | CANDIDATE phase (2026-10-05): the real-noise oracle — real worker (`lib.mjs` variants) over `noise` / `gated` / `held` / `vin`; promotion, painted false voicing, voice frames at pitch; per-stream strict rule vs bc42ad0 |
| `linecls.mjs` | census of the online line-coherence verdict (`cand3-notch.js`) on real voice (clean + white-noise degradations), real noise and the mixes |
| `export_test_clips.mjs` | writes the three short real clips `tests/dsp/noise-notch-test.js` commits (`tests/dsp/data/notch-real/`: an MS-SNSD air-conditioner excerpt, CC0; VocalSet long tones of two singers, CC BY 4.0) |
| `realdata.mjs` | JS loader: `loadIndex`, `readClip`, `readWav`, `loadF0`, `resample` (16 -> 48 kHz polyphase), `renderMix` |

## Records

Common fields: `id, kind, source, path` (relative to `data/`), `sr` (16000),
`dur, rms_dbfs, peak, class, url, license, attribution, orig_sr,
orig_channels, codec, notes`, `md5` / `dup_of` (index).

* noise (+ census): `label` = `stationary-tonal | intermittent-tonal | mixed |
  broadband`, `flags` (`short` < 15 s, `drifting` main line > 10 Hz p5-p95,
  `single_line`, `cuts_unmeasurable`, `cuts/min=x`, `r8_pattern`,
  `equal_tempered`), `main_line {f, duty, snr_db, f_range, cuts_*}`,
  `probe {promoT, notchedFrac, freqs, fvWorker, fvPainted, fvPaintedAfter20}`.
  Full per-line detail in `data/census/noise_census.json`.
* voice: `held` = `[[t0, t1, f0_med, vib_cents, drift_cents, micro_cents]]`
  (heldseg.py: voiced run, 0.3 s median-smoothed pitch within +-50 c, >= 0.5 s),
  `held_basis` (`ref` corpus annotation | `praat` AC 60-1100 | `session_labels`
  | `scenario`), `held_sec`, `f0_median`, `f0_path` -> `{ref: {hopMs, f0, t0?},
  praat: {t0, hop, f0}}`; source-specific `singer`, `gender`, `speaker`,
  `session`, `session_t0`, `diagnosis` (VOICED), `capev_severity` (PVQD).
* mix: `set`, `spec` (`{sr, dur, layers: [{clip, at, from, len, gain, loop,
  fade, gates?}]}`), plus per set `noise_id, noise_label, voice, voice_kind,
  snr_db, voice_t0, voice_t1, holds` / `gap_s, f0, holds` / `period_s, off_s,
  gates_abs`.

## Census method (labels)

1. Lines: the shipped notch's `observe()` peak finder ported 1:1 (512 ms Hann,
   16384-pt FFT, 50-460 Hz, >= 8x band median, >= max - 26 dB, narrow at
   +-5 Hz, 10 Hz separation) every 100 ms, 3 Hz association, tracks survive 3 s
   of absence; duplicate tracks within 3 Hz are merged.
2. Source cuts: up to 3 strong lines (span >= min(5 s, half the clip), duty
   >= 0.3) are demodulated along their tracked frequency (+-8 Hz, 10 ms grid).
   A line is "down" when >= 10 dB under its 70th-percentile level (hysteresis:
   back only after 0.15 s within 5 dB), measured only on lines with >= 13 dB
   SNR vs the +-20-40 Hz neighbourhood. A **cut** = every measured line down at
   once for >= 0.15 s (>= 0.3 s and a >= 3 dB 50-4000 Hz band-level dip when
   only one line is measurable — a lone wobbling fan line otherwise "drops" out
   of the demodulation band). Lines dropping alone are beats / FM, not cuts.
3. Labels: `broadband` no line with duty >= 0.5 and SNR >= 6 dB (`mixed` if
   some line has duty >= 0.3); `intermittent-tonal` >= 2 cuts of 0.15-10 s
   (1 on a < 15 s clip) and >= 1 / min; `stationary-tonal` main line duty
   >= 0.8 and SNR >= 10 dB; else `mixed`. `r8_pattern`: >= 3 cuts of
   0.15-1 s recurring every 2-15 s (median) — the R8 adversary's signature.
