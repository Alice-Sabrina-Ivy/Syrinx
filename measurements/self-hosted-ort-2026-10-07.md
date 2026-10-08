# Self-hosted ONNX Runtime Web files (2026-10-07)

User decision (C), 2026-10-07: the app must not depend on jsDelivr at run
time. Only GitHub Pages (the app) and the user's Hugging Face account (the
models) may serve what the app loads. This note measures what the built app
fetches from jsDelivr today. It then records the switch to ONNX Runtime
files shipped with the app and the check of that switch.

Scope: the gender worker (perceived-voice model plus the Silero speech
detector, which share one onnxruntime-web instance) and the Resonance lab
worker (which loads its own copy of Transformers.js and ONNX Runtime when its
tab is opened). The pitch and DSP workers do not use ONNX Runtime.

## 1. Before (origin/voice-direction 5db2663)

### Method

- **Build.** `vite build` of 5db2663, served by `vite preview` under
  `/Syrinx/` on `localhost` (a secure context, like GitHub Pages).
- **Browser.** Headless Chrome 154 driven by puppeteer-core. Each round uses
  a new temporary profile, and the harness closes Chrome by its own PID.
  Background networking, component updates and sync are switched off.
  Chrome's fake microphone plays `tests/audio/fixtures/voice-200hz-10s.wav`.
- **Flow.** Open the page, answer "Get Started", the direction question and
  Continue (which starts listening), wait for both ready messages, then open
  the Resonance lab tab and wait for its voice model (`pnml`).
- **Requests.** Logged over CDP for the page and for every dedicated worker
  (`Target.setAutoAttach`, flattened sessions, `Network.enable` per worker).
  A Chrome net log of each browser process is the cross-check: it counts
  every `URL_REQUEST_START_JOB`, split by initiator into "app" (the page
  origin) and "browser-internal" (Chrome's own services).
- **Timing.** The page wraps `Worker` and timestamps worker messages.
  - "model" is the gender worker's `status: ready`.
  - "detector" is its `speech-detector: ready`.
  - Both are timed from the gender worker's construction.
  - "lab" is the lab worker's `pnml` ready, timed from the lab worker's
    construction.
- **Phases.**
  - cold: a new profile.
  - warm: reload in the same browser process, then start again.
  - return: a new browser process on the same profile.
- **Rounds.** Three rounds, on this PC's home connection. The scratch probe
  (`probe.mjs` + `analyze.py`) is not committed.

### What is fetched from jsDelivr

Only the ONNX Runtime WebAssembly runtime: the files Transformers.js 4.2.0
points `env.backends.onnx.wasm.wasmPaths` at by default
(`src/backends/onnx.js`). The URL is
`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/`.
Transformers.js picks one of two variants:

| browser | factory (.mjs) | runtime (.wasm) |
|---|---|---|
| all but Safari | `ort-wasm-simd-threaded.asyncify.mjs` | `ort-wasm-simd-threaded.asyncify.wasm` |
| Safari | `ort-wasm-simd-threaded.mjs` | `ort-wasm-simd-threaded.wasm` |

Sizes are the same bytes as `node_modules/onnxruntime-web/dist`:

| file | raw bytes | jsDelivr br | jsDelivr gzip | gzip -6 of the local file |
|---|---|---|---|---|
| asyncify .mjs | 47,389 | 17,958 | 17,524 | 17,603 |
| asyncify .wasm | 23,567,050 | 4,732,131 | 5,680,407 | 5,751,977 |
| plain .mjs (Safari) | 24,180 | 9,285 | 9,035 | 9,068 |
| plain .wasm (Safari) | 12,942,611 | 2,764,690 | 3,293,873 | 3,311,304 |

jsDelivr sends `Cache-Control: public, max-age=31536000, immutable`.

Requests seen in Chrome (headless Chrome is not Safari, so the asyncify
variant), 3 rounds:

| phase | worker | file | from | encoded bytes | time |
|---|---|---|---|---|---|
| cold | gender | asyncify .wasm | network | 4,737,826 | 336 ms (331–355) |
| cold | gender | asyncify .mjs | network | 18,774 | 88 ms (82–145) |
| cold | gender | asyncify .wasm, .mjs | HTTP cache (second fetch) | 0 | 137 / 4 ms |
| cold | lab | asyncify .wasm, .mjs | HTTP cache | 0 | 115 / 3 ms |
| warm, return | gender, lab | asyncify .wasm, .mjs | HTTP cache | 0 | 118–147 / 3–4 ms |

- **Two fetches per worker.** The gender worker fetches each file twice in
  a cold start. Transformers.js pre-loads the binary and factory
  (`useWasmCache`) and keeps a copy in its `transformers-cache` Cache
  Storage. The speech detector creates its ORT session directly, so ORT also
  fetches the runtime itself, which the HTTP cache serves.
- **Lab worker.** It turns Transformers.js caching off, so it reads the
  runtime from the HTTP cache.

The net log agrees. Every app-initiated request went to one of four hosts:
`localhost` (129), `huggingface.co` (63), `us.aws.cdn.hf.co` (9) and
`cdn.jsdelivr.net` (42). Chrome's own background requests (Google update and
account hosts) are browser-internal, not from the app.

