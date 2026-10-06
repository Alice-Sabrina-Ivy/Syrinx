// hooks.mjs — Node module-resolution hooks for the real-noise false-voicing
// runner (2026-10-05). Same as scripts/session-oracle/lib/hooks.mjs (react
// mock, Vite-style extensionless imports, boersma-ac tap) plus an
// observation-only tap on pitch-worker.js's import of ./noise-notch.js
// (tap-notch.mjs). Both taps carry opt-in counterfactual switches
// (globalThis.__RN_CF / __RN_NOTCH_OPTS, set by attr.mjs --cf / --notch-opts);
// unset, they only observe. RN_TAP=0 disables both taps (pure production
// imports).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const SO = new URL("../../session-oracle/lib/", import.meta.url);
const MOCK = new URL("react-mock.mjs", SO).href;
const TAPB = new URL("./tap-boersma.mjs", import.meta.url).href;
const TAPN = new URL("./tap-notch.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "react") return { url: MOCK, shortCircuit: true };
  const fromWorker = ctx.parentURL && /\/pitch-worker\.js(\?|$)/.test(ctx.parentURL);
  if (fromWorker && process.env.RN_TAP !== "0") {
    if (spec === "./boersma-ac.js") {
      return { url: `${TAPB}?real=${encodeURIComponent(new URL(spec, ctx.parentURL).href)}`, shortCircuit: true };
    }
    if (spec === "./noise-notch.js") {
      return { url: `${TAPN}?real=${encodeURIComponent(new URL(spec, ctx.parentURL).href)}`, shortCircuit: true };
    }
  }
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?jsx?$/.test(spec) && ctx.parentURL) {
    for (const ext of [".js", ".jsx"]) {
      const u = new URL(spec + ext, ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}
