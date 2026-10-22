// check_runner.mjs — run.mjs's chain vs scripts/heard-as/chain.mjs replay()
// (the heard-as harness the calibration and the CI golden file use) on given
// streams: posted pitch, scored windows (time, mode, classified) and voice
// states must be identical.
//
//   node check_runner.mjs --run=<run.jsonl> --ids=<id,id> --silero=<silero_vad.onnx>

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { replay, loadSpeechDetector, upsample16to48 } = await import(pathToFileURL(path.join(here, "../chain.mjs")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const ids = new Set(arg("ids", "").split(","));
const det = await loadSpeechDetector(arg("silero", ""));
let bad = 0;
for (const l of readFileSync(arg("run", ""), "utf8").split("\n")) {
  if (!l.trim()) continue;
  const s = JSON.parse(l);
  if (!ids.has(s.id)) continue;
  const job = JSON.parse(readFileSync(path.join(path.dirname(s.ref ?? s.f32 ?? ""), "..", "jobs.0.json"), "utf8")).concat(JSON.parse(readFileSync(path.join(path.dirname(s.ref), "..", "jobs.1.json"), "utf8"))).find((j) => j.id === s.id);
  const b = readFileSync(job.f32);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const y = job.sr === 48000 ? Float32Array.from(x) : await upsample16to48(x);
  const r = await replay(y, { sr: 48000, speech: det() });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = {
    pitch: same(r.pitch, s.pitch),
    windows: same(r.windows.map((w) => [w.audioMs, w.mode, w.classify ? 1 : 0]), s.windows),
    states: same(r.ticks.map((t) => [t[0], t[1], t[2]]), s.ticks.map((t) => [t[0], t[1], t[4]])),
  };
  console.log(s.id, JSON.stringify(ok), `pitch ${r.pitch.length} windows ${r.windows.length} ticks ${r.ticks.length}`);
  if (!ok.pitch || !ok.windows || !ok.states) bad++;
}
process.exit(bad ? 1 : 0);