### Readiness, median (range), ms

| phase | voice model | speech detector | lab model |
|---|---|---|---|
| cold | 3192 (2900–3591) | 2396 (2251–2643) | 1012 (835–1042) |
| warm | 1082 (903–1134) | 1082 (902–1134) | 1023 (909–1109) |
| return | 1106 (1022–1110) | 1105 (1021–1110) | 1004 (989–1088) |

Cold time is mostly the 16 MB voice model and the 2.3 MB detector model from
Hugging Face. The runtime download (≈ 0.34 s) runs in parallel with them.

### The build already contains the runtime (unused)

The `vite build` of 5db2663 already emits
`assets/ort-wasm-simd-threaded.asyncify-DMmc6YqF.wasm` (23,567,050 bytes, the
largest file; `dist/` 25 MB). The ORT bundle that Transformers.js imports
references it through `new URL(…, import.meta.url)`. Transformers.js sets
`wasmPaths` to jsDelivr when it loads, so the app never requests that file.
The live site has it too. Served by GitHub Pages, it comes as
`Content-Type: application/wasm` with `Content-Encoding: gzip`: 5,862,143
bytes, `Cache-Control: max-age=600`, with an ETag.

Download of the asyncify `.wasm` from this PC, 5 runs each with
`Cache-Control: no-cache`:

| source | bytes on the wire | time |
|---|---|---|
| jsDelivr | 4,732,131 (br) | 0.21–0.23 s |
| GitHub Pages | 5,862,143 (gzip) | 0.23–0.27 s |

So serving the runtime from Pages costs about 1.1 MB (24 %) more on the wire
in a cold start, because Pages serves gzip and not Brotli. On this connection
that is about 20–40 ms. Pages' 10-minute `max-age` (instead of `immutable`)
means a revalidation (304) after 10 minutes. The file name carries a content
hash, so a stale copy can never be served for a newer build.
Transformers.js's Cache Storage copy of the runtime is keyed by URL and
avoids even that revalidation.

## 2. Plan (written before the change)

- **Ship the runtime.** Ship only the two variants Transformers.js selects
  (asyncify, and plain for Safari), from `node_modules/onnxruntime-web/dist`
  (the same package version as the bundled ORT JavaScript). Vite emits them
  as content-hashed assets through explicit `?url` imports. The asyncify
  `.wasm` is the file already emitted today, so it is de-duplicated.
- **Point ORT at them.** Set `wasmPaths` to the app-hosted URLs. The variant
  Transformers.js chose is kept, and only the host changes. Do this in the
  gender worker (on the ORT instance shared with the speech detector) and in
  the lab worker (its own instance), right after Transformers.js is
  imported. Nothing else changes.
- **Pass if:**
  - No app-initiated request goes to any host except the app origin,
    `huggingface.co` and its CDN (`*.hf.co`), in either log, in every
    phase, including the lab.
  - Voice model, detector and lab all report ready in every run.
  - The largest built file is under GitHub Pages' 100 MB limit.
  - `vite preview` serves `.wasm` as `application/wasm`.
  - Readiness times are reported against section 1 on the same harness.
    Localhost does not model the wire, so the wire cost is the Pages vs
    jsDelivr figure above.

