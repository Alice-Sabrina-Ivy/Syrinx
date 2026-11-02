// timing-chain-eval.mjs — the Node chain (chain.mjs: real pitch worker +
// FireRedVAD, frozen clock, the resonance chain replay) on the timing WAVs,
// scored with the browser runs' event metrics (timing-analyze.mjs
// eventMetrics) and compared post by post with a browser base run.
//
//   node scripts/resonance/mobile/timing-chain-eval.mjs --chain=build/resonance-mobile/timing/chain
//        --conds=node-hd0,node-hd4,... [--browser=build/resonance-mobile/timing/runs] [--gate=on]
//        --json=build/resonance-mobile/timing/chain-eval.json
// Chain runs: chain.mjs run --cond=<c> --f32=build/resonance-mobile/timing/wav/<set>.f32 --id=<set> --sex=x
//   [--hint-delay=N] --gate=on --out=<chain dir>
// Post audio time = (k + 1) · 25 ms (file time: the chain starts at the file's first sample).
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, pair, eventMetrics } from "./timing-analyze.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const chainDir = path.resolve(repo, arg("chain", "build/resonance-mobile/timing/chain"));
const browserDir = path.resolve(repo, arg("browser", "build/resonance-mobile/timing/runs"));
const conds = arg("conds", "node-hd0").split(",");
const GATE = arg("gate", "on");
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const out = {};
for (const set of ["set1", "set2"]) {
  const man = JSON.parse(readFileSync(path.join(repo, `build/resonance-mobile/timing/wav/${set}.json`), "utf8"));
  const bf = path.join(browserDir, `base__${set}.json`);
  const base = existsSync(bf) ? analyze(bf) : null;
  out[set] = { runs: [] };
  for (const c of conds) {
    const d = path.join(chainDir, c);
    if (!existsSync(d)) continue;
    const recs = readdirSync(d).filter((f) => /^runs-.*\.jsonl$/.test(f)).flatMap((f) => readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    const r = recs.find((x) => x.id === set && x.gate === GATE);
    if (!r) continue;
    const st = r.posts.map((p) => ({ ft: (p[0] + 1) * 0.025, ct: (p[0] + 1) * 0.025, u: p[2], verdict: VERD[p[9]], a: null }));
    const { ev, steady } = eventMetrics(st, man);
    const sexAt = (t) => man.blocks.find((b) => t >= b.t0 && t < b.t0 + 54)?.sex ?? null;
    const verdicts = {};
    for (const s of st) verdicts[s.verdict] = (verdicts[s.verdict] ?? 0) + 1;
    const nAdm = r.bins.filter((b) => b[3]).length;
    const run = {
      cond: c, wav: set, hintDelay: r.hintDelay, gate: r.gate, events: ev, steady,
      states: { posts: st.length, verdicts },
      resonance: { binsAdmitted: nAdm, binsDropped: r.bins.length - nAdm },
      _st: st.map((s) => [s.ft, s.u == null ? null : +s.u.toFixed(4), s.verdict, null, s.ct, sexAt(s.ft)]),
    };
    if (base) run.vsBase = pair(run, base);
    delete run._st;
    out[set].runs.push(run);
    const lo = ev.filter((e) => e.kind === "long");
    console.log(`${set} ${c} (hint-delay ${r.hintDelay}, gate ${r.gate}): bins ${nAdm}+${r.bins.length - nAdm} dropped; long T50 ${lo.map((e) => e.t50?.toFixed(2)).join(" ")}; exc peaks ${ev.filter((e) => e.kind === "exc").map((e) => e.peak?.toFixed(2)).join(" ")}${run.vsBase ? `; vs browser base |du| med ${run.vsBase.du.med} p95 ${run.vsBase.du.p95}` : ""}`);
  }
}
if (arg("json", "")) writeFileSync(path.resolve(repo, arg("json", "")), JSON.stringify(out, null, 1));
