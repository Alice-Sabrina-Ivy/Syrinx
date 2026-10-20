# Voice preview, Phase 1 (lab version): design and acceptance — 2026-10-19

**Status: design only.** Written and committed before any Phase 1 code exists. The build follows
this note. Any change to it is recorded under "Deviations" at the end, with its date and reason;
the text above that section is not edited afterwards.

**Branch:** `voice-preview`, started from `cue-strip` at 62bf3cc. No PR without the user's
explicit go-ahead (CLAUDE.md hard rule 1).

**Inputs:**

- The scoping document (`VOICE-PREVIEW-SCOPING.md`, 2026-10-12; scratch research kept outside
  this repository), sections 1, 6, 7 and 8.
- The Phase 0 spike: branch `voice-preview-spike` at 3f7603f,
  [voice-preview-spike-2026-10-12.md](voice-preview-spike-2026-10-12.md) and
  `scripts/voice-preview/` on that branch (`build.mjs`, `wasm/vp_world.cpp`, `lib/`,
  `worker/vp-worker.js`, `timing/`).
- The spike's phone session (2026-10-19, Pixel 11 Pro XL, Tensor G6, Chrome 155.0.8059.81):
  **WORLD at 48 kHz with front end F-S passed the gate on both clip sets.** 5 s phrases, SIMD
  build:

  | Clip set | First render (analysis + first render), median / worst-clip p90 | Slider change, median / worst-clip p90 | Module load (C0) |
  |---|---|---|---|
  | pre-registered | 0.84 / 0.97 s | 0.24 / 0.32 s | 0.05 s |
  | speech-dense | 1.17 / 1.42 s | 0.23 / 0.36 s | 0.05 s |

  Margin ×2.11 (the phone could be 2.11× slower and still pass: 3.0 s / 1.42 s). The 54 identity
  outputs were bit-identical to Node on the phone. 44.1 kHz devices run WORLD at 44.1 kHz (A3:
  within 5 % of 48 kHz on the desktop). 3 s and 8 s phrases were not timed on the phone (deferred,
  S2).

**Approved v1 scope (user decisions, restated so this note is self-contained):**

- An experimental "Voice preview" card in the Resonance lab tab, loaded only when opened.
- Recordings made in the app only (no file import), 3–8 s, auto-stop at 8 s.
- Analysis once, in a Worker: WORLD WebAssembly, SIMD with a non-SIMD fallback, at the capture
  rate up to 48 kHz. F0 front end F-S: Syrinx's own posted pitch track during the recording, then
  StoneMask.
- Pitch slider in semitones relative to the user's median, shown as "+4 st, about 166 Hz",
  limits ±12 st, plus the low-contour limit (the shifted 5th percentile stays ≥ 75 Hz).
  Resonance slider as a formant scale, shown as %, limits ×0.79–×1.26. Small default steps
  (±2 st, ±3 %). Re-render on slider release.
- Three-way playback (preview / unchanged rebuild / original) with loop.
- Direction-neutral presets: small step higher & brighter, small step lower & darker, pitch
  only, resonance only, toward a pitch target the user chooses.
- Lowered previews labelled "may sound buzzier". The caveat, word for word: "A rough sketch from a
  vocoder; crackle or buzz comes from the processing, not your voice."
- Record, then play only; never live.
- Audio held in memory, discarded on Discard or tab close; Download WAV only on explicit action.
- No gender words on the controls, no scores.
- **Hum and noise (user decision 2026-10-19):** detect a steady hum, and high background noise,
  in the recording or the seconds before it, using what Syrinx already has (the pitch worker's
  tonal-noise detector, a level check). Show a short notice suggesting a quieter spot, but still
  allow the preview.
- Third-party notices for WORLD and the Emscripten / musl runtime in the repo's notices system.
- The built `.wasm` and glue are committed, with the pinned, reproducible build script and their
  recorded hashes.

## 1. Decisions this design takes

| Question | Decision | Why |
|---|---|---|
| Engine, rate, front end, build | WORLD, F-S, 5 ms frames; engine rate = the capture rate if ≤ 48 kHz, else 48 kHz (resampled down); SIMD build where `WebAssembly.validate` accepts the spike's SIMD probe, else non-SIMD | The spike's verdict and its A3 rule. No rate is ever resampled up |
| Which binaries ship | **The spike's build, byte for byte** (sha256 below) | The phone gate timed exactly these bytes. The build pins and the C source path stay as in the spike, so a rebuild gives the same hashes |
| PSOLA | Not shipped | Only a fallback if WORLD failed the gate; it passed |
| Where the card lives | A third view of the lab tab's view switch: "Resonance · Weight × clarity · **Voice preview**", showing one card | The four-readout phone layout (sized to fit every card on one screen) stays unchanged, and "loaded only when opened" is one explicit tap. The user can veto this; the alternative is a card below the four readouts |
| Listening | Required to record (the posted pitch track exists only while listening). The lab tab is shown only while listening, so the card is too | No change to the app's idle screens |
| Hum check timing | Record is enabled once listening has run ≥ 6 s | The notch needs about 5.5 s of a hum to flag it (spike §P7: with a 10 s pre-roll it flagged all 24 in-range hum conditions; from the recording alone, 3 of 24) |
| First render after analysis | The unchanged rebuild (0 st, ×1.00); a preview is rendered when a setting changes | The rebuild is needed for the three-way comparison anyway; the sliders start at 0 |
| Playback while listening | Allowed, with a one-line note; **blocked while a Dashboard session recording runs** | Echo cancellation is off (`useAudioPipeline.js`), so the mic hears the speaker. Saved sessions must not count vocoded audio as the user's voice |
| Meter readings on the preview | None in v1 | "No scores" |

## 2. Module layout

All new app code lives in `src/voice-preview/`. Only `bridge.js` is in the main bundle.

| Path | Bundle | What |
|---|---|---|
| `bridge.js` | main | The capture handle (sample rate, `connect()`, `disconnect(port)`, listening start time) that the pipeline registers while listening, and the posted-pitch tap. About 40 lines; no imports |
| `VoicePreviewCard.jsx` | lazy chunk, loaded when the view is opened | The card UI |
| `controller.js` | same chunk | Module-level state store (survives view and tab switches, like `labPipeline.js`): worker lifecycle, recording control, forwarding posted pitch to the worker, render queue, download |
| `playback.js` | same chunk | Playback AudioContext: three versions, loop, switching keeps the position |
| `controls.js` | same chunk (pure; tested in Node) | Median, 5th percentile, limits, value labels, `aria-valuetext`, presets, target mapping |
| `strings.js` | same chunk (pure; tested) | Every user-facing string (§9) |
| `wav.js` | same chunk (pure; tested) | 16-bit PCM mono WAV encoder |
| `wasm-files.js` | same chunk | `?url` imports of the glue and both `.wasm` files (the `ort-runtime-files.js` pattern: content-hashed assets in `dist/assets/`) |
| `vp-worker.js` | its own worker chunk | Message handling (§4). No `?url` imports, so Node tests drive it with file URLs |
| `recorder.js` | worker (pure; tested) | Chunk collection, 8 s cap, level, matching posted pitch to chunks |
| `checks.js` | worker (pure; tested) | Hum flag, level margin, voice sufficiency (§7) |
| `engine/world.js` | worker | The spike's `lib/world-engine.js`: `createWorld` (allocation helpers, FFT size, synthesis length) and `WorldSession` with the "init" front end path. Harvest / DIO helpers dropped |
| `engine/frontend.js` | worker | The spike's `lib/frontends.js`: `roundHalfEven`, `framesFor`, `frameTimes`, `mapTrack`, `postedToFrames` |
| `engine/finish.js` | worker | The spike's `finish` (from `lib/psola.js`, that function only) |
| `engine/preview.js` | worker | The spike's `lib/preview-core.js`, WORLD + F-S only: `resampleClip` (the lab's `src/resonance-lab/sinc-resampler.js`, imported, not copied), `analyse`, `render` |
| `wasm/vp_world.mjs`, `wasm/simd/vp_world.wasm`, `wasm/nosimd/vp_world.wasm`, `wasm/BUILD.json` | assets, fetched by the worker | The spike's build and its pins and hashes |

