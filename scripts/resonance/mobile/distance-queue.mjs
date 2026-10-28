// distance-queue.mjs — run distance-run.mjs conditions from conds.json through a
// pool of P child processes (each job = one condition shard), at most P at once.
//
//   node scripts/resonance/mobile/distance-queue.mjs --conds=a,b,c [--P=3] [--shards=3]
//        [--only=<readers>] [--kinds=ctl,sw,exc] [--gate=both] [--root=build/resonance-mobile/distance]
//        [--runs=runs|<subdir of root>] [--pitch-from=<clean pitch cache dirs>]
// The children are plain node processes; each is waited for (no kill by name).
import { readFileSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const root = path.resolve(repo, arg("root", "build/resonance-mobile/distance"));
const conds = JSON.parse(readFileSync(path.join(root, "conds.json"), "utf8"));
const names = arg("conds", "").split(",").filter(Boolean);
for (const n of names) if (!conds[n]) throw new Error(`unknown condition ${n}`);
const P = Number(arg("P", "3")), SH = Number(arg("shards", "3"));
const extra = [];
if (arg("only", "")) extra.push(`--only=${arg("only", "")}`);
if (arg("pitch-from", "")) extra.push(`--pitch-from=${arg("pitch-from", "")}`);
extra.push(`--kinds=${arg("kinds", "ctl,sw,exc")}`, `--gate=${arg("gate", "both")}`);
const runsSub = arg("runs", "runs");
const jobs = names.flatMap((n) => Array.from({ length: SH }, (_, i) => ({ n, i })));
mkdirSync(path.join(root, "logs"), { recursive: true });
const children = new Set();
const cleanup = () => { for (const c of children) try { process.kill(c.pid); } catch { /* gone */ } };
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
let next = 0, running = 0;
await new Promise((resolve) => {
  const launch = () => {
    while (running < P && next < jobs.length) {
      const { n, i } = jobs[next++];
      const log = openSync(path.join(root, "logs", `${runsSub}-${n}-${i}of${SH}.log`), "a");
      const pf = path.join(root, "perts", `${n}.json`);
      mkdirSync(path.dirname(pf), { recursive: true });
      writeFileSync(pf, JSON.stringify(conds[n].pert));
      const args = ["scripts/resonance/mobile/distance-run.mjs", "go", `--cond=${n}`, `--pert=${path.relative(repo, pf)}`, `--shard=${i}/${SH}`, `--out=${path.relative(repo, path.join(root, runsSub))}`, ...extra];
      const c = spawn(process.execPath, args, { cwd: repo, stdio: ["ignore", log, log] });
      children.add(c);
      running++;
      const t0 = Date.now();
      c.on("exit", (code) => {
        children.delete(c);
        running--;
        console.log(`${new Date().toISOString()} ${n} shard ${i}/${SH} exit ${code} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
        if (next >= jobs.length && running === 0) resolve(); else launch();
      });
    }
  };
  launch();
});
console.log("queue done");
