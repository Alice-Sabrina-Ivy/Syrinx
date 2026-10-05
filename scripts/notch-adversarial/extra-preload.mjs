// node --import ./scripts/notch-adversarial/extra-preload.mjs (cwd = an otree): register the extra tonal classes
// (scripts/notch-adversarial/extra-noise.mjs) in that tree's NOISE_TYPES
import { pathToFileURL } from "node:url";
import path from "node:path";
const { NOISE_TYPES } = await import(pathToFileURL(path.resolve("scripts/noise-synth.js")).href);
const { EXTRA_NOISE } = await import(pathToFileURL(path.resolve("scripts/notch-adversarial/extra-noise.mjs")).href);
Object.assign(NOISE_TYPES, EXTRA_NOISE);
