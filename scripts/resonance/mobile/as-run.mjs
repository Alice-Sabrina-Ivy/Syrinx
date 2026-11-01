// as-run.mjs — the after-speech noise streams (F4 b) and the G-FT streams of
// the narrower resonance-row hold round
// (measurements/resonance-row-hold-narrow-2026-11-01.md §4.3, §4.5). Mirrors
// hold-noise-run.mjs: the REAL pitch worker + real FireRedVAD and, with
// worker: true, the REAL resonance worker beside the replica (every post
// compared), at 1200-sample chunks, 48 kHz. Then pause-row.mjs (the REAL DSP
// worker + REAL hook) and narrow-report.mjs.
//
//   node scripts/resonance/mobile/as-run.mjs prep [--set=dev|fresh] [--readers=<readers json>] [--quiet] [--replace]
//   node scripts/resonance/mobile/as-run.mjs run  [--set=dev|fresh] [--levels=-48,-40] [--what=as,ft,ftas] [--shard=i/n] [--quiet]
//
// prep — per reader (each sex by numeric speaker id; R = [m1, f1, …, m6, f6]):
//   long16 = the reader's 150 s 16 kHz stream (faster-prep.py: utterances in
//   (chapter, utterance) order, 0.3 s exact-zero gaps). Gaps = maximal runs of
//   >= 4800 samples equal to 0.0, g = each start. tCut = the first gap start
//   at or after 25.0 s, + 0.15 s (the middle of the gap); if no gap starts in
//   [25.0, 30.0] s, tCut = 30.0 s and a 20 ms raised-cosine fade-out ending at
//   30.0 s is applied at 48 kHz (gain 0.5·(1 + cos(π·(i + 1)/960)), i = 0…959,
//   on the 960 samples before 30.0 s). asBase = resampleClip(long16, 16000,
//   48000) (= the reader's L stream; checked against its file), samples
//   [0, round(tCut·48000)), zero-padded to 60 s -> <out>/base/<reader>.f32.
//   tLast = the contextTime of the last pitch message the REAL pitch worker
//   (with FireRedVAD) posts voiced (pitch != null) on the speech alone,
//   applyPert([{ type: "level", dbfs: -32 }], asBase) — independent of the
//   noise. Writes <out>/readers.json and the pairing table (clip, level,
//   reader, tCut, tLast) as sets.<set> of --pairing (default
//   scripts/resonance/mobile/narrow-pairing.json; another set is kept as is;
//   the set itself is replaced only with --replace). --quiet: tLast is
//   written, not printed.
// Pairing: the clips sorted by (metadata family: speech-free 0, talker 1 —
//   narrow-screen.json sets.<set>; then the id as a JavaScript string, <);
//   clip i gets R[i mod 12]; the same at both levels. The G-FT clips (dev
//   only, all talker) are paired the same way among themselves.
// run — per (clip, level L), one 60 s stream:
//   as    kind "as": pert = [{ type: "level", dbfs: -32 }, ...clipPert(clip, L)]
//         on the clip's reader's asBase: the speech at -32 dBFS active, the
//         clip's noise (hold-noise-run.mjs clipPert: resampleClip to 48 kHz
//         from its start, a 50 Hz high-pass, the median 50 ms DSP intensity of
//         the noise alone = L) throughout the 60 s;
//   ft    (dev) G-FT cold start: kind "ext", the talker clip alone on 60 s of
//         zeros (exactly as hold-noise-run.mjs);
//   ftas  (dev) G-FT after speech: kind "as" with the talker clip as the noise.
//   Conditions: AS_m<L>, FT_m<L>, FTAS_m<L> under <runs>/ (default
//   build/resonance-mobile/narrow/runs-<set>); chain.mjs's record format plus
//   cls, sub, source, family, screenClass, noiseDb, levelCheck { speechActiveDb
//   (the speech after the level step), noiseDspMedDb (the noise alone) } and,
//   for kind "as", asBase, tCut, tLast. Resumable and sharded.
//   Printed per stream (always): id, worker parity, the level checks, timing.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { pitchPass, binsPass, pitchStats, voicedHopRms, SR, CH } = await import("./chain.mjs");
const { applyPert, activeLevelDb } = await import("./perturb.mjs");
const { clipPert, CLIP_S } = await import("./hold-noise-run.mjs");
const { dspMedianDb } = await import("./pause-noise.mjs");
const { resampleClip } = await import(pathToFileURL(path.join(repo, "src/voice-preview/engine/preview.js")).href);

