// armed.mjs — how often the learned-background guard can act at all on the
// clean ground-truth corpora (review fix, 2026-10-05). Runs the worker of the
// fg_armed tree (mktree.py: the candidate + observation-only counters) over
// Hillenbrand / FDA / PTDB-TUG / vocadito and prints, per corpus, the share
// of guard checks (decoded-voiced frames) that are still in the 2 s warm-up,
// fail open for want of an anchored background, or are ARMED (compared with
// the floor), the armed checks that failed / vetoed, and percentiles of the
// best harmonic excess over the floor (dB) of the armed checks — the margin
// to the 14 dB threshold. Identical results on a corpus where the guard is
// rarely armed, or armed with a large margin, say little about voice safety.
//
//   python scripts/realnoise-fv/mktree.py fg_armed
//   node scripts/realnoise-fv/armed.mjs [build/rnfv-trees/fg_armed/src] [loadHillenbrand,loadFda,loadPtdbTug,loadVocadito]
// (SYRINX_CORPORA_DIR reads another checkout's gitignored corpus audio.)
import { loadWorkers, runWorker } from "./lib/worker.mjs";

const L = await import("../../tests/dsp/data/corpora.js");
const H = await loadWorkers([{ name: "c", path: process.argv[2] ?? "build/rnfv-trees/fg_armed/src" }]);
for (const fn of (process.argv[3] ?? "loadHillenbrand,loadFda,loadPtdbTug,loadVocadito").split(",")) {
  globalThis.__FGI = { calls: 0, warm: 0, noanchor: 0, armed: 0, armedFail: 0, vetoes: 0, best: [] };
  let posted = 0, maxDur = 0, minDur = Infinity;
  for (const t of L[fn]()) {
    const d = t.samples.length / t.sampleRate; maxDur = Math.max(maxDur, d); minDur = Math.min(minDur, d);
    posted += runWorker(H.c, t.samples, t.sampleRate).filter((x) => x.pitch > 0).length;
  }
  const S = globalThis.__FGI, b = S.best.filter(Number.isFinite).sort((x, y) => x - y);
  const q = (p) => (b.length ? b[Math.floor(p * (b.length - 1))].toFixed(1) : "-");
  const pc = (x) => (S.calls ? (100 * x / S.calls).toFixed(1) : "-");
  console.log(`${fn}: clips ${minDur.toFixed(2)}-${maxDur.toFixed(2)} s; posted voiced ${posted}; guard checks ${S.calls}: ` +
    `warm-up ${pc(S.warm)} %, no anchored background ${pc(S.noanchor)} %, armed ${pc(S.armed)} % (failing ${S.armedFail}, vetoes ${S.vetoes}); ` +
    `best excess over the floor p1 / p5 / p50 ${q(0.01)} / ${q(0.05)} / ${q(0.5)} dB (threshold 14)`);
}
