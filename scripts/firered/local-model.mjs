// local-model.mjs — where the Node tests and harnesses find the FireRedVAD
// model files (the voice gate's model; src/dsp/firered-vad.js).
//
// The app loads them at runtime from the project's Hugging Face mirror
// (FIRERED_MODEL.mirrorCommit). Node has no mirror loader here, so the parity
// test, the session oracle's --voice-gate option and the voice-gate drivers
// read a local copy from build/models/firered/ (gitignored, and outside
// public/, so no build ever ships it), filled by
//   node scripts/fetch-firered-model.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCAL_MODEL_DIR = path.join(repo, "build", "models", "firered");
export const LOCAL_MODEL_HINT = "node scripts/fetch-firered-model.mjs";