Changes outside `src/voice-preview/`:

- `src/audio/useAudioPipeline.js`: register the capture handle when listening starts and clear it
  when listening stops; one call `voicePreviewPitchTap(msg)` at the end of `handlePitchMessage`.
  No other change; nothing happens when no tap is installed.
- `src/resonance-lab/LabView.jsx`: the third view option and a `lazy()` import of the card.
- `src/App.jsx`: `LabView` receives `voicePreview={{ direction, isSessionRecording }}`
  (`isSessionRecording = () => sessionRef.current.recording`).
- `scripts/voice-preview/build.mjs`, `scripts/voice-preview/wasm/vp_world.cpp`,
  `scripts/voice-preview/lib/paths.mjs`: copied from the spike unchanged (same paths, so the
  `-ffile-prefix-map` options give the same bytes). `build.mjs` gains `--ship` (copy the outputs
  into `src/voice-preview/wasm/` and write `BUILD.json`) and `--check-shipped` (rebuild and
  require byte-identity with the committed files).
- `scripts/voice-preview/make-spike-parity.mjs` (expected outputs from the spike's own code, §5),
  `scripts/voice-preview/bundle-budget.mjs` (§11), `scripts/voice-preview-smoke.mjs` and
  `scripts/voice-preview-smoke-wavs.mjs` (§14).
- Notices: `scripts/third-party-notices.mjs`, `THIRD_PARTY_NOTICES.md`, `licenses/world/`,
  `licenses/emscripten/` (§12).
- `.gitattributes`: `src/voice-preview/wasm/** -text`, `licenses/world/** -text`,
  `licenses/emscripten/** -text` (this checkout has `core.autocrlf=true`; without it the glue's
  hash would change on a Windows checkout).
- `eslint.config.js`: ignore `src/voice-preview/wasm` (generated code).
- `tests/voice-preview/` (§14); CLAUDE.md current-state row and regression-checklist line.

**Not changed (hard rule 3):** `boersma-ac.js`, `pitch-worker.js`, `dsp-worker.js`,
`gender-worker.js`, `pitchSmoothing.js`, `pitchGate.js`, `cpp.js`, `noise-notch.js`, the lab
engine, VTLN and the resonance cue. The preview only reads their outputs.

## 3. Recording: raw audio and the posted pitch track

**Raw audio: a capture consumer, only while recording.** When the user presses Record, the
controller calls the bridge's `connect()` (`captureSource.connectConsumer()`, as the lab does) and
transfers the port to the voice-preview worker. The capture source broadcasts each 25 ms chunk
(`{ buffer, contextTime }`, `chunkSize = floor(0.025 × sampleRate)`) to every port, so the
recording starts on a chunk boundary. When the recording ends, the controller calls
`disconnect(port)`. No audio reaches the voice-preview worker outside a recording.

- The worker keeps whole chunks in a buffer pre-allocated for 8.0 s at the capture rate, and the
  `contextTime` of each chunk.
- **Auto-stop:** the worker stops before the chunk that would take the recording past
  8.0 s × capture rate samples (8.000 s at 48 kHz; 7.996 s at 44.1 kHz), tells the main thread,
  and drops any chunk that arrives after that.
- **Too short:** a recording under 3.0 s is not analysed ("too short", §9).
- Chunks keep the capture's float32 samples unchanged.

**Posted pitch track (F-S): forwarded from the hook.** While a recording runs, and until its
track is complete, the controller installs the bridge's tap. The tap receives every
pitch-worker `pitch` message that `handlePitchMessage` handles and forwards
`{ contextTime, pitch, notched: notchedFreqs?.length > 0 }` to the worker. The tap runs after
everything the hook already does and changes no state.

- **Matching.** The pitch worker posts each decoded frame with the `contextTime` of its own chunk
  (the decode runs L = 2 chunks late). Every port receives the same `contextTime` value, so the
  worker assigns a posted value to recorded chunk k by exact equality. If that fails, it takes the
  nearest chunk within half a chunk. Messages for chunks outside the recording are ignored.
- **Track:** a `Float32Array` with one value per recorded chunk, Hz, 0 = unvoiced (null) — the
  spike's format (`prep/tracks.mjs`). The float32 rounding is part of the spike's maths.
- **Complete:** when the posted value for the last recorded chunk has arrived, or 500 ms after the
  recording ended. Values still missing then are 0. (Normally the last value arrives about 50 to
  100 ms after the stop, because listening goes on. The spike's offline tracks always had their
  last two hops unvoiced, because its clips ended there. That is a difference in the input, not in
  the maths.)
- **Timing convention (the spike's F-S rule, unchanged):** hop k describes the 80 ms window
  centred at (k + 1) × 25 ms − 40 ms from the recording's first sample. At 44.1 kHz the chunks are
  1102 samples (24.99 ms), so the times drift by at most 3.6 ms over 8 s, well inside the mapping's
  12.5 ms nearest-hop reach (the spike accepted the same with 1103-sample hops, deviation 28).

**When listening is off or stops:**

- The lab tab, and so the card, is shown only while listening, so Record is reachable only while
  listening. The preview state lives in the controller, so a stop and a restart of listening keep
  a finished preview.
- Record stays disabled until listening has run 6 s ("Ready to record in N s", §9), so the notch
  has had time to flag a hum.
- Listening stops during a recording: the bridge's handle is cleared, the controller cancels the
  recording and drops its audio ("Recording stopped because listening was turned off.").
- Listening stops during analysis: analysis finishes in the worker. The result is there when the
  card is shown again.
- Playback is not reachable while listening is off (the card is hidden). That is a v1 limit; the
  fix would be to show the lab tab while idle (later, if wanted).

## 4. Worker API and memory

One module Worker per card session, created when the card is first opened. It loads the module
(C0 about 0.05 s on the phone) while the user gets ready, so loading never delays a recording.

Main thread → worker:

| Message | Fields | Effect |
|---|---|---|
| `init` | `glueUrl`, `wasmUrls: { simd, nosimd }` | Picks the build with the spike's SIMD probe. Imports the glue and instantiates with `locateFile` → the chosen `.wasm`. If the SIMD build fails to compile or instantiate, it retries once with the non-SIMD build. Replies `ready { build, ms }`, or `error { stage: "load" }` |
| `record` | `port` (transferred), `sampleRate`, `maxS: 8`, `minS: 3` | Starts collecting chunks. Posts `level { rms, peak, seconds }` every 4th chunk (100 ms) for the level bar. At the cap it posts `recorded { seconds, reason: "max" }` |
| `stop` | — | Ends the recording: `recorded { seconds, reason: "user" }`, or `too-short { seconds }` |
| `cancel` | — | Drops the recording; replies `cancelled` |
| `pitch` | `contextTime`, `pitch` (Hz or null), `notched` | One forwarded posted value |
| `render` | `id`, `st`, `pct` | One preview render; replies `rendered` |

Worker → main thread:

| Message | Fields |
|---|---|
| `ready` | `build: "simd" \| "nosimd"`, `ms` |
| `level` | `rms`, `peak`, `seconds` |
| `recorded`, `too-short`, `cancelled` | `seconds`, `reason` |
| `analysed` | `rate` (engine), `captureRate`, `seconds`, `check { hum, noise, marginDb, voicedS }`, `pitch { medianHz, p5Hz }`, `limits { stMin, stMax: 12, pctMin: -21, pctMax: 26 }`, `ms` (per stage, as in the spike), `memBytes`; transfers `original` (float32 at the capture rate; at the engine rate if the capture rate is above 96 kHz) and `rebuild` (float32 at the engine rate) |
| `no-voice` | `voicedS` |
| `rendered` | `id`, `st`, `pct`, `pcm` (transferred), `rate`, `ms` |
| `error` | `stage: "load" \| "record" \| "analyse" \| "render"`, `kind: "memory" \| "other"`, `message` |

The worker starts the analysis itself once the track is complete (§3). The controller keeps at
most one render in flight and one waiting; a newer request replaces the waiting one.

**Memory.**

| Where | What | Size (8 s) |
|---|---|---|
| Worker, JS | Recording buffer, float32, pre-allocated | 1.5 MB at 48 kHz (3 MB at 96 kHz) |
| Worker, WebAssembly | Clip (float64), F0, envelope, aperiodicity, their warped copies, output; growth allowed, never shrinks | measured in the spike: 92 MB at 48 kHz, 76 MB at 44.1 kHz, 38 MB at 16 kHz (58 / 57 / 23 MB for 5 s) |
| Main thread | Original, rebuild and preview `AudioBuffer`s; one render in transit; a WAV blob only while downloading | ≤ 1.5 MB each at 48 kHz |

- A failed `malloc` or memory growth becomes `error { kind: "memory" }`, and the card says so
  (§9).
- **Release:** Discard and "Record again" terminate the worker (all WebAssembly memory goes back)
  and start a fresh idle worker. Page hide (`pagehide`) terminates the worker and closes the
  playback AudioContext. Switching views or tabs keeps everything (like the lab).

## 5. Render pipeline: exactly the spike's maths

Given the recorded float32 PCM at capture rate `srIn` and the posted track (§3):

1. **Engine rate:** r = srIn if srIn ≤ 48 000, else 48 000.
2. **Resample** (only when srIn > 48 000): the spike's `resampleClip`: the lab's
   `createSincResampler(srIn, r, { cutoffHz: 0.45 r })`, fed in 25 ms chunks, flushed with zero
   chunks, output length round(n × r / srIn).
3. **Front end F-S:** `postedToFrames(track, n, r, 5)`. WORLD frame i at t = i × 5 / 1000 s;
   p = (t + 0.015) / 0.025; both neighbours voiced → log-linear interpolation; otherwise the
   nearest hop (round half to even) if |p − jn| ≤ 0.75, else unvoiced. Frame count
   trunc(n / r × 1000 / 5) + 1.
4. **Analysis**, pyworld 0.3.5 defaults: StoneMask on the mapped F0; CheapTrick (q1 −0.15, F0
   floor 71 Hz, FFT size by WORLD's rule: 2048 at 32–48 kHz, 1024 at 16–24 kHz); D4C (threshold
   0.85, the CheapTrick FFT size).
5. **Render (st, pct):** a = (100 + pct) / 100 (so 3 % gives exactly the double 1.03, as in the
   spike's literals). F0 × 2^(st / 12) on every frame (unvoiced stays 0). Envelope warp `vp_warp`
   when a ≠ 1: ln S′(f_k) = interp(f_k / a; f, ln max(S, 1e-16)), A′ = clip(interp(f_k / a; f, A),
   0, 1). Synthesis with the same FFT size and frame period. The output is trimmed or zero-padded
   to n samples.
6. **Finish:** RMS-match to the input over the whole clip, then scale down if the absolute peak
   exceeds 0.99; float32 out.

- **Deterministic and order-free:** WORLD reseeds its noise at every `Synthesis()` call, so a
  render depends only on the analysis and (st, pct), never on earlier renders.
- **Bit-identity, the acceptance test.** For the same input PCM and posted track, every finished
  render from `src/voice-preview/engine/` equals, as float32 bytes (sha256), the output of the
  spike's own `Preview` class (3f7603f, `lib/preview-core.js`, engine "world", front end "S",
  frame period 5, `first` = the same cell). This holds for both builds.
- `make-spike-parity.mjs` runs the spike's code (extracted from the spike commit with
  `git archive`) on the fixtures with the committed `.wasm`. It writes the expected hashes, the
  input hashes and the spike commit into `tests/voice-preview/fixtures/spike-parity.json`.
- The fixtures:
  - the three committed LibriSpeech 16 kHz clips (`tests/resonance-lab/fixtures/ls_*.wav`,
    CC BY 4.0), at 16 kHz and upsampled to 44.1 and 48 kHz with the lab's sinc resampler;
  - one of them upsampled to 96 kHz, for the resample-down path.
- Their posted tracks come from the real pitch chain (`scripts/session-oracle/lib/chain.mjs`
  `runWorkers`) at each input rate. They are committed in the JSON, so the parity test does not
  depend on future pitch-worker changes.
- Cells: (0, 0), (+2, +3), (−2, −3), (+4, 0), (0, +6), (+12, +26), (−12, −21).

## 6. Pitch and resonance controls

**The user's median and low end.** v = the voiced values (> 0) of the posted track, sorted.
Percentile q = linear interpolation at index (len − 1) × q (numpy's default): median = q 0.50,
p5 = q 0.05.

**Pitch slider.**

- Integer semitones.
- Max = +12. Min = max(−12, ⌈12 × log2(75 / p5)⌉), so the shifted 5th percentile stays ≥ 75 Hz.
  Posted values are ≥ 75 Hz (detector floor), so the min is ≤ 0. At p5 = 75 Hz, lowering is off.
- Value label: "+4 st, about 166 Hz", where Hz = round(median × 2^(st/12)) — the median times the
  ratio, not a re-measurement. "0 st, about 148 Hz". Negative values use "−" (U+2212) and add
  "· may sound buzzier".
- When the min is above −12, a note under the slider says why (§9).

**Resonance slider.**

- Integer percent from −21 to +26, so a = 0.79 to 1.26.
- Value label: "+6 %", "0 %", "−3 %".
- End words, the lab's axis words: "larger / darker" (left), "smaller / brighter" (right). Pitch
  end words: "lower" / "higher".

**Commit (re-render on release).**

- Pointer: on release (`pointerup` / the native `change` event).
- Keyboard: 400 ms after the last key change. Arrows ±1, Page Up/Down ±3, Home/End = the limits.
- Labels update live while dragging; rendering waits for the commit.
- A commit that matches the last rendered setting does nothing.

**Presets (buttons; each commits at once):**

| Button | Sets |
|---|---|
| Small step higher & brighter | +2 st, +3 % |
| Small step lower & darker | −2 st, −3 % (pitch clamped to the min) |
| Pitch only | resonance → 0 %, pitch kept |
| Resonance only | pitch → 0 st, resonance kept |
| Toward my pitch target… | opens a row: "Target pitch (Hz)", a number field (75–400, step 1) and "Apply" |
| Unchanged | 0 st, 0 % |

- **Target.** Apply sets st = clamp(round(12 × log2(target / median)), min, +12) and keeps the
  resonance.
- The field is prefilled with the geometric centre of the user's own training-direction pitch
  band, if one is set (`PITCH_TARGETS`: 205, 115 or 159 Hz), else left empty. It never names the
  direction.
- The result line reads "Set to +5 st (about 204 Hz)", or "…, the highest setting" /
  "…, the lowest setting" when the value was clamped.

## 7. Recording check: hum, noise, enough voice

**Hum.**

- Signal: the pitch worker's notch state, `notchedFreqs` on the posted messages (the tonal-noise
  detector Syrinx already runs).
- Rule: flag if any posted message for a recorded chunk carries at least one active notch line.
- The seconds before the recording count through the notch's own memory: a hum must be stable for
  about 5 s to promote, and Record waits until listening has run 6 s. (Spike §P7: with a pre-roll
  the notch flagged every fan-hum and mains-complex condition, −40 to −20 dB, and no clean clip.)
- Any active line counts, mains hum included: the notice is true either way.

**Background noise.**

- Signal: the spike's level check d2 (`hum/hum-run.mjs` `levelMargin`, copied as is). Margin =
  95th − 10th percentile of the energies of non-overlapping 20 ms frames
  (10 log10(mean x² + 1e-20)) over the recording at the capture rate, linear-interpolated
  percentiles.
- Rule: flag if the margin is **< 30 dB** (`NOISE_MARGIN_DB`).
- The threshold is a design choice made after the spike's data. The pre-registered 25 dB caught
  only +10 dB SNR pink noise. The spike's clips measured:
  - clean clips 39.1–60.1 dB (speech-dense 40.7–54.1 dB);
  - pink noise at +20 dB SNR 29.0–31.3 dB, at +10 dB SNR 19.1–21.5 dB;
  - hum at −20 dB 26.8–28.9 dB.
- 30 dB flags all of the +10 dB SNR noise and the −20 dB hum, and keeps 9 dB below the quietest
  clean clip. Real rooms are noisier than these studio clips, and a notice that fires in every
  ordinary room would be noise itself. The phone check (§15) looks at this.

**Enough voice.** If fewer than 40 posted hops (1.0 s) are voiced, there is no preview; the
"not enough voice" state is shown (§9).

**What a flag does:** a notice above the sliders (wording in §9). The preview is made and works
as usual.

## 8. Playback

- One playback AudioContext, created on the first Play press (a user gesture, as autoplay rules
  require), suspended when nothing plays, closed on page hide.
- Each version is an `AudioBuffer` at its own rate (original: capture rate; rebuild and preview:
  engine rate), played through an `AudioBufferSourceNode`. The versions have the same length and
  RMS (`finish`), so their loudness matches.
- **Play:** a version starts from the beginning, or from the current position if another version
  is playing (A/B switching keeps the position). Pressing the playing version again stops it.
- **Loop:** a toggle; it applies to whatever plays.
- **Stop:** a button while anything plays.
- A new preview render arriving while the preview plays takes over at the same position.
- **Disabled while recording or analysing.**
- **Disabled while a Dashboard session recording runs** (`isSessionRecording()`, polled once a
  second while the card is shown, and checked again on each press), with the reason shown.
- While listening is on, a one-line note says the meters hear the playback too (echo cancellation
  is off by design).

## 9. UI states and every user-facing string

The card: a heading "Voice preview" with a small "experimental" tag, an "About voice preview" info
toggle (the lab's `InfoToggle` pattern), a one-line intro, then the state's content.

| State | What shows |
|---|---|
| loading | "Loading the voice preview…" |
| load error | "The voice preview could not load. Reload the page to try again." |
| unsupported (no WebAssembly) | "This browser can't run the voice preview (it needs WebAssembly)." |
| getting ready (listening < 6 s) | Record disabled; "Ready to record in {n} s" |
| ready to record | Record button; "Say a short phrase, 3 to 8 seconds." |
| recording | Stop button; "Recording… {t} s of 8"; a level bar (decorative) |
| too short | "That was under 3 seconds. Please record at least 3 seconds." (back to ready) |
| cancelled | "Recording stopped because listening was turned off." |
| analysing | "Preparing the preview…" |
| not enough voice | "There wasn't enough voice in that recording for a preview. Try again and speak for a few seconds." |
| preview ready | Notices (if any), median line, sliders, presets, playback, caveat, Discard, Download |
| updating | "Updating the preview…" (the previous preview stays playable) |
| error | "Something went wrong while making the preview. Record again to try once more." |
| out of memory | "This device ran out of memory for the preview. Try a shorter recording." |

Other strings, word for word:

- View switch option: "Voice preview".
- Intro: "Record a short phrase, then hear it with a different pitch or resonance."
- Buttons: "Record", "Stop", "Record again", "Discard", "Download preview (WAV)".
- Hint under "Record again": "Recording again replaces this one."
- Median line: "Your median pitch in this recording: about {hz} Hz."
- Slider labels: "Pitch" ("lower" / "higher"), "Resonance" ("larger / darker" /
  "smaller / brighter").
- Pitch value: "{±n} st, about {hz} Hz"; lowered adds "· may sound buzzier".
- Low limit note: "Lower settings would take part of your voice below 75 Hz."
- Preset group label: "Quick settings". Buttons: "Small step higher & brighter",
  "Small step lower & darker", "Pitch only", "Resonance only", "Toward my pitch target…",
  "Unchanged".
- Target row: "Target pitch (Hz)", "Apply"; result "Set to {±n} st (about {hz} Hz)", with
  ", the highest setting" / ", the lowest setting" when clamped.
- Playback group label: "Play". Buttons: "Unchanged (rebuilt)", "Preview", "Original", "Loop",
  "Stop".
- First-preview hint: "Move a slider or pick a quick setting to hear a change."
- Listening note: "Listening is on, so the meters hear the playback too. Headphones avoid that."
- Session guard: "Playback is off while a session is being recorded, so the preview isn't saved as
  your voice."
- Hum notice: "There's a steady hum in the background. In the preview it can move with the pitch
  slider."
- Noise notice: "There's a lot of background noise. The preview may sound rougher."
- After either notice (once): "A quieter spot gives a cleaner preview."
- Caveat, always shown with a preview: "A rough sketch from a vocoder; crackle or buzz comes from
  the processing, not your voice."
- Live-region announcements: "Recording.", "Recording stopped.", "Preview ready.",
  "Updating the preview…", "Preview updated.", "Playing the preview.",
  "Playing the unchanged rebuild.", "Playing the original.", "Loop on.", "Loop off.", "Stopped.",
  "Recording discarded."
- About voice preview (info toggle):
  1. "Hear roughly how a pitch or resonance setting sounds, using your own recording. It is a
     sketch, not a prediction of how you will sound."
  2. "Pitch moves your whole pitch contour up or down. Resonance moves all your formants up or
     down together, as a smaller or larger vocal tract would. Real resonance training moves some
     formants more than others, and your voice quality, intonation and articulation stay as you
     recorded them."
  3. "Compare the preview with “Unchanged (rebuilt)”: both go through the same vocoder, so the
     difference you hear is the setting. “Original” is your recording as captured."
  4. "Lowered previews may sound buzzier: the vocoder is weakest at low pitch."
  5. "A steady hum or loud background noise can make the preview rougher, and a hum can move with
     the pitch slider."
  6. "Your recording stays on this device, in memory only. It is deleted when you press Discard,
     record again or close the tab, and saved only if you press Download."
  7. "Built on WORLD, a speech vocoder by M. Morise (modified BSD licence)."

`strings.js` holds all of these; a test checks them for gender words and scores (§14).

## 10. Accessibility

- The card is a `<section>` labelled by its heading. Controls come in reading order: Record /
  Stop, notices, sliders, quick settings, Play group, Discard / Download.
- **Sliders:** native `<input type="range">` with a `<label>`. Live `min` / `max` (the low-contour
  limit). `aria-valuetext`:
  - pitch: "4 semitones higher, about 166 hertz", "2 semitones lower, about 132 hertz, may sound
    buzzier", "unchanged, about 148 hertz";
  - resonance: "6 percent brighter", "3 percent darker", "unchanged".
  The limit note is linked with `aria-describedby`. Keys as in §6.
- **Announced state:** one polite live region (`role="status"`) carries the announcements of §9.
  The recording timer is not announced every tick.
- **Play buttons:** `aria-pressed` on the playing version and on Loop; Stop is a plain button.
  Disabled buttons give their reason in visible text, linked with `aria-describedby`.
- **Focus:**
  - Record, Stop and Record again are the same button element, so focus stays put when the
    recording ends.
  - Nothing moves focus when analysis or a render finishes (it is announced instead).
  - After Discard, focus goes to Record.
  - The info toggle closes on Escape and returns focus to its button.
  - The target row's field gets focus when the row opens; Escape closes it.
- **Targets and contrast:** Record / Stop and the Play buttons are at least 44 × 44 CSS px on
  phones, other controls at least 24 × 24. Range inputs are 44 px tall. Text is at least
  neutral-400 on the card (≥ 4.5:1); the lab's neutral-500 is not used for card text.
- **Theme:** the app has a dark palette only. The card sets `color-scheme: dark`, so native
  controls (range, number field) draw dark whatever the OS theme is.
- No motion beyond the level bar's width; nothing flashes.

## 11. Lazy loading and bundle budget

- Main bundle: `bridge.js` and the hook's few lines only. Budget: the entry chunk (the module
  script in `dist/index.html` plus its static imports) grows by **≤ 1.0 KB gzip**. The LabView
  chunk grows by **≤ 1.0 KB gzip**.
- Card chunk (UI, controller, playback, strings, WAV, `?url` strings): ≤ 15 KB gzip, requested
  only when the Voice preview view is first opened.
- Worker chunk (worker, recorder, checks, engine, sinc resampler): ≤ 15 KB gzip, requested when
  the card mounts.
- WebAssembly: exactly one of SIMD (115 874 B, 53 415 B gzip) or non-SIMD (111 276 B, 51 502 B
  gzip), plus the glue (7 747 B, 2 675 B gzip), requested by the worker after the card mounts.
- Nothing voice-preview related (card chunk, worker, glue, `.wasm`) is requested before the view
  is first opened, including while the lab tab is open on another view.
- `bundle-budget.mjs` compares a base build (`cue-strip` at the branch point) with the head build.
  It fails on an over-budget chunk, and on `createVpWorld`, `vp_world` or `voice-preview` strings
  found in the entry or LabView chunks.

## 12. Third-party notices and the committed build

**Committed build** (`src/voice-preview/wasm/`, from `build.mjs --ship`; `BUILD.json` records
everything below and uses `$VP_CACHE` / `<repo>` placeholders, never a local path):

| File | sha256 |
|---|---|
| `simd/vp_world.wasm` | `fa3a29cf0ef75145ebe7fa6ab2b5dfa526ce9d1e5eb1a6409f291e863a7d3a25` |
| `nosimd/vp_world.wasm` | `09cf5e8ae0bb2d4ae1fb11eb2e11a32fddd3a94f767365bad47c84b40e33598d` |
| `vp_world.mjs` (the glue, identical for both builds; committed once) | `5e7a7a209e4a88ceb765a8d5c64cf2af33ad5abe8700cd38071d2ed117d988c5` |

Pins: WORLD `8d79b88b7dd92e8a132996cf74080b2d6f881b98` (`LICENSE.txt` sha256
`cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe`);
emsdk 6.0.10 at `a2b92777574c2feda07994cd4f1079a3dfc151f8` (emcc
`d6c521a7f05449857c76bd99e396895583cf2083`). Command lines as in the spike note (§ Build). WORLD
source and emsdk stay outside the repo (`$VP_CACHE`). CI does not rebuild; `--check-shipped`
proves reproducibility locally.

**Notices.**

- `licenses/world/LICENSE.txt`: WORLD's `LICENSE.txt` at the pinned commit (sha256 checked). The
  modified BSD licence requires the full text with binary copies.
- `licenses/emscripten/`, copied from the pinned emsdk:
  - Emscripten's `LICENSE` (MIT / University of Illinois NCSA; the JS runtime in the glue);
  - musl's `COPYRIGHT` (MIT);
  - the dlmalloc notice (public domain, CC0);
  - the LLVM `LICENSE.TXT` of compiler-rt, libc++ and libc++abi (Apache-2.0 WITH
    LLVM-exception).
- `THIRD_PARTY_NOTICES.md`, "Libraries shipped in the app", gains two rows: WORLD (commit, licence,
  copyright, "voice preview only"), and the Emscripten 6.0.10 runtime and system libraries inside
  `vp_world.{mjs,wasm}`.
- `scripts/third-party-notices.mjs` gains a short list of non-npm components, each with a
  module-id pattern and its licence files. When the build's module graph contains
  `src/voice-preview/wasm/`, their full texts are appended to `THIRD_PARTY_NOTICES.txt`, like the
  npm packages. The dev-server notices include them too.

## 13. Privacy

- Audio never leaves the device and is never written to IndexedDB, localStorage, Cache Storage,
  session frames, the data export, diag snapshots or the lab's "Save readings".
- It lives in the worker (recording, WebAssembly) and in the main thread's `AudioBuffer`s until
  Discard, Record again or page close.
- Download is the only way out, on an explicit press. It saves the current preview as
  `syrinx-voice-preview-{plus|minus}{n}st-{plus|minus}{m}pct.wav` (no date, no name), via an
  object URL revoked after 1 s.
- No file input and no drag-and-drop: the engine only ever sees audio recorded in the app during
  this visit.

## 14. Acceptance

**Unit tests** (`tests/voice-preview/*-test.js`; self-contained; picked up by
`npm run test:unit`; under 60 s together in CI):

1. `wasm-files-test.js`: the committed `.wasm` and glue match `BUILD.json` and the sha256 values
   in §12. `BUILD.json` pins equal `build.mjs` `PINS`. Both modules pass `WebAssembly.validate`.
   The SIMD probe accepts SIMD in Node 24.
2. `parity-test.js`: §5's bit-identity on every fixture × cell, for both builds, in two render
   orders (forward and reversed); input hashes as recorded.
3. `recorder-test.js`:
   - the cap by whole chunks at 16, 44.1, 48 and 96 kHz;
   - under 3 s → too short;
   - matching by `contextTime`: exact, nearest within half a chunk, late, missing (→ 0 after the
     500 ms timeout), duplicates, pre-recording messages ignored;
   - float32 track, 0 = unvoiced.
4. `controls-test.js`:
   - median and p5 (numpy-linear), and the limits: the min binds exactly where the shifted p5
     would fall below 75 Hz, and is never below −12; p5 = 75 Hz → min 0;
   - percent ↔ a (3 % → 1.03 exactly);
   - labels, `aria-valuetext`, minus sign;
   - every preset with and without clamping; the target mapping and its result line; the prefill
     per direction.
5. `checks-test.js`:
   - hum flag from forwarded `notched` flags (recorded chunks only);
   - the level margin on synthetic signals: clean voice + digital silence → no flag; + pink noise
     at +10 dB SNR → flag; exact boundary at 30 dB;
   - voice sufficiency at 39 / 40 voiced hops.
6. `worker-test.js`: the real `vp-worker.js` in Node under a fake `self`, with simulated chunks and
   posted messages: record → analysed → render. Its outputs equal `parity-test.js`'s for the same
   input. `too-short`, `cancel`, `no-voice` and a forced memory error give the right replies.
7. `strings-test.js`: no gender words in any string
   (`/\b(male|female|man|men|woman|women|masc\w*|femin\w*|gender\w*|girl|boy|lady|guy)\b/i`), no
   score words (`score`, `rating`, `pass`, `fail`, `good`, `bad`). The caveat and "may sound
   buzzier" match word for word.
8. `wav-test.js`: header fields, length, 16-bit rounding and clipping, round trip.
9. `bridge-hook-test.js`: drives the real `useAudioPipeline` hook as `display-hook-test.js` does.
   Painted values, readouts and posted-message handling are bit-identical with and without a tap
   installed; the tap receives every posted message; the capture handle is set on start and
   cleared on stop.
10. Existing tests still pass: `tests/audio/display-hook-test.js`,
    `tests/site/third-party-notices-test.js` (extended: the WORLD text with its sha256 and the
    Emscripten texts appear when the voice-preview module ids are present, and not otherwise),
    `tests/site/no-local-paths-test.js`, and the rest of `npm run test:unit`.

`npm run lint`, `npm run test:unit` and `npm run build` pass. `npm run test:resonance-lab` passes
(the lab is untouched).

**Bundle:** `bundle-budget.mjs` passes (§11).

**Smoke** (`scripts/voice-preview-smoke.mjs`):

- How it runs: against the built app (`vite preview`, its own child process); puppeteer with a
  new temporary profile per run; Chrome's fake microphone playing public or synthetic WAVs from
  `voice-preview-smoke-wavs.mjs` (the LibriSpeech fixtures at 48 kHz, joined into a 12 s phrase;
  the repo's `noise-synth.js` fan hum with a 10 s hum-only lead-in; pink noise at +10 dB SNR).
  Cleanup by the PIDs it started (hard rule 2).
- Viewports: 360 × 690, 402 × 750, 448 × 890, landscape 890 × 360 and desktop 1280 × 800. Each
  runs with `prefers-color-scheme: light` and `dark`.

1. Before the view is opened (lab tab open on Resonance), no request for the card chunk, the
   worker, the glue or a `.wasm`. After opening it: exactly one `.wasm` (SIMD in Chrome), status
   ready.
2. **Layout:**
   - no horizontal page scroll;
   - heading, status line and Record visible at scrollTop 0;
   - every control reachable by scrolling the lab's area, no clipped text, the targets of §10;
   - the computed text colours give ≥ 4.5:1 against the card in both colour schemes;
   - computed `color-scheme` is dark;
   - the lab's Resonance view at 360 × 690 still fits its four cards (the lab smoke's check).
   Screenshots per viewport and scheme.
3. **Flow:** the Record button waits for 6 s of listening, then records; auto-stop at 8 s;
   "Preparing the preview…"; "Preview ready". A stop at 2 s gives the too-short state. Stopping
   listening while recording gives the cancelled state.
4. **Keyboard:** Tab reaches every control in §10's order. The arrow keys move a slider, its
   `aria-valuetext` updates, and one render follows 400 ms after the last key. Presets apply. The
   live region carries "Playing the preview." and "Stopped.". Focus rules as in §10.
5. **Playback:** each version plays (the AudioContext is running); Loop toggles; switching keeps
   the position. Play is disabled while a Dashboard session recording runs, with the reason.
6. **Checks:** the fan-hum run shows the hum notice; the pink-noise run shows the noise notice;
   the clean run shows neither. Every run still makes a preview.
7. **Discard / Download:** Discard terminates the worker (CDP target list) and returns to ready.
   Download saves a RIFF/WAVE file, 16-bit mono, at the engine rate, with the recording's
   duration.
8. No gender words in the card's rendered text; no console errors.

One run against `npm run dev` checks that the `?url` glue import also works in the dev server.

**Desktop timing within the spike's numbers:**

- Same browser as the spike, Chrome for Testing 154.0.8037.57 (pinned in `$VP_CACHE`), at
  1280 × 800 in `?diag=1`, where the card shows the worker's per-stage times.
- Fake microphone: the spike's speech-dense clips (48 kHz, PTDB-TUG, public, local only), joined.
- Listening on, so every production worker and the lab run alongside.
- 10 recordings of 5 s and 10 of 8 s; machine load logged; a run above 55 % median busy is
  repeated.
- Pass: the worker's analysis + rebuild time and render time are within the spike's A5 desktop
  Chrome values at 48 kHz (speech-dense clips). The app's first render is (0, ×1.00), which skips
  the warp, so it costs no more than the spike's G1.

  | Phrase | Analysis + rebuild: median / pooled p90 | Render (slider change): median / pooled p90 |
  |---|---|---|
  | 5 s | ≤ 1.13 / ≤ 1.42 s | ≤ 0.22 / ≤ 0.35 s |
  | 8 s | ≤ 1.69 / ≤ 2.22 s | ≤ 0.36 / ≤ 0.55 s |

- End to end (stop → "Preview ready"; slider release → "Preview updated") is reported. It must stay
  under the gate (3 s / 1 s).

## 15. Phone acceptance check (later, with the user; about 15 minutes; no adb)

On the Pixel 11 Pro XL (the gate phone), current Chrome, `npm run dev:mobile` over the LAN or a
preview build, with `?diag=1`. Listening on, with the lab running. Only timings and pass/fail are
written down: no audio, pitch values or screenshots of the user's voice leave the phone or go into
this repo. A public clip played from the PC speaker can stand in for speaking.

1. Open the lab tab, then Voice preview: ready within 1 s; the diag line shows build "simd" and the
   engine rate (48000).
2. **5 s phrases, 5 times:** analysis + first render ≤ 3.0 s each (expected about 1.2 s); slider
   changes ≤ 1.0 s (expected about 0.25 s).
3. **8 s phrases (auto-stop), 5 times:** the same limits. Not timed in the spike. Expected about
   1.7–2.3 s and 0.4–0.6 s, if the phone keeps its 5 s ratio to the desktop. If this fails, the
   recording cap needs a user decision (for example 6 s).
4. **Playback:** all three versions audible at normal volume through the speaker while listening
   (not the earpiece), and through headphones; Loop and A/B switching work.
5. **TalkBack:** sliders read their values; playback state and "Preview ready" are announced;
   Record / Stop are reachable.
6. **Checks:** with a steady hum source (fan, hood) on for 10 s before recording, the hum notice
   shows. In a quiet room neither notice shows; in an ordinary room with a TV or fan, note whether
   the noise notice fires (this feeds the 30 dB threshold).
7. Discard, then record again: the tab stays responsive.

If available, a 44.1 kHz device or a Bluetooth headset (16 kHz): the diag line shows the engine
rate; steps 2 and 4 pass.

## 16. Known limits of v1

- **8 s on the phone:** predicted, not measured, with a margin of about ×1.3. Slower phones may
  exceed 3 s at 8 s; the gate covers phones as fast as the Pixel 11 Pro XL or faster.
- **F-S weaknesses (spike §P4):** frames the chain posts unvoiced, including phonation above
  400 Hz and creak below 75 Hz, become noise in the preview. With a hum notched, the ghost veto
  also unvoices voice within 2 % of the hum line (the spike measured 15–18 % voiced-hop loss for
  men with fan hum after a pre-roll).
- **In-range hum** can still move with the pitch slider. The notice says so; v1 does not remove
  it.
- Playback needs listening on (the lab tab is hidden while idle). Playing through a speaker feeds
  the live meters.
- Not checked in-app: iOS Safari (no device), Firefox (the spike showed the engine bit-identical
  there), mid-range phones.

## 17. Out of scope for v1

Meter readings on previews; PSOLA; file import; live (while-speaking) shifting; previews of
saved sessions; uneven formant changes; an intonation control; a neural vocoder; placement
outside the lab; a clipping check.

## Deviations

**2026-10-19, core step** (engine, worker, recorder, check, bridge, notices; no card UI yet):

1. **Parity render orders (§5, §14 item 2).** Every input × cell × build is checked, but not
   every input × build × order: the two builds take the cells in opposite orders (forward /
   reversed), swapped from one input to the next, so each build runs both orders across the
   inputs; the forward order skips (0, 0), which the analysis has just rendered as the
   rebuild, and the reversed order ends with it. The spike's expected value for a cell comes
   from a fresh analysis with that cell rendered first, so an order dependence would still
   fail. Reason: the full matrix took about 80 s on the development machine, over the 60 s
   budget for the voice-preview unit tests; as built, parity takes 40–48 s and all
   voice-preview tests together about 55–60 s (machine under other load).
2. **Fixture chunking (§5).** The parity inputs are cut to whole capture chunks of the app's
   size, floor(0.025 × rate) (1102 samples at 44.1 kHz), and their posted tracks come from
   `runWorkers` with that chunk, so the worker test can feed the same input through the
   recorder. (`runWorkers`' default chunk is round(0.025 × rate), 1103 at 44.1 kHz.)
3. **Controller (§2).** `controller.js` is a factory, `createVoicePreviewController({ createWorker,
   glueUrl, wasmUrls })`, so Node tests can run it with the real worker in a `worker_threads`
   thread. The card creates one instance at module level (it then survives view and tab
   switches, as planned). It holds the worker lifecycle, the recording (capture port + pitch
   tap), the 6 s listening wait and the render queue; playback and download stay for the card
   step.
4. **Worker messages (§4), additions only.** `ready` also carries `memBytes`; `analysed` and
   `no-voice` carry `hops { recorded, received }` (and `no-voice` the `check`); `record` takes
   an optional `trackTimeoutMs` (default 500, shortened in a test). A second `record` in a worker
   that has analysed a recording is refused (`error { stage: "record" }`): the app starts a
   fresh worker for every new recording after a preview (Discard / Record again), as designed.
   Error kind "memory" = a failed WebAssembly `malloc`, a JS `RangeError`, or a WebAssembly
   abort during analysis or rendering (in this build only a failed `operator new` aborts); a
   module that fails to load is always "other".
5. **`controls.js` in the worker chunk too.** The worker computes median, 5th percentile, limits
   and the formant scale with the same pure module the card will use (a few hundred bytes in
   each chunk).
6. **More unit tests than §14 lists:** `controller-test.js` (lifecycle with the real worker:
   discard / record again terminate the worker thread, a fresh worker reports the initial
   WebAssembly memory), `warp-test.js` (the warp against its definition; aperiodicity bit-exact,
   envelope within 1e-12), `hum-check-test.js` (the check end to end with the real pitch
   worker's notch after a 10 s lead-in). `strings-test.js` and `wav-test.js` come with the card.
7. **A finding for the 30 dB noise threshold (§7, §15 step 6).** The committed LibriSpeech
   excerpt `ls_man_low` (an audiobook recording whose own noise floor sits about 19 dB below the
   speech) measures an 18.2 dB margin and gets the noise notice; the other two excerpts measure
   39.8 and 40.0 dB. That is the notice doing its job on a genuinely noisy recording, but it is
   one more data point that ordinary recordings can fall under 30 dB.
8. **Notices (§12).** `licenses/emscripten/dlmalloc-NOTICE.txt` is the public-domain notice
   excerpted from `system/lib/dlmalloc.c`; `licenses/world/README.md` and
   `licenses/emscripten/README.md` record sources and sha256. `build.mjs` runs nothing when
   imported (the wasm-files test reads its `PINS`). `lib/paths.mjs` is the spike's file except
   one comment, which named the local cache folder (a comment only; the build is unchanged and
   `--check-shipped` reproduces the committed bytes from this checkout).

**2026-10-19, card step** (the card UI, playback, strings, WAV, smoke, bundle budget):

9. **Value labels in `strings.js`, not `controls.js` (§2, §6).** The pitch and resonance labels,
   their `aria-valuetext`, the target result line and the download name are built in
   `strings.js` (on `controls.js`'s `shiftedHz`), so every user-facing string sits in the one
   file `strings-test.js` checks. `controls.js` is unchanged.
10. **Controls that cannot act stay focusable (§10).** They carry `aria-disabled`, not
    `disabled`, and their reason in visible text linked with `aria-describedby` (Record while
    waiting: the status line; Preview before a change: the first-preview hint; Play during a
    session recording: the guard line). With `disabled`, focus fell to the page when the
    Record / Stop button became inactive during analysis.
11. **Playback Stop is always shown and always active (§8).** "A button while anything plays"
    would appear and vanish under the user's finger and take focus with it; pressing it with
    nothing playing does nothing.
12. **Preview button before the first change (§1, §8).** Inactive until a setting has been
    rendered (reason: the first-preview hint), since the first render is the unchanged
    rebuild. Download before any change saves the unchanged rebuild, named
    `…-plus0st-plus0pct.wav`.
13. **Playback stops when it cannot be seen (§4, §8).** Leaving the view or the tab, listening
    stopping, or a Dashboard session recording starting stops playback (silently; the
    recording, the preview and the slider settings are kept). The design kept "everything" on
    a view switch; playback running behind a hidden card could not be stopped and would feed
    the meters.
14. **About as an inline disclosure (§9, §10).** Seven paragraphs do not fit the lab's
    popover on a phone, so the "i" button expands a panel inside the card (`aria-expanded` /
    `aria-controls`); Escape closes it and returns focus to the button.
15. **"Updating the preview…"** shows on the Play group's label line (no empty line reserved
    under the buttons).
16. **WAV rounding (§13).** Halves away from zero (symmetric), clipped to ±32767.
17. **The card's background is opaque** (`neutral-900`; the lab's cards use `neutral-900/60`),
    so contrast is measured against one colour; the app stays dark only, the card sets
    `color-scheme: dark` (§10).
18. **Smoke (§14).** `scripts/voice-preview-smoke.mjs` serves `dist/` from a small static
    server inside the script instead of `vite preview`, because page-level request events miss
    the worker's and the WebAssembly fetches; the server logs every request. Headless Chrome's
    fake microphone runs at 44.1 kHz, so the layout, flow and check runs exercised the 44.1 kHz
    engine rate (48 kHz is covered by `parity-test.js`); the timing run forces 48 kHz with
    `?capture=audiocontext&sr=48000`. In the hum run (fan hum 20 dB below the speech) the
    noise notice shows too (level margin 24.1 dB), as the spike's −20 dB hum figures predict
    (26.8–28.9 dB); the smoke requires only the hum notice there. The clean phrase leaves out
    `ls_man_low` (its own noise floor gets the noise notice, Deviation 7).
19. **Bundle budget (§11).** `scripts/voice-preview/bundle-budget.mjs` builds the base and this
    tree with the same inline Vite config, without the notices plugins (they emit a text asset
    only and need a `node_modules` beside the extracted base; the base resolves its packages
    through this checkout's).
20. **One more unit test:** `playback-test.js` (the playback module against a fake
    AudioContext: A/B keeps the position, a new preview takes over at the same position, loop
    on / off mid-play, suspend when idle, close).
21. **Desktop timing harness (§14).** `voice-preview-smoke.mjs --parts=timing` (Chrome for
    Testing 154.0.8037.57 from `$VP_CACHE`, `?diag=1&capture=audiocontext&sr=48000`, the
    spike's four speech-dense 8 s clips joined as `timing.wav`): 10 recordings of 5 s and 10
    of 8 s, each followed by one quick setting (+2 st, +3 %). A 5 s recording is stopped once
    5 s of audio are in (the status line), not after 5 s of wall time: in headless Chrome the
    AudioContext capture path delivered audio at about two thirds of real time after a few
    recordings (3.35 s recorded in 5 s of wall time; every consumer got the same chunks; not
    seen on the MSTP path, nor on a first recording after 36 s of listening). As far as
    checked this is the headless fake devices, not the preview; the phone and Firefox checks
    should watch for it.

## Implementation status (2026-10-19)

Built on branch `voice-preview` (no PR). The card, the engine and the checks are complete
for the lab version; the phone check (§15) is still to do.

| Acceptance (§14, §15) | Status |
|---|---|
| Unit tests 1–10 (`tests/voice-preview/`: wasm-files, parity, recorder, controls, checks, worker, controller, warp, hum-check, bridge-hook, strings, wav, playback) and the existing display-hook, notices and no-local-paths tests; lint, `npm run test:unit`, build, `npm run test:resonance-lab` | pass |
| Bundle (`bundle-budget.mjs`) | pass: entry + static imports +0.20 KB gzip, LabView +0.24 KB, card chunk 10.1 KB, worker chunk 5.3 KB; no voice-preview strings in the entry or LabView chunks; WebAssembly 52.2 KB (SIMD) / 50.3 KB gzip |
| Smoke (`voice-preview-smoke.mjs`, layout / flow / checks / dev) | pass, 152 checks: five viewports × light and dark; nothing requested before the view opens, then exactly one `.wasm` (SIMD); the lab's four cards still fit at 360 × 690 and 402 × 750; full flow, keyboard, playback, session guard, hum and noise notices, Discard (worker target replaced), Download (16-bit mono WAV at the engine rate, the recording's length); dev server |
| Desktop timing (Chrome for Testing 154, 48 kHz, listening on) | **partly.** Analysis + rebuild within the spike's values: 5 s 863 / 980 ms (median / pooled p90; limit 1130 / 1420), 8 s 1480 / 1625 ms (limit 1690 / 2220). Slider-change render: p90 within (291 / 450 ms; limits 350 / 550), **medians over** (239 ms against 220 at 5 s, 436 ms against 360 at 8 s). End to end far under the gate: stop → "Preview ready" 1.0 / 1.1 s (5 s) and 1.6 / 1.7 s (8 s); press → "Preview updated" 0.31 / 0.32 s and 0.51 / 0.51 s. The machine was 47 % busy (median) with other jobs, and listening and the lab ran alongside, where the spike timed an isolated page; the renders are the spike's bytes (parity), so the code path is the spike's and load is the likely cause. Not yet repeated on a quieter machine |
| Phone check (§15, Pixel 11 Pro XL) | not done yet; includes the first 8 s phone timing and the 30 dB noise threshold in ordinary rooms |
