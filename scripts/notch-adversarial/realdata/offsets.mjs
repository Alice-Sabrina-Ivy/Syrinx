// offsets.mjs — the real noise-only clips scored from MANY start offsets, the
// lateness rule applied per LINE (2026-10-06 fix round, review of the V14
// follow-up: realeval.mjs streams every clip from 0 s and agg-real.mjs times
// only a stream's FIRST notch, which hid voice-like machine lines that get
// voice timing only when the stream starts mid-clip).
//
//   node scripts/notch-adversarial/realdata/offsets.mjs --variants=B,V14,V18,V19 [--step=3] [--len=30]
//        [--max-span=180] [--shard=i/n] [--out=F] [--ids=a,b]
//   node scripts/notch-adversarial/realdata/offsets.mjs --agg DIR|FILE [...] [--base=B] [--fails=N]
//
// Streams: every noise clip of realeval.mjs's noise set (NOTCHVD_ROOT selects
// the corpus: build/notchvd, or a held-out root), cut at o = 0, step, 2 step,
// ... while o + len <= min(clip, max-span) s; a clip shorter than len is one
// stream (the whole clip). 16 kHz.
// Per stream and variant: a notch-only pass (lib.mjs notchSignature, the
// worker's exact notch input) gives every line's first notch time (lines
// within 3 % are one line); where a variant's notch output differs from the
// base's at all, the real worker runs both and the stream's painted false
// voicing (median-3 + paint gate) is recorded (identical notch output =>
// identical worker messages, lib.mjs memo).
// Strict rule vs the base (bc42ad0), per stream: every line the base notched
// is notched no later than max(6 s, base + 0.3 s); painted FV <= base + 2 pp.
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadIndex, readClip } from "./realdata.mjs";
import { notchSignature, runWorker, displayed } from "../lib.mjs";
import { VARIANTS } from "../variants.mjs";

const argv = process.argv.slice(2);
const A = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const near = (a, b) => Math.abs(a / b - 1) < 0.03;

if (A.agg) {
  const rows = [];
  for (const d of argv.filter((a) => !a.startsWith("--"))) {
    const files = statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [d];
    for (const f of files) rows.push(...JSON.parse(readFileSync(f)));
  }
  const base = A.base || "B", vars = Object.keys(rows[0].v);
  const clips = new Set(rows.map((r) => r.id));
  console.log(`${rows.length} streams from ${clips.size} clips`);
  for (const v of vars) {
    if (v === base) continue;
    const fails = [], bySrc = new Map();
    let differ = 0;
    for (const r of rows) {
      const b = r.v[base], c = r.v[v], f = [];
      if (!c.same) differ++;
      let late = 0;
      for (const [fb, tb] of b.lines) {
        const m = c.lines.find(([fc]) => near(fc, fb));
        const lim = Math.max(6, tb + 0.3);
        if (!m) { f.push(`${fb.toFixed(0)} Hz never (base ${tb})`); late = Math.max(late, r.dur - tb); }
        else if (m[1] > lim) { f.push(`${fb.toFixed(0)} Hz ${m[1]} vs ${tb}`); late = Math.max(late, m[1] - tb); }
      }
      const dp = c.pfv != null && b.pfv != null ? c.pfv - b.pfv : 0;
      if (dp > 2) f.push(`pFV ${c.pfv} vs ${b.pfv}`);
      if (f.length) {
        fails.push([r, f]);
        const s = bySrc.get(r.id) ?? { n: 0, of: rows.filter((q) => q.id === r.id).length, late: 0, dp: 0, at: [] };
        s.n++; s.late = Math.max(s.late, late); s.dp = Math.max(s.dp, dp); s.at.push(r.off);
        bySrc.set(r.id, s);
      }
    }
    console.log(`\n${v}: ${fails.length}/${rows.length} streams fail vs ${base} (${bySrc.size} clips); notch output differs from ${base} in ${differ}`);
    for (const [id, s] of [...bySrc].sort((p, q) => q[1].dp - p[1].dp)) console.log(`  ${id}: ${s.n}/${s.of} offsets fail (at ${s.at.slice(0, 12).join(", ")}${s.at.length > 12 ? ", ..." : ""} s); worst +${s.late.toFixed(2)} s late, pFV +${s.dp.toFixed(1)} pp`);
    if (A.fails) for (const [r, f] of fails.slice(0, +A.fails)) console.log(`     ${r.id} @${r.off}: ${f.join("; ")}`);
  }
  process.exit(0);
}

const VARS = (A.variants || "B,SRC").split(",");
const STEP = Number(A.step ?? 3), LEN = Number(A.len ?? 30), SPAN = Number(A["max-span"] ?? 180);
const [shI, shN] = (A.shard || "0/1").split("/").map(Number);
let recs = loadIndex("noise", { minDur: 10 }).filter((r) => r.label !== "floor" && r.class !== "floor" && r.source !== "synthfloor");
if (A.ids) { const s = new Set(A.ids.split(",")); recs = recs.filter((r) => s.has(r.id)); }
recs.sort((a, b) => a.id.localeCompare(b.id));
const streams = [];
for (const r of recs) {
  const end = Math.min(r.dur, SPAN);
  if (end < LEN) { streams.push([r, 0, r.dur]); continue; }
  for (let o = 0; o + LEN <= end + 1e-9; o += STEP) streams.push([r, o, LEN]);
}
const mine = streams.filter((_, i) => i % shN === shI);
console.error(`${streams.length} streams (${recs.length} clips); this shard ${mine.length}`);
const rows = [];
let clipId = null, clip = null;
for (const [rec, off, len] of mine) {
  if (rec.id !== clipId) { clip = readClip(rec.path); clipId = rec.id; }
  const x = Float32Array.from(clip.subarray(Math.round(off * 16000), Math.round((off + len) * 16000)));
  const row = { id: rec.id, label: rec.label, source: rec.source, off, dur: +(x.length / 16000).toFixed(2), v: {} };
  const sig = {};
  for (const vn of VARS) {
    const lines = [];
    sig[vn] = notchSignature(VARIANTS[vn], x, 16000, (t, fs) => {
      for (const f of fs) if (!lines.some(([q]) => near(q, f))) lines.push([f, +t.toFixed(2)]);
    });
    row.v[vn] = { lines, same: sig[vn] === sig[VARS[0]] };
  }
  if (VARS.some((vn) => !row.v[vn].same)) for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, 16000), disp = displayed(msgs);
    let pf = 0, wf = 0;
    msgs.forEach((m, i) => { if (m.pitch > 0) wf++; if (disp[i] > 0) pf++; });
    row.v[vn].fv = +(100 * wf / msgs.length).toFixed(2);
    row.v[vn].pfv = +(100 * pf / msgs.length).toFixed(2);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (A.out) writeFileSync(A.out, JSON.stringify(rows));
