// hooks.mjs — Node module-resolution hooks for the session oracle.
//  * "react" -> react-mock.mjs (the hook is driven without a renderer).
//  * Extensionless relative specifiers (Vite style, e.g. "./pitchGate")
//    resolve to .js / .jsx.
//  * pitch-worker.js's import of "./boersma-ac.js" is routed through
//    tap-boersma.mjs, which re-exports the REAL module of that same src
//    tree and only wraps candidates()/emit() to record the frame-local and
//    tracker-decoded values the worker never posts. The worker code itself
//    runs unmodified. SO_TAP=0 disables the tap (pure production imports).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const MOCK = new URL("./react-mock.mjs", import.meta.url).href;
const TAP = new URL("./tap-boersma.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "react") return { url: MOCK, shortCircuit: true };
  if (spec === "./boersma-ac.js" && ctx.parentURL && /\/pitch-worker\.js(\?|$)/.test(ctx.parentURL) && process.env.SO_TAP !== "0") {
    const real = new URL(spec, ctx.parentURL).href;
    return { url: `${TAP}?real=${encodeURIComponent(real)}`, shortCircuit: true };
  }
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?jsx?$/.test(spec) && ctx.parentURL) {
    for (const ext of [".js", ".jsx"]) {
      const u = new URL(spec + ext, ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}