export const AS = Object.freeze({ speechDbfs: -32, cutFromS: 25.0, cutToS: 30.0, gapMin: 4800, halfGapS: 0.15, fadeN: 960, streamS: 60 });
const SETS = {
  dev: {
    readers: "build/resonance-mobile/streams/readers-dev.json",
    list: "scripts/resonance/mobile/hold-noise-list.json", root: "C:/Coding Projects/Syrinx-cache/noise-real",
    ft: { list: "build/resonance-mobile/narrow/ft-clips/ft-list.json", root: "build/resonance-mobile/narrow/ft-clips" },
  },
  fresh: {
    readers: null, // --readers (the confirmation readers' faster-streams list)
    list: "scripts/resonance/mobile/narrow-noise-list.json", root: "C:/Coding Projects/Syrinx-cache/noise-real-narrow",
    ft: null,
  },
};
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const writeF32 = (p, x) => writeFileSync(p, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
const strCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** R = [m1, f1, m2, f2, …]: each sex by numeric speaker id. */
export function readerOrder(readers) {
  const by = (s) => readers.filter((r) => r.sex === s).sort((a, b) => Number(a.speaker) - Number(b.speaker));
  const m = by("m"), f = by("f");
  if (m.length !== f.length) throw new Error(`readers: ${m.length} men, ${f.length} women`);
  return m.flatMap((x, i) => [x, f[i]]);
}
/** The pairing: clips sorted by (family speech-free 0 / talker 1, id), clip i -> R[i mod |R|]. */
export function pairClips(clips, familyOf, R) {
  const fam = (c) => { const f = familyOf(c); if (f !== "speech-free" && f !== "talker") throw new Error(`${c.id}: family ${f}`); return f === "talker" ? 1 : 0; };
  const s = [...clips].sort((a, b) => fam(a) - fam(b) || strCmp(a.id, b.id));
  return s.map((c, i) => ({ clip: c, reader: R[i % R.length] }));
}
/** tCut, the fade flag and asBase from the reader's 16 kHz long stream (§4.3). */
export function speechSegment(long16) {
  const gaps = [];
  let run = 0;
  for (let i = 0; i <= long16.length; i++) {
    if (i < long16.length && long16[i] === 0) { run++; continue; }
    if (run >= AS.gapMin) gaps.push(i - run);
    run = 0;
  }
  const g = gaps.find((s) => s / 16000 >= AS.cutFromS);
  const inWin = g != null && g / 16000 <= AS.cutToS;
  const tCut = inWin ? g / 16000 + AS.halfGapS : AS.cutToS;
  const L48 = resampleClip(long16, 16000, 48000);
  const nCut = Math.round(tCut * 48000);
  const base = new Float32Array(AS.streamS * 48000);
  base.set(L48.subarray(0, nCut));
  if (!inWin) for (let i = 0; i < AS.fadeN; i++) base[nCut - AS.fadeN + i] *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / AS.fadeN));
  // the cut lies in the gap's middle: is the 48 kHz stream exactly 0 there (±50 ms)?
  let zeroAround = inWin;
  if (inWin) for (let i = nCut - 2400; i < nCut + 2400; i++) if (L48[i] !== 0) { zeroAround = false; break; }
  return { tCut, fade: !inWin, gapStartS: inWin ? g / 16000 : null, nCut, base, L48, zeroAround };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const mode = process.argv[2];
  const set = arg("set", "dev");
  const S = SETS[set];
  if (!S) throw new Error(`--set=${set}`);
  const QUIET = process.argv.includes("--quiet");
  const OUT = path.resolve(repo, arg("out", `build/resonance-mobile/narrow/as-${set}`));
  const readersFile = arg("readers", "") || S.readers;
  if (!readersFile) throw new Error("--readers=<readers json> is required for this set");
  const readers = JSON.parse(readFileSync(path.resolve(repo, readersFile), "utf8")).readers;
  const R = readerOrder(readers);
  const screen = JSON.parse(readFileSync(path.join(repo, "scripts/resonance/mobile/narrow-screen.json"), "utf8")).sets?.[set];
  if (!screen) throw new Error(`narrow-screen.json has no set ${set} (run screen-silero.mjs --set=${set})`);
  const scr = new Map(screen.clips.map((c) => [c.id, c]));
  const list = JSON.parse(readFileSync(path.resolve(repo, S.list), "utf8")).clips;
  for (const c of list) if (!scr.has(c.id)) throw new Error(`${c.id}: not in the screen`);
  const pairs = pairClips(list, (c) => scr.get(c.id).family, R);
  const ftList = S.ft ? JSON.parse(readFileSync(path.resolve(repo, S.ft.list), "utf8")).clips : [];
  const ftPairs = S.ft ? pairClips(ftList, (c) => c.family, R) : [];
  mkdirSync(path.join(OUT, "base"), { recursive: true });
  const baseOf = (rd) => path.join(OUT, "base", `${rd.id}.f32`);

  if (mode === "prep") {
    const info = [];
    for (const rd of R) {
      const t0 = Date.now();
      const seg = speechSegment(readF32(rd.long));
      const Lfile = rd.variants?.L && existsSync(rd.variants.L) ? readF32(rd.variants.L) : null;
      const sameL = Lfile ? Lfile.length === seg.L48.length && Lfile.every((v, i) => v === seg.L48[i]) : null;
      writeF32(baseOf(rd), seg.base);
      const { y } = await applyPert([{ type: "level", dbfs: AS.speechDbfs }], seg.base, SR, { id: rd.id, reader: rd.id, sex: rd.sex, kind: "as" });
      const byChunk = await pitchPass(y);
      let tLast = null;
      for (const c of byChunk) for (const m of c) if (m[0] && m[1] !== null) tLast = m[2];
      const row = { id: rd.id, speaker: String(rd.speaker), sex: rd.sex, tCut: seg.tCut, fade: seg.fade, gapStartS: seg.gapStartS, cutZeroAround: seg.zeroAround,
        lMatchesFile: sameL, speechActiveDb: activeLevelDb(y, SR), tLast };
      info.push(row);
      console.log(`${rd.id} (${rd.sex}): tCut ${seg.tCut.toFixed(4)} s${seg.fade ? " (fade-out)" : ""}, cut in exact zeros ${seg.zeroAround}, L = file ${sameL}, active ${row.speechActiveDb.toFixed(2)} dBFS${QUIET ? "" : `, tLast ${tLast?.toFixed(4)} s`}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    writeFileSync(path.join(OUT, "readers.json"), JSON.stringify({ set, readers: info }, null, 1));
    const byId = new Map(info.map((r) => [r.id, r]));
    const rows = (ps, kind) => ps.map(({ clip, reader }) => ({ clip: clip.id, family: kind === "ft" ? "talker" : scr.get(clip.id).family, reader: reader.id, tCut: byId.get(reader.id).tCut, tLast: byId.get(reader.id).tLast }));
    const pf = path.resolve(repo, arg("pairing", "scripts/resonance/mobile/narrow-pairing.json"));
    const doc = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : { note: "Pairing tables of the narrower resonance-row hold round: measurements/resonance-row-hold-narrow-2026-11-01.md §4.3 (as-run.mjs prep). The same pairing at both levels (-48, -40 dBFS).", sets: {} };
    if (doc.sets[set] && !process.argv.includes("--replace")) throw new Error(`${pf} already has set ${set} (--replace to rebuild it)`);
    doc.sets[set] = {
      R: R.map((r) => r.id), levels: [-48, -40],
      readers: info.map(({ id, speaker, sex, tCut, fade, gapStartS, tLast }) => ({ id, speaker, sex, tCut, fade, gapStartS, tLast })),
      as: rows(pairs, "as"), ...(S.ft ? { ft: rows(ftPairs, "ft") } : {}),
    };
    writeFileSync(pf, JSON.stringify(doc, null, 1) + "\n");
    console.log(`pairing: ${pairs.length} clips${S.ft ? ` + ${ftPairs.length} G-FT clips` : ""} -> ${pf} (sets.${set})`);
    process.exit(0);
  }

  if (mode !== "run") throw new Error("mode: prep | run");
  const rinfo = JSON.parse(readFileSync(path.join(OUT, "readers.json"), "utf8")).readers;
  const rmap = new Map(rinfo.map((r) => [r.id, r]));
  const levels = arg("levels", "-48,-40").split(",").map(Number);
  const what = arg("what", S.ft ? "as,ft,ftas" : "as").split(",");
  const runsRoot = path.resolve(repo, arg("runs", `build/resonance-mobile/narrow/runs-${set}`));
  const jobs = [];
  for (const L of levels) {
    if (what.includes("as")) for (const p of pairs) jobs.push({ L, kind: "as", cond: `AS_m${-L}`, clip: p.clip, reader: p.reader, path: path.join(S.root, "clips", `${p.clip.id}.wav`), family: scr.get(p.clip.id).family, screenClass: scr.get(p.clip.id).class });
    if (what.includes("ft")) for (const p of ftPairs) jobs.push({ L, kind: "ext", cond: `FT_m${-L}`, clip: p.clip, reader: null, path: path.resolve(repo, S.ft.root, "clips", `${p.clip.id}.wav`), family: "talker", screenClass: "talker" });
    if (what.includes("ftas")) for (const p of ftPairs) jobs.push({ L, kind: "as", cond: `FTAS_m${-L}`, clip: p.clip, reader: p.reader, path: path.resolve(repo, S.ft.root, "clips", `${p.clip.id}.wav`), family: "talker", screenClass: "talker" });
  }
  const [si, sn] = arg("shard", "0/1").split("/").map(Number);
  const mine = jobs.filter((_, i) => i % sn === si);
  const done = new Set();
  for (const cond of new Set(jobs.map((j) => j.cond))) {
    const dir = path.join(runsRoot, cond);
    mkdirSync(path.join(dir, "pitch"), { recursive: true });
    for (const f of readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))) {
      for (const l of readFileSync(path.join(dir, f), "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${cond}|${r.id}`); } catch { /* partial line */ } }
    }
  }
  console.log(`${mine.length} jobs (${mine.filter((j) => done.has(`${j.cond}|${j.clip.id}`)).length} done)`);
  const t0 = Date.now();
  let audioS = 0, totChk = 0, totMis = 0;
  for (const j of mine) {
    if (done.has(`${j.cond}|${j.clip.id}`)) continue;
    if (!existsSync(j.path)) throw new Error(`missing clip ${j.path}`);
    const dir = path.join(runsRoot, j.cond);
    const out = path.join(dir, `runs-${si}of${sn}.jsonl`);
    const tp = Date.now();
    const noisePert = clipPert(j.path, j.L);
    const zeros = new Float32Array(CLIP_S * SR);
    const noiseAlone = (await applyPert(noisePert, zeros, SR, { id: j.clip.id, reader: j.clip.id, sex: "na", kind: "ext" })).y;
    let y0, pert, ctx, extra, speechActiveDb = null;
    if (j.kind === "as") {
      const ri = rmap.get(j.reader.id);
      y0 = readF32(baseOf(j.reader));
      pert = [{ type: "level", dbfs: AS.speechDbfs }, ...noisePert];
      ctx = { id: j.clip.id, reader: j.reader.id, sex: j.reader.sex, kind: "as" };
      speechActiveDb = activeLevelDb((await applyPert(pert.slice(0, 1), y0, SR, ctx)).y, SR);
      extra = { asBase: baseOf(j.reader), tCut: ri.tCut, tLast: ri.tLast };
    } else {
      y0 = zeros;
      pert = noisePert;
      ctx = { id: j.clip.id, reader: j.clip.id, sex: "na", kind: "ext" };
      extra = {};
    }
    const { y, info } = await applyPert(pert, y0, SR, ctx);
    if (y.length !== CLIP_S * SR || y.length % CH !== 0) throw new Error(`${j.clip.id}: stream length ${y.length}`);
    const noiseDspMedDb = dspMedianDb(noiseAlone);
    const msPert = Date.now() - tp;
    const t1 = Date.now();
    const byChunk = await pitchPass(y);
    const msPitch = Date.now() - t1;
    const hr = voicedHopRms(y, byChunk);
    const meta = { id: j.clip.id, dur: y.length / SR, byChunk, pertKey: JSON.stringify(pert), pertInfo: info, msPitch,
      level: { inActiveDb: activeLevelDb(y0, SR), outActiveDb: activeLevelDb(y, SR), voicedHopRmsMedDb: hr.med, voicedHopRmsP10Db: hr.p10 } };
    writeFileSync(path.join(dir, "pitch", `${j.clip.id}.json`), JSON.stringify(meta));
    const t2 = Date.now();
    const r = await binsPass(y, byChunk, { gate: "on", worker: true });
    const msBins = Date.now() - t2;
    const ps = pitchStats(byChunk);
    const rec = {
      id: j.clip.id, reader: ctx.reader, sex: ctx.sex, kind: ctx.kind, variant: null, seq: null, joins: null,
      cls: j.clip.cls, sub: j.clip.sub ?? null, source: j.clip.source, family: j.family, screenClass: j.screenClass, noiseDb: j.L,
      levelCheck: { speechActiveDb, noiseDspMedDb }, ...extra,
      trail: 100, n: r.n, nbResets: r.nbResets, bins: r.bins, posts: r.posts, worker: r.worker,
      cond: j.cond, gate: "on", pert, pertInfo: info, hintDelay: 0, nbF: r.nbF, nbFinal: r.nbFinal,
      pitchStats: ps, level: meta.level, ms: { pert: msPert, pitch: msPitch, bins: msBins },
    };
    appendFileSync(out, JSON.stringify(rec) + "\n");
    audioS += CLIP_S; totChk += r.worker.checked; totMis += r.worker.mismatch;
    console.log(`${j.cond} ${j.clip.id}${j.reader ? ` + ${j.reader.id}` : ""}: worker ${r.worker.checked - r.worker.mismatch}/${r.worker.checked}, ${speechActiveDb != null ? `speech ${speechActiveDb.toFixed(2)} dBFS, ` : ""}noise ${noiseDspMedDb.toFixed(2)} dBFS${QUIET ? "" : `, shown voiced ${(100 * (ps.voiced - ps.hidden) / ps.hops).toFixed(1)} %`}, pitch ${(msPitch / 1000).toFixed(1)} s bins ${(msBins / 1000).toFixed(1)} s [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x real time]`);
  }
  console.log(`worker parity: ${totChk - totMis}/${totChk} posts equal`);
  process.exit(0);
}
