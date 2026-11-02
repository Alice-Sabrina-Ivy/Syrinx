// sbs-sound.mjs — the public test sound for the phone-vs-headset session
// (a WAV the user plays from a loudspeaker to the Maxwell boom and the
// Pixel side by side). Public material only: synthetic clicks / pink noise /
// a sweep, and two LibriSpeech dev-clean readers (CC BY 4.0) from the WORLD
// renders of the mobile diagnosis (build/resonance-mobile/streams/v/).
//
//   node scripts/resonance/mobile/sbs/sbs-sound.mjs [--out=build/resonance-mobile/sbs/sound/sbs-test.wav]
//        [--man=dev__174] [--woman=dev__84] [--level=-28] [--fir=<taps.json>]
//
// Timeline (file seconds; the manifest <out>.json lists every span exactly):
//     0.0 –   1.5  silence
//     1.5 –  ~4.4  click train A (7 chirp clicks, irregular spacing: alignment)
//    ~4.4 –   6.0  silence (each device's floor for the transfer function)
//     6.0 –  26.0  pink noise, 20 s
//    26.0 –  27.5  silence
//    27.5 –  37.5  log sweep 100 Hz – 8 kHz, 10 s
//    37.5 –  40.0  silence
//    40.0 –  98.0  man   (58 s): N 18 s | U10 3 s | N 8 s | D10 5 s | N 8 s | U10 8 s | N 8 s
//    98.0 – 100.0  silence
//   100.0 – 158.0  woman (58 s): the same excursions
//   158.0 – 160.0  silence
//   160.0 – 190.0  pause probe: 4 s phrases of the two readers with 0.5–3.5 s
//                  digital silences between (each device then hears only its
//                  own room in the gaps: the display's pause regime on the same sound)
//   190.0 – 191.0  silence
//   191.0 – ~194   click train B (same pattern: the end anchor / clock slope)
//   ~194  – 196.0  silence
// U10 / D10 = WORLD renders with the formant scale +12 % / -12 % (about +-1 u
// on the meter); the renders are 54 s long, so the last 4 s of each 58 s
// reader section wrap to the start of the reading (10 ms crossfade).
// Levels: speech scaled to an active level of --level dBFS (perturb.mjs
// activeLevelDb), pink noise and the sweep to the same mean power, clicks
// 0.4 peak. 48 kHz 16-bit mono WAV (+ a .f32 float copy and the manifest).
// --fir: the whole file through those FIR taps (centred) after building —
// the validation's "known channel".
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeWav16, firFilter } from "./sbs-dsp.mjs";
import { activeLevelDb, makeNoise } from "../perturb.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
export const SR = 48000;
export const CLICK_PATTERN = [0, 0.37, 0.81, 1.36, 1.84, 2.43, 2.9];
export const READER_SEGS = [["N", 0], ["U10", 18], ["N", 21], ["D10", 29], ["N", 34], ["U10", 42], ["N", 50]];
export const READER_S = 58;

function chirpClick(peak = 0.4) {
  const n = Math.round(0.008 * SR), y = new Float32Array(n), f0 = 300, f1 = 6000, T = n / SR;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * (f1 / f0) ** (t / T);
    ph += (2 * Math.PI * f) / SR;
    y[i] = Math.sin(ph) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] *= peak / m;
  return y;
}
function logSweep(f0, f1, dur, amp) {
  const n = Math.round(dur * SR), y = new Float32Array(n), K = Math.log(f1 / f0);
  const fade = Math.round(0.02 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR, ph = ((2 * Math.PI * f0 * dur) / K) * (Math.exp((t / dur) * K) - 1);
    const g = Math.min(1, i / fade, (n - 1 - i) / fade);
    y[i] = amp * Math.sin(ph) * g;
  }
  return y;
}
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const msq = (x) => { let s = 0; for (const v of x) s += v * v; return s / x.length; };

