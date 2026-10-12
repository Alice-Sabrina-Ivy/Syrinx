// node-io.mjs — Node-side helpers for the voice-preview spike runners.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "./paths.mjs";
import { createWorld } from "./world-engine.js";

/** Load the built module (VP_CACHE/wasm/<build>/vp_world.mjs) in Node. */
export async function loadWorldNode(build = "simd") {
  const glue = path.join(P.wasm, build, "vp_world.mjs");
  const { default: factory } = await import(pathToFileURL(glue).href);
  return createWorld(await factory());
}

export const loadLab = () => import(pathToFileURL(path.join(REPO, "src/resonance-lab/lab-engine.js")).href);

export function readF32(p) {
  const b = readFileSync(p);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
export function readF64(p) {
  const b = readFileSync(p);
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
export const writeArr = (p, a) => writeFileSync(p, Buffer.from(a.buffer, a.byteOffset, a.byteLength));
export const sha256Arr = (a) => createHash("sha256").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

export const ST = [-6, -3, 0, 3, 6];
export const AL = [0.88, 0.94, 1.0, 1.06, 1.12];
/** The prototype grid: 25 cells + one full-gap cell toward the other group. */
export const cells = (sex) => [...ST.flatMap((s) => AL.map((a) => [s, a])), sex === "m" ? [9, 1.15] : [-9, 0.87]];
export const cellName = (s, a) => `p${s >= 0 ? "+" : "-"}${Math.abs(s)}_a${a.toFixed(2)}`;