## 3. After (branch self-host-ort)

### Change

- **Shipped files.** `src/ml/ort-runtime-files.js` imports
  `onnxruntime-web/ort-wasm-simd-threaded{.asyncify,}.{mjs,wasm}?url`, all
  four subpaths that `onnxruntime-web` exports. Vite emits them unmodified as
  content-hashed assets in `assets/`.
- **Re-pointing.** `pointOrtAtAppRuntime(env.backends.onnx.wasm)` replaces
  Transformers.js's jsDelivr `wasmPaths` with the app URLs. It keeps the
  variant Transformers.js chose (`src/ml/ort-wasm-paths.js`, pure).
  - The gender worker calls it once at module load, before any session. The
    speech detector shares that ORT instance.
  - The lab worker calls it right after its dynamic import of
    Transformers.js.
- **Guard.** `tests/ml/ort-runtime-files-test.js` (32 checks, in
  `test:unit`) covers:
  - the variant mapping;
  - the installed Transformers.js asking only for shipped variants;
  - the `onnxruntime-web` version matching Transformers.js's pin, with no
    nested copy;
  - both workers being wired.

### Build output

| | 5db2663 | self-host-ort |
|---|---|---|
| `dist/` total | 25,494,793 B | 38,511,208 B (+13.0 MB) |
| largest file | `ort-wasm-simd-threaded.asyncify-DMmc6YqF.wasm`, 23,567,050 B | same file, same hash, 23,567,050 B |
| added files | — | `ort-wasm-simd-threaded-DG5OvNve.wasm` 12,942,611 B (Safari), `ort-wasm-simd-threaded.asyncify-CVnZHRES.mjs` 47,389 B, `ort-wasm-simd-threaded-CSWrxU1M.mjs` 24,180 B |
| gender / lab worker chunk | 534,555 / 38,477 B | 535,671 / 39,596 B |

- **Size limits.** The largest file is 23.6 MB, under GitHub Pages' 100 MB
  per-file limit. The site stays far below Pages' 1 GB limit.
- **Asyncify runtime.** The asyncify `.wasm` was already in the build (see
  section 1), and the `?url` import de-duplicates onto it.
- **Safari runtime.** The plain `.wasm` is downloaded only by Safari.
  Chrome, Edge and Firefox fetch only the asyncify pair.

### MIME types (`vite preview`)

| file | Content-Type |
|---|---|
| `.wasm` | `application/wasm` |
| `.mjs` | `text/javascript` |

ORT's streaming compile (`instantiateStreaming`) needs `application/wasm`.
GitHub Pages already serves the deployed `.wasm` as `application/wasm`
(section 1).

### Requests

Same probe and flow as section 1.

- **Runs.** `vite preview`: 7 runs of each phase. A Pages-like server: 5
  runs per phase, of which 2 with `max-age=600` and 3 with `max-age=0`. The
  Pages-like server is a scratch static server with Pages' headers: gzip,
  ETag, `Vary`, and `application/wasm`. In 6 of the 7 `vite preview` runs
  per phase, the Resonance lab was opened too. The Pages-like runs did not
  open the lab.
- **Hosts, both logs.** Every app-initiated request went to the app origin,
  `huggingface.co` or `us.aws.cdn.hf.co`. There were 0 requests to
  `cdn.jsdelivr.net` or any other host, in every phase and every worker,
  the lab included. Before the change, 92 such requests in `vite preview`
  runs went to jsDelivr.
- **Runtime fetches.** The gender worker fetches the asyncify `.mjs` and
  `.wasm` from the app origin. Cold, that is 23.6 MB uncompressed on
  `vite preview` (gzip on Pages: 5.86 MB). Warm and return visits are a
  127–179 B revalidation. The lab reads the same URLs from the HTTP cache.
- **Readiness.** The voice model, the speech detector and the lab model
  were ready in every run. No worker reported an error.
