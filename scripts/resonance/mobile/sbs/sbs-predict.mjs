// sbs-predict.mjs — what a measured phone / boom response does on public
// speech: the FIR (sbs-analyze.mjs fir-*.json, or any taps) applied with
// perturb.mjs "fir:" to the 12 LibriSpeech dev-clean readers of the mobile
// diagnosis, through chain.mjs (the REAL pitch worker + FireRedVAD, the
// resonance worker's chain, gate on), against the diagnosis's clean runs.
//
//   node scripts/resonance/mobile/sbs/sbs-predict.mjs --fir=<taps.json> --name=<cond>
//        [--only=<reader ids>] [--shards=4] [--kinds=ctl,sw,exc] [--report-only] [--allow-chain-diff]
//
// Streams: the N / U10 / D10 controls and the N-U10-N / N-D10-N switches
// (chain.mjs selectItems), and the 3 / 5 / 8 s short excursions
// (channel-run.mjs excItems). Records: build/resonance-mobile/sbs/predict/<cond>/
// runs-<i>of<n>.jsonl (chain.mjs's record fields id, reader, sex, kind, variant,
// seq, joins, posts). Bases: build/resonance-mobile/runs/clean (controls,
// switches) and build/resonance-mobile/channel/runs/clean (excursions).
// Metrics (posts only — no display model): per reader
//   bias  = median shown u of the N control after the readout fills (fill >= 1) - the clean run's
//   sens  = (medU U10 - medU D10) / clean
//   exc d = peak of sign * (u - u0) over 18 < t <= 18 + d + 3 s (u0 = last post at t <= 18) / clean peak (clean >= 0.25 u)
// summary: medians over readers, per sex and pooled.
// Shards run as child processes (<= --shards, each --max-old-space-size=4096).
// chain.mjs imports the worktree's src/, and the clean bases were made with
// origin/main's chain: the script REFUSES to run (exit 3) when the resonance
// chain files differ from origin/main (another track editing src/ on this
// branch), unless --allow-chain-diff; the report records the diff.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const NAME = arg("name", "");
const FIR = path.resolve(arg("fir", ""));
const OUT = path.join(repo, "build/resonance-mobile/sbs/predict", NAME);
const only = arg("only", "").split(",").filter(Boolean);
const kinds = arg("kinds", "ctl,sw,exc").split(",");
const CHAIN_FILES = ["src/resonance", "src/resonance-lab", "src/dsp", "src/ml/audio-utils.js", "src/ml/speech-detector.js", "src/utils/constants.js"];
if (!NAME || !existsSync(FIR)) { console.error("need --name and --fir=<taps.json>"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

if (process.argv.includes("--worker")) {
  Object.defineProperty(globalThis, "performance", { value: { now: () => 0, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
  const { selectItems, pitchPass, binsPass, SR } = await import("../chain.mjs");
  const { excItems } = await import("../channel-run.mjs");
  const { applyPert } = await import("../perturb.mjs");
  const streamsDir = path.join(repo, "build/resonance-mobile/streams");
  let items = [
    ...selectItems({ streamsDir, kinds: kinds.filter((k) => k !== "exc"), only }),
    ...(kinds.includes("exc") ? excItems(streamsDir).filter((it) => !only.length || only.includes(it.reader)) : []),
  ];
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  items = items.filter((_, i) => i % sn === si);
  const out = path.join(OUT, `runs-${si}of${sn}.jsonl`);
  const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l).id]; } catch { return []; } }) : []);
  const pert = [{ type: "fir", path: FIR }];
  for (const it of items) {
    if (done.has(it.id)) continue;
    const t0 = Date.now();
    const { y } = await applyPert(pert, it.load(), SR, { id: it.id });
    const byChunk = await pitchPass(y);
    const r = await binsPass(y, byChunk, { gate: "on" });
    appendFileSync(out, JSON.stringify({ id: it.id, reader: it.reader, sex: it.sex, kind: it.kind, variant: it.variant ?? null, seq: it.seq ?? null, joins: it.joins ?? null, n: r.n, posts: r.posts }) + "\n");
    console.log(`${it.id} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  process.exit(0);
}

// ---- parent: the chain must be origin/main's (the bases were made with it), then shards, then the report
const chainDiff = () => spawnSync("git", ["diff", "--stat", "origin/main", "--", ...CHAIN_FILES], { cwd: repo, encoding: "utf8" }).stdout.trim();
if (chainDiff() && !process.argv.includes("--allow-chain-diff")) {
  console.error(`the resonance chain files in this worktree differ from origin/main (the clean bases were made with origin/main's chain):
${chainDiff()}
run the prediction from a worktree on origin/main, or pass --allow-chain-diff to accept it`);
  process.exit(3);
}
if (!process.argv.includes("--report-only")) {
  const n = Math.max(1, Math.min(4, Number(arg("shards", "4"))));
  const kids = [];
  const kill = () => { for (const k of kids) if (k.exitCode == null) spawnSync("taskkill", ["/pid", String(k.pid), "/T", "/F"], { stdio: "ignore" }); };
  process.on("exit", kill);
  process.on("SIGINT", () => { kill(); process.exit(130); });
  const codes = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
    const k = spawn(process.execPath, ["--max-old-space-size=4096", fileURLToPath(import.meta.url), "--worker", `--shard=${i}/${n}`, `--fir=${FIR}`, `--name=${NAME}`, `--kinds=${kinds.join(",")}`, ...(only.length ? [`--only=${only.join(",")}`] : [])],
      { cwd: repo, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    k.stderr.on("data", (d) => { err += d; });
    kids.push(k);
    k.on("exit", (c) => res({ c, err }));
  })));
  for (const x of codes) if (x.c !== 0) { console.error(x.err.slice(-2000)); process.exit(1); }
}
const load = (dir, re) => existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })) : [];
const pred = load(OUT, /^runs-.*\.jsonl$/);
const baseCtl = load(path.join(repo, "build/resonance-mobile/runs/clean"), /^runs-.*\.jsonl$/).filter((r) => r.gate === "on");
const baseExc = load(path.join(repo, "build/resonance-mobile/channel/runs/clean"), /^exc-.*\.jsonl$/).filter((r) => r.gate === "on");
const medN = (rec) => med(rec.posts.filter((p) => p[2] != null && p[7] >= 1).map((p) => p[2]));
const excPeak = (rec) => {
  const [t0, t1] = rec.joins, sg = rec.seq[1].startsWith("U") ? 1 : -1;
  const S = rec.posts.map((p) => ({ t: (p[0] + 1) * 0.025, u: p[2] })).filter((x) => x.u != null);
  const pre = S.filter((x) => x.t <= t0 + 1e-9).pop();
  if (!pre) return null;
  const W = S.filter((x) => x.t > t0 + 1e-9 && x.t <= t1 + 3 + 1e-9);
  return W.length ? Math.max(...W.map((x) => sg * (x.u - pre.u))) : null;
};
const byId = (arr) => new Map(arr.map((r) => [r.id, r]));
const P = byId(pred), BC = byId(baseCtl), BE = byId(baseExc);
const readers = [...new Set(pred.map((r) => r.reader))];
const per = readers.map((rd) => {
  const g = (M, v) => M.get(`${rd}__${v}`);
  const sex = pred.find((r) => r.reader === rd).sex;
  const n = g(P, "N"), bn = g(BC, "N");
  const bias = n && bn ? medN(n) - medN(bn) : null;
  const s = g(P, "U10") && g(P, "D10") ? medN(g(P, "U10")) - medN(g(P, "D10")) : null;
  const bs = g(BC, "U10") && g(BC, "D10") ? medN(g(BC, "U10")) - medN(g(BC, "D10")) : null;
  const exc = {};
  for (const d of [3, 5, 8]) {
    const rs = ["U", "D"].map((b) => { const a = P.get(`${rd}__X${b}${d}`), c = BE.get(`${rd}__X${b}${d}`); const pa = a ? excPeak(a) : null, pc = c ? excPeak(c) : null; return pa != null && pc != null && pc >= 0.25 ? pa / pc : null; }).filter((x) => x != null);
    exc[d] = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  }
  return { reader: rd, sex, bias: r3(bias), sens: r3(s != null && bs ? s / bs : null), exc3: r3(exc[3]), exc5: r3(exc[5]), exc8: r3(exc[8]) };
});
const sum = (rows) => ({ n: rows.length, bias: r3(med(rows.map((x) => x.bias))), sens: r3(med(rows.map((x) => x.sens))), exc3: r3(med(rows.map((x) => x.exc3))), exc5: r3(med(rows.map((x) => x.exc5))), exc8: r3(med(rows.map((x) => x.exc8))) });
const diff = chainDiff();
const report = { name: NAME, fir: FIR, streams: pred.length, chainFilesDifferFromOriginMain: diff || null, perReader: per, summary: { all: sum(per), m: sum(per.filter((x) => x.sex === "m")), f: sum(per.filter((x) => x.sex === "f")) } };
Object.assign(report, { bias: report.summary.all.bias, sens: report.summary.all.sens });
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.summary));
if (diff) console.log(`WARNING: the resonance chain files differ from origin/main:\n${diff}`);
process.exit(0);
