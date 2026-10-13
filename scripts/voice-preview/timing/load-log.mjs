// load-log.mjs — logs whole-machine CPU load during the desktop timing runs (§P5: the
// desktop is shared with other heavy jobs, so its numbers are reported with the load).
// Every --interval seconds: the share of all logical processors' time spent busy since the
// last sample (os.cpus() deltas). JSON lines {t, busyPct, cores}. Stops when --stop-file
// exists or after --max-hours.
//   node scripts/voice-preview/timing/load-log.mjs --out=FILE [--interval=10] [--stop-file=FILE] [--max-hours=8]
import { appendFileSync, existsSync } from "node:fs";
import os from "node:os";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const out = args.out;
if (!out) throw new Error("--out=FILE");
const every = Number(args.interval || 10) * 1000;
const until = Date.now() + Number(args["max-hours"] || 8) * 3600e3;
const snap = () => os.cpus().reduce((s, c) => {
  const t = c.times;
  s.busy += t.user + t.nice + t.sys + t.irq; s.all += t.user + t.nice + t.sys + t.irq + t.idle;
  return s;
}, { busy: 0, all: 0 });
let prev = snap();
const timer = setInterval(() => {
  const cur = snap();
  const busyPct = (100 * (cur.busy - prev.busy)) / Math.max(1, cur.all - prev.all);
  prev = cur;
  appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), busyPct: Math.round(busyPct * 10) / 10, cores: os.cpus().length }) + "\n");
  if ((args["stop-file"] && existsSync(args["stop-file"])) || Date.now() > until) clearInterval(timer);
}, every);
