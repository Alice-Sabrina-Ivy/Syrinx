// hearShaper.js — "Hear it first" wired to Voice Shaper's own worker and WebAssembly
// files (the same construction as VoicePreviewCard.jsx). Imported dynamically when the
// lesson opens, so the Exercises tab's chunk carries none of Voice Shaper.

import { createVoicePreviewController } from "../voice-preview/controller.js";
import { VP_GLUE_URL, VP_WASM_URLS, VP_ORT_WASM_PATHS, vpDfn3Source } from "../voice-preview/wasm-files.js";
import { createHear } from "./hear.js";

export function createShaperHear(shifts) {
  return createHear({
    shifts,
    createController: () => createVoicePreviewController({
      createWorker: () => new Worker(new URL("../voice-preview/vp-worker.js", import.meta.url), { type: "module" }),
      glueUrl: VP_GLUE_URL,
      wasmUrls: VP_WASM_URLS,
      dfn3Source: vpDfn3Source(),
      ortWasmPaths: VP_ORT_WASM_PATHS,
    }),
  });
}
