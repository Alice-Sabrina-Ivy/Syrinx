// lib.mjs — shared runner for the quiet-floor harnesses: the baseline tree and
// the candidate trees of make-trees.mjs through the REAL chain
// (scripts/session-oracle/lib/chain.mjs). Gate-only candidates (gNN) reuse the
// baseline workers' frames (identical workers by construction); G·F candidates
// (gfNN) run their own workers. Requires the session-oracle loader
// (node --import ./scripts/session-oracle/lib/register.mjs).
import { resolve } from "node:path";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";

export const ALL_CANDS = ["g60", "g65", "g70", "g75", "gf60", "gf65", "gf70", "gf75"];

export async function loadTrees(treesDir, cands = ALL_CANDS) {
  const T = { base: await loadSrc(resolve(treesDir, "qf-base/src")) };
  for (const c of cands) T[c] = await loadSrc(resolve(treesDir, `qf-${c}/src`));
  return T;
}

// Returns { base: {W, D}, <cand>: {W, D} } for one stream.
export async function runAll(T, x, sr, cands = ALL_CANDS) {
  const W0 = runWorkers(T.base, x, sr);
  const F0 = buildFrames(W0);
  const out = { base: { W: W0, D: await driveHook(T.base.hookPath, F0, W0.n) } };
  for (const c of cands) {
    if (c.startsWith("gf")) {
      const W = runWorkers(T[c], x, sr);
      out[c] = { W, D: await driveHook(T[c].hookPath, buildFrames(W), W.n) };
    } else out[c] = { W: W0, D: await driveHook(T[c].hookPath, F0, W0.n) };
  }
  return out;
}

// Shares of one run: posted voiced (% of pitch messages), painted / readout
// shown / recorded voiced (% of display hops with a DSP frame).
export function shares({ W, D }) {
  let nMsg = 0, posted = 0, nHop = 0, painted = 0, ro = 0, rec = 0;
  for (let k = 0; k < W.n; k++) {
    if (!Number.isNaN(W.msgPitch[k])) { nMsg++; posted += W.msgPitch[k] > 0; }
    if (Number.isNaN(W.col.inten[k])) continue;
    nHop++; painted += D.paint[k] > 0; ro += D.ro[k] > 0; rec += D.rec[k] > 0;
  }
  const p = (a, n) => (n ? 100 * a / n : NaN);
  return { posted: p(posted, nMsg), painted: p(painted, nHop), ro: p(ro, nHop), rec: p(rec, nHop), nHop, nMsg };
}
