// probe.mjs — run the REAL pitch worker (with its noise notch) over real
// noise-only clips: when (if) the notch promotes, which lines, and how much
// of the clip the worker / the display reports as voice (false voicing).
// Part of the real-data census (it is the "does the shipped notch catch
// this real source?" column), not a tuning run.
//
//   node scripts/notch-adversarial/realdata/probe.mjs [--src=src] [--tag=bc42] [--sources=mssnsd,dcase]
//        [--sr=16000] [--shard=0/1] [--ids=a,b] [--max-sec=90] [--min-dur=10]
// (clips are cut at max-sec: the worker runs ~1x real time on this machine;
// clips shorter than min-dur are skipped — the notch needs >= 5 s to promote)
// Output: build/notchvd/data/census/probe_<tag>[_<shard>].json, one record per clip:
//   { id, dur, promoT (s, first message with a notch; null = never), notchedFrac
//     (fraction of messages with >= 1 notch), freqs (distinct notch freqs, Hz),
//     fvWorker (pitch != null), fvPainted (median-3 + paint gate), fvPaintedAfter20
//     (painted fraction after t = 20 s, the accepted onset-born latency) }
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readClip, resample } from "./realdata.mjs";

const A = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const ROOT = resolve(process.env.NOTCHVD_ROOT ?? "build/notchvd");
const DATA = join(ROOT, "data");
const SRC = resolve(A.src ?? "src");
const TAG = A.tag ?? "src";
const SR = Number(A.sr ?? 16000);
const [SH, NSH] = (A.shard ?? "0/1").split("/").map(Number);

const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
await import(pathToFileURL(join(SRC, "dsp/pitch-worker.js")).href);
const H = globalThis.self.onmessage;
const { pushAndMedianPitch, PITCH_SMOOTH_LEN } = await import(pathToFileURL(join(SRC, "audio/pitchSmoothing.js")).href);
const { createPaintGate } = await import(pathToFileURL(join(SRC, "audio/pitchPaintGate.js")).href);

function runWorker(x, sr) {
  posts.length = 0;
  H({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  H({ data: { type: "audioPort", port } });
  const C = Math.round(0.025 * sr);
  for (let c = 0; c + C <= x.length; c += C) {
    const chunk = Float32Array.from(x.subarray(c, c + C));
    port.onmessage({ data: { buffer: chunk.buffer, contextTime: (c + C) / sr } });
  }
  return posts.filter((p) => p.type === "pitch").map((p) => ({ t: p.contextTime - 0.04, pitch: p.pitch, nf: p.notchedFreqs ?? [] }));
}
function displayed(msgs) {
  const sm = []; const gate = createPaintGate();
  return msgs.map((m) => {
    if (!(m.pitch > 0)) { sm.length = 0; gate.resetSegment(); return 0; }
    const v = pushAndMedianPitch(sm, m.pitch, PITCH_SMOOTH_LEN);
    return gate.push(v) ? v : 0;
  });
}

const mdir = join(DATA, "manifests");
let recs = [];
for (const f of readdirSync(mdir)) if (f.startsWith("noise.") && f.endsWith(".json")) recs.push(...JSON.parse(readFileSync(join(mdir, f), "utf8")));
if (A.sources) { const s = new Set(A.sources.split(",")); recs = recs.filter((r) => s.has(r.source)); }
if (A.ids) { const s = new Set(A.ids.split(",")); recs = recs.filter((r) => s.has(r.id)); }
const MAXS = Number(A["max-sec"] ?? 90), MIND = Number(A["min-dur"] ?? 10);
recs = recs.filter((r) => r.dur >= MIND && r.label !== "floor" && r.class !== "floor");
recs.sort((a, b) => a.id.localeCompare(b.id));
recs = recs.filter((_, i) => i % NSH === SH);

const out = [];
for (const r of recs) {
  let x = readClip(r.path);
  if (MAXS > 0 && x.length > MAXS * 16000) x = x.subarray(0, MAXS * 16000);
  if (SR !== 16000) x = resample(x, 16000, SR);
  const m = runWorker(x, SR);
  const d = displayed(m);
  let promoT = null, nN = 0, fvW = 0, fvP = 0, fvP20 = 0, n20 = 0;
  const freqs = new Set();
  m.forEach((q, i) => {
    if (q.nf.length) { nN++; if (promoT == null) promoT = q.t; q.nf.forEach((f) => freqs.add(Math.round(f))); }
    if (q.pitch > 0) fvW++;
    if (d[i] > 0) fvP++;
    if (q.t >= 20) { n20++; if (d[i] > 0) fvP20++; }
  });
  const n = m.length || 1;
  out.push({ id: r.id, dur: r.dur, probedSec: +(x.length / SR).toFixed(2), promoT: promoT == null ? null : +promoT.toFixed(2), notchedFrac: +(nN / n).toFixed(3),
    freqs: [...freqs].sort((a, b) => a - b).slice(0, 12), fvWorker: +(fvW / n).toFixed(3), fvPainted: +(fvP / n).toFixed(3),
    fvPaintedAfter20: n20 ? +(fvP20 / n20).toFixed(3) : null });
}
mkdirSync(join(DATA, "census"), { recursive: true });
const of = join(DATA, "census", `probe_${TAG}${NSH > 1 ? `_${SH}` : ""}.json`);
writeFileSync(of, JSON.stringify(out, null, 1));
console.log(`${out.length} clips -> ${of}`);