export function buildSound({ man = "dev__174", woman = "dev__84", levelDb = -28 } = {}) {
  const L = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8"));
  const total = 196;
  const y = new Float32Array(total * SR);
  const put = (x, t0, g = 1) => { const o = Math.round(t0 * SR); for (let i = 0; i < x.length && o + i < y.length; i++) y[o + i] += g * x[i]; };
  // clicks
  const click = chirpClick();
  const clicks = { A: CLICK_PATTERN.map((c) => 1.5 + c), B: CLICK_PATTERN.map((c) => 191 + c) };
  for (const t of [...clicks.A, ...clicks.B]) put(click, t);
  // pink noise
  const pinkT = [6, 26];
  const pink = makeNoise("pink", (pinkT[1] - pinkT[0]) * SR, 7);
  const target = 10 ** (levelDb / 10);
  const fadeN = Math.round(0.05 * SR);
  const gp = Math.sqrt(target / msq(pink));
  for (let i = 0; i < pink.length; i++) pink[i] *= gp * Math.min(1, i / fadeN, (pink.length - 1 - i) / fadeN);
  put(pink, pinkT[0]);
  // sweep (sine mean power = A^2 / 2)
  const sweepT = [27.5, 37.5];
  put(logSweep(100, 8000, sweepT[1] - sweepT[0], Math.sqrt(2 * target)), sweepT[0]);
  // readers
  const readers = [], events = [];
  const cache = {};
  const variants = (id) => {
    if (cache[id]) return cache[id];
    const r = L.readers.find((x) => x.id === id);
    if (!r) throw new Error(`reader ${id} not in readers-dev.json`);
    const v = Object.fromEntries(["N", "U10", "D10"].map((k) => [k, readF32(r.variants[k])]));
    // one gain per reader (same for all three variants: the renders keep the level)
    const g = 10 ** ((levelDb - activeLevelDb(v.N, SR)) / 20);
    for (const k of Object.keys(v)) for (let i = 0; i < v[k].length; i++) v[k][i] *= g;
    return (cache[id] = { r, v, g });
  };
  const X = Math.round(0.005 * SR);
  for (const [id, t0] of [[man, 40], [woman, 100]]) {
    const { r, v, g } = variants(id);
    const n = READER_S * SR, srcN = v.N.length, x = new Float32Array(n);
    const joins = READER_SEGS.slice(1).map((s) => Math.round(s[1] * SR));
    // the render ends at srcN: a 10 ms crossfade over its last samples into its start
    const W0 = srcN - 2 * X;
    const at = (name, i) => {
      const a = v[name];
      if (i < W0) return a[i];
      const j = i - W0; // the incoming (restarted) reading's index
      if (i < srcN) { const w = j / (2 * X); return (1 - w) * a[i] + w * a[j]; }
      return a[j % srcN];
    };
    for (let i = 0; i < n; i++) {
      let k = 0;
      while (k < joins.length && i >= joins[k] + X) k++;
      if (k < joins.length && i >= joins[k] - X) {
        const a = (i - (joins[k] - X)) / (2 * X);
        x[i] = (1 - a) * at(READER_SEGS[k][0], i) + a * at(READER_SEGS[k + 1][0], i);
      } else x[i] = at(READER_SEGS[k][0], i);
    }
    put(x, t0);
    const segs = READER_SEGS.map(([vv, s], i) => ({ v: vv, s: t0 + s, e: t0 + (READER_SEGS[i + 1]?.[1] ?? READER_S) }));
    readers.push({ id, sex: r.sex, t0, t1: t0 + READER_S, gainDb: 20 * Math.log10(g), segs, wrapAtS: t0 + W0 / SR });
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      if (s.v === "N") continue;
      events.push({ reader: id, sex: r.sex, to: s.v, dir: s.v === "U10" ? "up" : "down", dur: s.e - s.s, ts: s.s, te: s.e, after: s.e + 3 });
    }
  }
  // pause probe: 4 s phrases (10 ms fades) with digital silences between
  const probeT0 = 160;
  const plan = [["m", 4], [null, 2.5], ["m", 4], [null, 1.0], ["m", 4], [null, 3.5], ["f", 4], [null, 2.5], ["f", 4], [null, 0.5]];
  const probe = { t0: probeT0, t1: probeT0, speech: [], silences: [] };
  let t = probeT0, srcOff = { m: 2, f: 2 };
  for (const [who, d] of plan) {
    if (who) {
      const { v } = variants(who === "m" ? man : woman);
      const a = Math.round(srcOff[who] * SR), n = Math.round(d * SR), fd = Math.round(0.01 * SR), x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = v.N[(a + i) % v.N.length] * Math.min(1, i / fd, (n - 1 - i) / fd);
      put(x, t);
      probe.speech.push({ who: who === "m" ? man : woman, s: t, e: t + d });
      srcOff[who] += d + 5;
    } else probe.silences.push({ s: t, e: t + d });
    t += d;
  }
  probe.t1 = t;
  const spans = [
    { kind: "silence", s: 0, e: 1.5 }, { kind: "clicks", name: "A", s: 1.5, e: 1.5 + 2.9 + 0.01 }, { kind: "silence", s: 4.5, e: 6 },
    { kind: "pink", s: pinkT[0], e: pinkT[1] }, { kind: "silence", s: 26, e: 27.5 }, { kind: "sweep", s: sweepT[0], e: sweepT[1], f0: 100, f1: 8000 },
    { kind: "silence", s: 37.5, e: 40 }, { kind: "reader", id: man, s: 40, e: 98 }, { kind: "silence", s: 98, e: 100 },
    { kind: "reader", id: woman, s: 100, e: 158 }, { kind: "silence", s: 158, e: 160 }, { kind: "probe", s: probe.t0, e: probe.t1 },
    { kind: "silence", s: 190, e: 191 }, { kind: "clicks", name: "B", s: 191, e: 191 + 2.9 + 0.01 }, { kind: "silence", s: 194, e: 196 },
  ];
  return {
    y,
    manifest: {
      kind: "sbs-test-sound", v: 1, sr: SR, durS: total, levelDb, clickPattern: CLICK_PATTERN, clicks, clickLenS: click.length / SR,
      floorWindow: [4.7, 5.9], pink: pinkT, sweep: { s: sweepT[0], e: sweepT[1], f0: 100, f1: 8000 }, readers, events, probe, spans,
      source: "LibriSpeech dev-clean (CC BY 4.0), WORLD renders N / U10 / D10 of the mobile resonance diagnosis; synthetic clicks, pink noise, sweep",
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const out = path.resolve(repo, arg("out", "build/resonance-mobile/sbs/sound/sbs-test.wav"));
  const { y: y0, manifest } = buildSound({ man: arg("man", "dev__174"), woman: arg("woman", "dev__84"), levelDb: Number(arg("level", "-28")) });
  let y = y0;
  const firPath = arg("fir", "");
  if (firPath) {
    const h = Float64Array.from(JSON.parse(readFileSync(path.resolve(firPath), "utf8")));
    y = firFilter(y0, h);
    manifest.fir = path.resolve(firPath);
  }
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  mkdirSync(path.dirname(out), { recursive: true });
  const clipped = writeWav16(out, y, SR);
  writeFileSync(out.replace(/\.wav$/, ".f32"), Buffer.from(y.buffer, y.byteOffset, y.byteLength));
  manifest.wav = out; manifest.peak = peak; manifest.clipped = clipped;
  writeFileSync(out.replace(/\.wav$/, ".json"), JSON.stringify(manifest, null, 1));
  console.log(`${out}: ${(y.length / SR).toFixed(1)} s, peak ${peak.toFixed(3)}, clipped ${clipped}, ${manifest.events.length} excursions, readers ${manifest.readers.map((r) => `${r.id} (${r.sex}, ${r.gainDb.toFixed(1)} dB)`).join(", ")}`);
}
