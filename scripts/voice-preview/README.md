# Voice preview spike (Phase 0)

Spike code for [measurements/voice-preview-spike-2026-10-12.md](../../measurements/voice-preview-spike-2026-10-12.md):
WORLD compiled to WebAssembly, checked against pyworld, and timed in browsers. No app code;
nothing here is imported by `src/`.

Everything that is not code lives outside the repo, under `VP_CACHE` (default
`build/voice-preview`, gitignored; the 2026-10-12 runs used
`C:/Coding Projects/Syrinx-cache/voice-preview`): the Emscripten SDK, the WORLD source, the built
modules, the clips, parity outputs, timing results and the pinned browsers. Audio and `.wasm`
files are not committed; the build is byte-reproducible from `build.mjs`.

## Files

| Path | What |
|---|---|
| `build.mjs` | Pinned build: WORLD 8d79b88 + emsdk 6.0.10 → `VP_CACHE/wasm/{simd,nosimd}/vp_world.{mjs,wasm}`; hashes, sizes, feature list; `--repro` rebuilds and requires byte-identical output |
| `wasm/vp_world.cpp` | Our C API over WORLD (float64, pyworld defaults) and the formant envelope warp |
| `lib/world-engine.js` | JS binding: stage functions and `WorldSession` (analyse once, render on demand) |
| `lib/frontends.js` | F0 front ends onto WORLD's 5 ms frames / PSOLA's 10 ms grid |
| `lib/psola.js` | The prototype's TD-PSOLA fallback, code unchanged |
| `lib/preview-core.js` | The engine shared by the Worker and Node: resample, front end, analysis, render, finish |
| `worker/vp-worker.js` | Module Worker (`init` / `analyse` / `render`, transferable PCM) |
| `prep/prep_clips.py`, `prep/tracks.mjs` | Public clips (LibriSpeech, PTDB-TUG) and their precomputed F0 tracks |
| `parity/` | WebAssembly vs pyworld 0.3.5 (Levels 1–3), SIMD vs non-SIMD, PSOLA vs the prototype, browser vs Node |
| `timing/` | Timing page, matrix, static server, desktop driver, summary |

## Reproduce

```sh
export VP_CACHE="C:/Coding Projects/Syrinx-cache/voice-preview"   # or leave unset
node scripts/voice-preview/build.mjs --install --repro
python -I scripts/voice-preview/prep/prep_clips.py --pyworld <dir with pyworld 0.3.5> \
  --librispeech <LibriSpeech root> [--ptdb <PTDB-TUG subset>] [--proto-data <prototype data dir>]
node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/prep/tracks.mjs

# parity
node scripts/voice-preview/parity/run-wasm.mjs --build=simd
python -I scripts/voice-preview/parity/pyworld_ref.py --pyworld <dir> --build simd
node scripts/voice-preview/parity/run-wasm.mjs --build=nosimd --hashes-only
node scripts/voice-preview/parity/compare-builds.mjs simd nosimd
node scripts/voice-preview/parity/psola-parity.mjs --proto-renders=<prototype renders/psola>
for s in pyworld wasm-simd; do
  node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/parity/meters.mjs --set=$s --meter=pitch
  node scripts/voice-preview/parity/meters.mjs --set=$s --meter=vtln
done
python -I scripts/voice-preview/parity/meters_score.py

# browsers (pinned; see the note for versions and archive hashes) and timing
node node_modules/@puppeteer/browsers/lib/esm/main-cli.js install chrome@154.0.8037.57 --path "$VP_CACHE/browsers"
node scripts/voice-preview/timing/run-desktop.mjs --browser=chrome --mode=identity
node scripts/voice-preview/timing/run-desktop.mjs --browser=chrome --params="runs=10&fe=L"
node scripts/voice-preview/timing/summarize.mjs <result.json>
```

Manual use: `node scripts/voice-preview/timing/serve.mjs`, then open
`http://localhost:8787/scripts/voice-preview/timing/index.html?auto=1&runs=1`.
The desktop driver only launches the pinned browsers, each with a new temporary profile, and
only ever kills the PID it started (CLAUDE.md hard rule 2).

## Licences

- Code here: ours, MIT (the repo licence).
- **The built module (not committed)** contains third-party code. If a later phase commits or ships
  it, `THIRD_PARTY_NOTICES.md` must carry: WORLD (M. Morise, modified BSD — the full text of
  WORLD's `LICENSE.txt` must accompany the binary), and Emscripten's runtime: its JS glue
  (MIT / University of Illinois NCSA), the musl-based libc (MIT), dlmalloc (public domain, CC0),
  compiler-rt builtins and libc++ / libc++abi (Apache-2.0 WITH LLVM-exception).
- Data (not committed): LibriSpeech (Panayotov, Chen, Povey & Khudanpur, ICASSP 2015), CC BY 4.0;
  PTDB-TUG (Pirker, Wohlmayr, Petrik & Pernkopf, Interspeech 2011), see
  `tests/dsp/data/ptdb-tug/README.md`.
