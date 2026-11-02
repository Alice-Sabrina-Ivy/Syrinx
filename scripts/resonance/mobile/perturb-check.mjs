// perturb-check.mjs — self-check of perturb.mjs: biquad responses against the
// RBJ targets, measured on sines through applyPert; noise SNR, level target,
// gain, clip and the compact / JSON spec parser.
//   node scripts/resonance/mobile/perturb-check.mjs [--stream=<48 kHz f32 speech>]
import { readFileSync } from "node:fs";
import { parsePert, pertLabel, applyPert, activeLevelDb, meanLevelDb, biquadCoefs, biquadGainDb } from "./perturb.mjs";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000;
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sine = (f, s = 2) => { const y = new Float32Array(SR * s); for (let i = 0; i < y.length; i++) y[i] = 0.1 * Math.sin((2 * Math.PI * f * i) / SR); return y; };
const rmsDb = (y, from = SR) => { let s = 0; for (let i = from; i < y.length; i++) s += y[i] * y[i]; return 10 * Math.log10(s / (y.length - from)); };

// filters: measured gain on a steady sine vs the analytic response
for (const spec of ["hp:200", "lp:4000", "hp:150:0.7071:2", "hshelf:3000:-6", "lshelf:300:6", "peak:2500:8:2", "bp:1000:2", "notch:120:10"]) {
  const [t] = parsePert(spec);
  const k = biquadCoefs(t, SR);
  for (const f of [100, 500, 1500, 3500, 6000]) {
    const x = sine(f), { y } = await applyPert([t], x, SR);
    const meas = rmsDb(y) - rmsDb(x), want = (t.n ?? 1) * biquadGainDb(k, f, SR);
    check(`${spec} @ ${f} Hz`, Math.abs(meas - want) < 0.05 || (want < -40 && meas < -40), `measured ${meas.toFixed(2)} dB, analytic ${want.toFixed(2)} dB`);
  }
}
{ // -3 dB points of the RBJ low / high pass at Q 0.7071
  const lp = biquadCoefs(parsePert("lp:4000")[0], SR), hp = biquadCoefs(parsePert("hp:200")[0], SR);
  check("lp:4000 is -3 dB at 4 kHz", Math.abs(biquadGainDb(lp, 4000, SR) + 3.01) < 0.02, biquadGainDb(lp, 4000, SR).toFixed(3));
  check("hp:200 is -3 dB at 200 Hz", Math.abs(biquadGainDb(hp, 200, SR) + 3.01) < 0.02, biquadGainDb(hp, 200, SR).toFixed(3));
  const hs = biquadCoefs(parsePert("hshelf:3000:-6")[0], SR);
  check("hshelf:3000:-6 is -6 dB at 12 kHz, ~0 at 200 Hz", Math.abs(biquadGainDb(hs, 12000, SR) + 6) < 0.3 && Math.abs(biquadGainDb(hs, 200, SR)) < 0.2, `${biquadGainDb(hs, 12000, SR).toFixed(2)} / ${biquadGainDb(hs, 200, SR).toFixed(2)}`);
}

// speech-based checks (a stream of the study, or a synthetic pulse train)
let speech;
if (arg("stream", "")) { const b = readFileSync(arg("stream", "")); speech = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(0, SR * 20); }
else { speech = new Float32Array(SR * 10); for (let i = 0; i < speech.length; i++) speech[i] = (i % 400 < 4 ? 0.3 : 0) * (Math.floor(i / SR) % 2 ? 1 : 0.05); }
const a0 = activeLevelDb(speech, SR);
{
  const { y } = await applyPert(parsePert("gain:-20"), speech, SR);
  check("gain:-20", Math.abs(activeLevelDb(y, SR) - a0 + 20) < 0.01, `${(activeLevelDb(y, SR) - a0).toFixed(3)} dB`);
}
{
  const { y, info } = await applyPert(parsePert("level:-40"), speech, SR);
  check("level:-40", Math.abs(activeLevelDb(y, SR) + 40) < 0.01, `active ${activeLevelDb(y, SR).toFixed(3)} dBFS (was ${info[0].activeBefore.toFixed(2)})`);
}
for (const kind of ["white", "pink", "brown"]) {
  const { y, info } = await applyPert(parsePert(`noise:${kind}:10`), speech, SR);
  const n = new Float32Array(y.length); for (let i = 0; i < y.length; i++) n[i] = y[i] - speech[i];
  const snr = activeLevelDb(speech, SR) - meanLevelDb(n, SR);
  check(`noise:${kind}:10 SNR on the 0-8 kHz band`, Math.abs(snr - 10) < 0.05, `${snr.toFixed(3)} dB (noise gain ${info[0].gainDb.toFixed(1)} dB)`);
  const again = await applyPert(parsePert(`noise:${kind}:10`), speech, SR);
  check(`noise:${kind} deterministic`, again.y.every((v, i) => v === y[i]));
}
{
  const { y, info } = await applyPert(parsePert("clip:-30"), speech, SR);
  check("clip:-30 bounds the signal", y.every((v) => Math.abs(v) <= 10 ** (-30 / 20) + 1e-7), `clipped ${(100 * info[0].clippedShare).toFixed(2)} % of samples`);
}
{
  const { y } = await applyPert(parsePert("bw:8000"), speech, SR);
  check("bw:8000 keeps the length", y.length === speech.length);
}
// parser: compact == JSON
const c = parsePert("gain:-6+hp:120:0.7071:2+hshelf:4000:-6+noise:pink:15:7");
const j = parsePert(JSON.stringify([{ type: "gain", db: -6 }, { type: "hp", fc: 120, q: 0.7071, n: 2 }, { type: "hshelf", fc: 4000, db: -6 }, { type: "noise", kind: "pink", snr: 15, seed: 7 }]));
check("compact spec = JSON spec", JSON.stringify(c) === JSON.stringify(j), pertLabel(c));
check("clean spec is empty", parsePert("").length === 0 && parsePert("clean").length === 0);
console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
