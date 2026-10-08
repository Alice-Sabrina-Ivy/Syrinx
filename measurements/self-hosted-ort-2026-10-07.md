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
