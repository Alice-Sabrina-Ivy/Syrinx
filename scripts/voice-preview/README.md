# Voice preview: build and parity scripts

The app code is in `src/voice-preview/`; the design and acceptance list in
[measurements/voice-preview-phase1-2026-10-19.md](../../measurements/voice-preview-phase1-2026-10-19.md).
The Phase 0 spike (its timing pages, parity runners and listening tools) is on the
`voice-preview-spike` branch.

| Path | What |
|---|---|
| `build.mjs` | Pinned, reproducible build of WORLD (`8d79b88`) + `wasm/vp_world.cpp` with Emscripten 6.0.10 (SIMD and non-SIMD). `--ship` copies the result into `src/voice-preview/wasm/` and writes `BUILD.json`; `--check-shipped` rebuilds and requires byte-identity with the committed files |
| `wasm/vp_world.cpp` | Syrinx's C API over WORLD (float64, pyworld 0.3.5 defaults) and the formant envelope warp |
| `lib/paths.mjs` | Where the SDK, the WORLD source and the build output live (`VP_CACHE`, default `build/voice-preview`) |
| `noise-margin-eval.mjs` | The background-noise check (`checks.js` `levelMargin`) on public corpora (PTDB-TUG, FDA; gitignored), clean and with synthetic pink noise / fan hum: notice rates for the floor at the 10th and the 5th percentile (the fix step's change) |
| `make-spike-parity.mjs` | Expected renders for `tests/voice-preview/parity-test.js`, computed by the spike's own code (extracted from the spike commit) with the committed `.wasm`; posted tracks from the real pitch chain |
| `bundle-budget.mjs` | The bundle budget (design note §11): builds the branch point and this tree with the same Vite settings; entry and LabView chunks grow ≤ 1 KB gzip, the card and worker chunks ≤ 15 KB gzip, no voice-preview strings in the entry or LabView chunks |
| `../voice-preview-smoke-wavs.mjs`, `../voice-preview-smoke.mjs` | The card's headless smoke against the built app (layout at five viewports in light and dark; per viewport, with touch or the mouse, both sliders to each end, every quick setting, the target row, each Play button, and Discard freeing the recording's memory; flow, keyboard, playback, session guard, hum / noise notices, Discard / Download; dev server, `vite preview`, the non-SIMD fallback) and, with `--parts=timing` and `$VP_CACHE`, the desktop timing in the spike's Chrome for Testing 154 |

```sh
export VP_CACHE=<folder with emsdk/ and world-src/>   # build.mjs --install fetches both
node scripts/voice-preview/build.mjs --check-shipped    # rebuild, compare with src/voice-preview/wasm/
node scripts/voice-preview/build.mjs --ship             # only when the C API or a pin changes
node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/make-spike-parity.mjs
```

```sh
node scripts/voice-preview/bundle-budget.mjs
npm run build && node scripts/voice-preview-smoke-wavs.mjs && node scripts/voice-preview-smoke.mjs [--out=<dir>]
VP_CACHE=<cache> node scripts/voice-preview-smoke.mjs --parts=timing   # desktop timing, Chrome for Testing 154
```

CI does not build WebAssembly: `tests/voice-preview/wasm-files-test.js` checks the committed
files against `BUILD.json` and the hashes recorded in the design note.

Reproducibility has been shown on **Windows x64** only (`--check-shipped` byte-identical there):
`build.mjs` pins the Windows emsdk archives (`PINS.emsdk.winArchives`); on Linux or macOS
`--install` fetches that platform's archives, whose hashes are recorded but not checked. The
commands above are written for a POSIX shell (Git Bash on Windows).
