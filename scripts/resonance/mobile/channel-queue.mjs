// channel-queue.mjs — runs channel-run.mjs over a list of conditions, 3 shards
// each, at most --jobs processes at once (default 3).
//   node scripts/resonance/mobile/channel-queue.mjs --conds=a,b,c [--jobs=3] [--out=build/resonance-mobile/channel/runs]
//        [--plan=a:ctl,exc;b:ctl] [--wait-pids=1,2,3]
// "clean" runs the excursion streams only (the clean controls / switch streams
// are build/resonance-mobile/runs/clean). --plan gives per-condition kinds
// (default ctl,sw,exc). --wait-pids: start only after these processes exit.
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const plan = arg("plan", "") ? arg("plan", "").split(";").filter(Boolean).map((s) => { const [c, k] = s.split(":"); return { c, kinds: k || "ctl,sw,exc" }; })
  : arg("conds", "").split(",").filter(Boolean).map((c) => ({ c, kinds: c === "clean" ? "exc" : "ctl,sw,exc" }));
const J = Number(arg("jobs", "3")), SH = 3;
const out = arg("out", "build/resonance-mobile/channel/runs");
const waitPids = arg("wait-pids", "").split(",").filter(Boolean).map(Number);
const logs = path.join(repo, "build/resonance-mobile/channel/logs");
mkdirSync(logs, { recursive: true });
const jobs = plan.flatMap(({ c, kinds }) => Array.from({ length: SH }, (_, i) => ({ c, i, kinds })));
let running = 0, next = 0;
const t0 = Date.now();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function launch() {
  const busy = waitPids.filter(alive).length;
  while (running + busy < J && next < jobs.length) {
    const { c, i, kinds } = jobs[next++];
    const fd = openSync(path.join(logs, `${c}-${i}.log`), "a");
    const args = [path.join(repo, "scripts/resonance/mobile/channel-run.mjs"), `--cond=${c}`, `--shard=${i}/${SH}`, `--out=${out}`, `--kinds=${kinds}`];
    const ch = spawn(process.execPath, args, { cwd: repo, stdio: ["ignore", fd, fd] });
    running++;
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] start ${c} ${i}/${SH} (${kinds}) pid ${ch.pid}`);
    ch.on("exit", (code) => {
      running--;
      console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] done ${c} ${i}/${SH} code ${code}`);
      launch();
      if (!running && next >= jobs.length) console.log("ALL DONE");
    });
  }
  if (next < jobs.length && waitPids.some(alive)) setTimeout(launch, 5000);
}
launch();
