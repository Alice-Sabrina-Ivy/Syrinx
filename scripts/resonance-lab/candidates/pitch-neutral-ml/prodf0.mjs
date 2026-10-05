// Production-detector F0 tracks for the pitch-neutral-ml robustness variant.
// Emulates src/dsp/pitch-worker.js on 16 kHz input (no resampling needed): 25 ms chunks ->
// persistent-peak notch -> 1280-sample rolling buffer -> Boersma-AC candidates -> L=2 path
// tracker -> notch veto -> above-400 Hz null -> harmonic voicing guard. Each decoded frame is attributed to the
// centre of its 80 ms analysis buffer (end of chunk k minus 40 ms), then mapped onto the
// benchmark's 10 ms grid (t_j = 0.005 + 0.01 j) by nearest frame (<= 12.5 ms away).
//   node prodf0.mjs jobs.json      jobs = [{audio: in.f32, out: out.f32, n10: <grid length>}]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../../../src/dsp");
const B = await import(pathToFileURL(path.join(SRC, "boersma-ac.js")).href);
const N = await import(pathToFileURL(path.join(SRC, "noise-notch.js")).href);
const { PITCH_DISPLAY_RANGE } = await import(pathToFileURL(path.join(SRC, "../utils/constants.js")).href);
const SR = 16000, CH = 400, FL = B.BOERSMA_FRAME_LENGTH_16K;

function track(x, n10) {
  const det = B.createBoersmaAC(SR, FL), tr = B.createPathTracker(), notch = N.createNoiseNotch(SR);
  const guard = B.createHarmonicVoicingGuard();
  const buf = new Float32Array(FL);
  let fill = 0;
  const delay = [], times = [], out = [];
  for (let s = 0; s + CH <= x.length; s += CH) {
    const inc = notch.process(x.slice(s, s + CH));
    buf.copyWithin(0, CH); buf.set(inc, FL - CH); fill = Math.min(FL, fill + CH);
    if (fill < FL) continue;
    const c = det.candidates(buf);
    delay.push(Float32Array.from(buf));
    if (delay.length > tr.config.lookback + 1) delay.shift();
    times.push((s + CH) / SR - 0.04);
    const d = tr.emit(c);
    if (times.length <= tr.config.lookback) continue;
    const t = times.shift();
    let v = d;
    if (v > 0 && N.isNearNotch(v, notch.activeLines())) v = null;
    if (v > PITCH_DISPLAY_RANGE.high) v = null; // pitch-worker.js: above-range decodes post unvoiced, before the guard
    if (v > 0 && !guard.check(delay[0], v, SR)) v = null;
    out.push([t, v > 0 ? v : 0]);
  }
  const f = new Float32Array(n10);
  let k = 0;
  for (let j = 0; j < n10; j++) {
    const tj = 0.005 + 0.01 * j;
    while (k + 1 < out.length && Math.abs(out[k + 1][0] - tj) <= Math.abs(out[k][0] - tj)) k++;
    if (out.length && Math.abs(out[k][0] - tj) <= 0.0125) f[j] = out[k][1];
  }
  return f;
}

const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const j of jobs) {
  const b = fs.readFileSync(j.audio);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const f = track(x, j.n10);
  fs.writeFileSync(j.out, Buffer.from(f.buffer));
}
