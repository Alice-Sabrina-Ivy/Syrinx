// tap-notch.mjs — observation-only shim between pitch-worker.js and the REAL
// noise-notch.js of the same src tree (URL in ?real=). The module text is
// loaded unchanged except for one injected accessor on the object
// createNoiseNotch() returns: __obs() -> { tracks, cascade, obsIndex, cfg, cohClass? }
// (the closure state the notch never exposes). No logic is altered, so the
// posted stream is bit-identical to an untapped worker (checked by
// attr.mjs --parity) unless a counterfactual switch below is set. The created instance is handed to
// globalThis.__RN_TAP.notch(inst) when the caller installed one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const realUrl = new URL(import.meta.url).searchParams.get("real");
const text = readFileSync(fileURLToPath(realUrl), "utf8");
const re = /return\s*\{(\s*)process,/;
if (!re.test(text)) throw new Error(`tap-notch: cannot find createNoiseNotch's return object in ${realUrl}`);
// cohClass (the line verdict, 2026-10-05 trees) is exposed when the tree has one
const hasCoh = /function cohClass\(/.test(text);
const patched = text.replace(re, `return {$1__obs: () => ({ tracks, cascade, obsIndex, cfg${hasCoh ? ", cohClass" : ""} }),$1process,`);
// A data: URL cannot resolve the tree's relative imports (noise-notch.js
// imports ../utils/constants.js since V19g, 2026-10-06), so they are
// rewritten to absolute file URLs of the same tree first.
const patchedAbs = patched.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
  (m, a, spec, b) => a + new URL(spec, realUrl).href + b);
const R = await import("data:text/javascript;base64," + Buffer.from(patchedAbs, "utf8").toString("base64"));

export const NOTCH_DEFAULTS = R.NOTCH_DEFAULTS;
// counterfactual switch: globalThis.__RN_CF.noVeto disables the ghost veto
export const isNearNotch = (...a) => (globalThis.__RN_CF?.noVeto ? false : R.isNearNotch(...a));
// counterfactual notch options: globalThis.__RN_NOTCH_OPTS is merged over the
// caller's options (unset = the production configuration)
export function createNoiseNotch(sr, opts = {}) {
  const inst = R.createNoiseNotch(sr, { ...opts, ...(globalThis.__RN_NOTCH_OPTS ?? {}) });
  globalThis.__RN_TAP?.notch?.(inst);
  return inst;
}
