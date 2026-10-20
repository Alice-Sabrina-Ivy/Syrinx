// sessions-qf.mjs — the private session recordings through the baseline and
// every quiet-floor candidate (real chain, lib.mjs). Writes per tree and
// session a dump in the layout scripts/session-oracle/session_fv.py reads
// (<out>/<tag>/sessions/<session>.json + .f32; columns post, inten, paint,
// ro, rec, indexed as lib/chain.mjs), scored by score_sessions.py.
// Output stays outside the repository (results on the private recordings are
// never committed): pass --out.
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/sessions-qf.mjs \
//        --out=DIR [--sessions=2025-09-08,2026-05-07,2026-05-26,2026-06-09] [--trees=build/trees]
//        [--sessions-root=DIR]  (default $SYRINX_SESSIONS_DIR)
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readWav } from "../session-oracle/lib/wav.mjs";
import { ALL_CANDS, loadTrees, runAll } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const ROOT = args["sessions-root"] ?? process.env.SYRINX_SESSIONS_DIR;
if (!ROOT) throw new Error("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)");
if (!args.out) throw new Error("--out=DIR is required (outside the repository)");
const OUT = resolve(args.out);
const SESSIONS = (args.sessions ?? "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",");
const T = await loadTrees(resolve(args.trees ?? "build/trees"), ALL_CANDS);
const COLS = ["post", "inten", "paint", "ro", "rec"];
for (const s of SESSIONS) {
  const t0 = Date.now();
  const { samples, sr } = readWav(`${ROOT}/${s}/session.wav`);
  const R = await runAll(T, samples, sr, ALL_CANDS);
  for (const [tag, { W, D }] of Object.entries(R)) {
    const d = resolve(OUT, tag, "sessions");
    mkdirSync(d, { recursive: true });
    const src = { post: W.col.post, inten: W.col.inten, paint: D.paint, ro: D.ro, rec: D.rec };
    const tbl = new Float32Array(W.n * COLS.length);
    COLS.forEach((c, i) => tbl.set(src[c], i * W.n));
    writeFileSync(resolve(d, `${s}.f32`), Buffer.from(tbl.buffer));
    writeFileSync(resolve(d, `${s}.json`), JSON.stringify({ name: s, tag, cols: COLS, n: W.n, hopS: W.C / W.sr, L: W.L }));
  }
  console.log(`${s}: ${R.base.W.n} hops, ${(Date.now() - t0) / 1000}s`);
}