- **Dev server.** The `npm run dev` server also loads all three, from the
  `/@fs/` URLs of the same package files, with 0 jsDelivr requests.
- **Both variants work.** Each variant was loaded from the build's assets
  into the ORT bundle Transformers.js imports (`ort.webgpu.bundle.min.mjs`,
  in a module worker in Chrome 154). Each ran the Silero model 5 frames,
  and the two gave identical outputs. This was a forced check: Chrome is
  not Safari, and no Safari was run.

### Readiness, median (range), ms

Each cell is base → self-host-ort.

| server | phase | voice model | speech detector | lab model |
|---|---|---|---|---|
| `vite preview` (`no-cache`, no gzip) | cold | 3367 → 3506 | 2626 → 2561 | 1093 → 1037 |
| | warm | 1198 → 1386 | 1134 → 1294 | 1138 → 1124 |
| | return | 1199 → **1794** (1652–2220) | 1199 → 1340 | 1051 → 1047 |
| Pages-like, `max-age=600` | cold | 3749 → 3414 | 2665 → 2775 | — |
| | warm | 1152 → 1186 | 1152 → 965 | — |
| | return | 1184 → 1095 | 1184 → 1094 | — |
| Pages-like, `max-age=0` (Pages after 10 min) | cold | 3226 → 3599 | 2527 → 2968 | — |
| | warm | 1116 → 1036 | 1116 → 1036 | — |
| | return | 1036 → 1079 | 1036 → 866 | — |

- **Noise.** Other jobs shared this PC, so run-to-run spread is ±300–500 ms.
  The interleaved base / self-host-ort runs agree with the blocked ones.
- **Cold start.** It is dominated by the 16 MB voice model and the 2.3 MB
  detector from Hugging Face, and moves within noise in both directions.
  Localhost does not price the wire. On the real network the runtime costs
  about 1.1 MB more cold (Pages gzip vs jsDelivr Brotli), which is
  20–40 ms on this connection (section 1).
- **Return visits on `vite preview`.** These are about 0.6 s slower for the
  voice model (7 / 7 runs ≥ 1.65 s vs ≤ 1.38 s base). This does not happen
  under the Pages-like headers, with either `max-age=600` or `max-age=0`.
  Without gzip, the Pages-like server lands in between (1159–1519 ms, 3
  runs). So it is a property of how `vite preview` serves the 23.6 MB
  runtime (uncompressed, `no-cache`, mtime-based ETag). The app does not
  cause it, and on GitHub Pages it was not seen.

### Verdict

Pass on every pre-registered criterion:

- no app request to a host other than the app origin, `huggingface.co` or
  its CDN;
- all three models ready in every run;
- largest file 23.6 MB;
- `.wasm` served as `application/wasm`;
- timing reported above.

**Cost:**

- **Build size.** The build grows by 13.0 MB, mostly the Safari runtime,
  which other browsers never download.
- **Cold download.** About 1.1 MB more on the wire per cold start, from
  gzip instead of Brotli.
- **Revalidation.** Return visits more than 10 minutes apart revalidate
  the runtime (a 304) instead of jsDelivr's `immutable`.

**Not measured:**

- Safari itself.
- A phone.
- The deployed site. Its headers are known from section 1, and the branch
  is not deployed.

### Checks on the branch

- **Lint and unit tests.** `npm run lint` passes. `npm run test:unit`
  passes 25/25 scripts, including the new `ort-runtime-files-test.js`.
- **Build.** `npm run build` gives the same asset hashes as above.
- **Voice-direction smoke.** `scripts/voice-direction-smoke.mjs --diag=1`
  passes 59/59 on the built app. The detector is ready, from the network
  on the first visit and from cache later.
- **Lab smoke.** `scripts/resonance-lab/lab-smoke.mjs` passes all four
  runs:
  - no lab activity until the tab is opened;
  - the lab works once opened;
  - the tab opened before listening;
  - the phone layout.
- **Timing figures in these runs.** The smoke runs' timing figures are not
  readiness evidence. Other jobs loaded this PC, and a resource governor
  paused processes.
