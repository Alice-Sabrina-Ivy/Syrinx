// timing-analyze.mjs — per-run timing metrics of timing-run.mjs logs, and
// paired comparisons against a base run on the same WAV.
//
//   node scripts/resonance/mobile/timing-analyze.mjs --runs=<run.json>[,<run.json>...]
//        [--base=<run.json of the same wav>] [--json=<out.json>] [--quiet]
//
// Clocks: every wall time is epoch ms (performance.timeOrigin + now()) in its
// own context. The audio clock is the chunks' contextTime (MSTP AudioData
// timestamps). off = min over chunks of (dispatch wall − contextTime·1000):
// the capture → dispatch path at its fastest; every "lag" below is in excess
// of that floor (so the fixed capture latency — the fake device's ~10 ms
// buffers here, a phone's 40 ms — is not in it).
// File time: contextTime − ct0, ct0 from correlating the chunks' energy with
// the WAV's (1 ms coarse, sample-exact refine).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const runs = arg("runs", "").split(",").filter(Boolean);
const basePath = arg("base", "");
const QUIET = process.argv.includes("--quiet");
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const wavCache = new Map();
function loadWav(p) {
  if (wavCache.has(p)) return wavCache.get(p);
  const b = readFileSync(p);
  const n = (b.length - 44) / 2;
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const v = b.readInt16LE(44 + 2 * i) / 32767; cs[i + 1] = cs[i] + v * v; }
  const man = JSON.parse(readFileSync(p.replace(/\.wav$/, ".json"), "utf8"));
  const w = { n, cs, man, sr: 48000 };
  wavCache.set(p, w);
  return w;
}

function align(chunks, w, capSr) {
  // chunks: [{ct, ms, len}] at the capture rate capSr (Chrome's fake device
  // resamples the 48 kHz file to it); file sample e = round((ct - ct0)·sr) = chunk end
  const sr = w.sr, kk = sr / capSr;
  const use = chunks.filter((c, i) => i < 4000);
  const lf = (x) => Math.log10(x + 1e-9);
  const ys = use.map((c) => lf(c.ms));
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  function score(ct0, sub = 1) {
    let sxy = 0, sxx = 0, syy = 0, nn = 0, sx = 0;
    const xs = [];
    for (let i = 0; i < use.length; i += sub) {
      const e = Math.round((use[i].ct - ct0) * sr), s = e - Math.round(use[i].len * kk);
      if (s < 0 || e > w.n) { xs.push(null); continue; }
      const x = lf((w.cs[e] - w.cs[s]) / (e - s));
      xs.push(x); sx += x; nn++;
    }
    if (nn < 50) return -2;
    const mx = sx / nn;
    let k = 0;
    for (let i = 0; i < use.length; i += sub, k++) {
      const x = xs[k];
      if (x == null) continue;
      const y = ys[i] - my;
      sxy += (x - mx) * y; sxx += (x - mx) ** 2; syy += y * y;
    }
    return sxy / Math.sqrt(sxx * syy + 1e-12);
  }
  const ctFirst = use[0].ct - use[0].len / capSr;
  let best = -3, bestCt0 = null;
  // the file starts when capture starts: first chunk at file time 0..40 s
  for (let ms = -2000; ms <= 40000; ms += 1) {
    const ct0 = ctFirst - ms / 1000;
    const s = score(ct0, 8);
    if (s > best) { best = s; bestCt0 = ct0; }
  }
  let best2 = -3, ct0f = bestCt0;
  for (let d = -60; d <= 60; d++) {
    const ct0 = bestCt0 + d / sr;
    const s = score(ct0, 1);
    if (s > best2) { best2 = s; ct0f = ct0; }
  }
  return { ct0: ct0f, r: best2 };
}

export function eventMetrics(st, man, domTL = [], wallOfFileT = () => NaN) {
  const ev = man.events.map((e) => {
    const inWin = (a, b) => st.filter((s) => s.u != null && s.ft >= a && s.ft < b);
    const before = st.filter((s) => s.u != null && s.ft < e.ts && s.ft >= e.ts - 3);
    const sign = e.dir === "up" ? 1 : -1;
    const out = { ...e };
    if (e.kind === "long") {
      const pre = med(before.map((s) => s.u)), post = med(inWin(e.te - 4, e.te).map((s) => s.u));
      out.pre = pre; out.post = post; out.size = post != null && pre != null ? post - pre : null;
      for (const [k, f] of [["t50", 0.5], ["t90", 0.9]]) {
        const hit = out.size ? st.find((s) => s.u != null && s.ft > e.ts && s.ft <= e.te && (s.u - pre) / out.size >= f) : null;
        out[k] = hit ? hit.ft - e.ts : null;                                     // audio time (the post's newest chunk)
        out[k + "Wall"] = hit ? (hit.a - wallOfFileT(e.ts)) / 1000 : null;     // capture of the switch -> post on main
        const dhit = out.size ? domTL.find((d) => d.a > wallOfFileT(e.ts) && d.a <= wallOfFileT(e.te) && d.v != null && (d.v - pre) / out.size >= f) : null;
        out[k + "Dom"] = dhit ? (dhit.a - wallOfFileT(e.ts)) / 1000 : null;     // capture of the switch -> shown value on screen (DOM)
      }
    } else {
      const pb = st.filter((s) => s.u != null && s.ft < e.ts).at(-1);
      const pre = pb?.u ?? null;
      out.pre = pre;
      const win = st.filter((s) => s.u != null && s.ft > e.ts && s.ft <= e.after);
      let pk = null, tpk = null;
      for (const s of win) { const d = sign * (s.u - pre); if (pk === null || d > pk) { pk = d; tpk = s.ft - e.ts; } }
      out.peak = pk; out.tPeak = tpk;
      // on screen: the column's value over [capture of ts, capture of `after` + 1 s]
      const pd = domTL.filter((d) => d.a < wallOfFileT(e.ts)).at(-1);
      const preD = pd?.v ?? pre;
      let pkD = null;
      for (const d of domTL) if (d.a > wallOfFileT(e.ts) && d.a <= wallOfFileT(e.after) + 1000 && d.v != null) { const x = sign * (d.v - preD); if (pkD === null || x > pkD) pkD = x; }
      out.peakDom = pkD;
    }
    return out;
  });
  // steady levels (block A U10, block E D10, N before each)
  const steady = [];
  for (const b of man.blocks.filter((b) => b.block === "A" || b.block === "E")) {
    const seg = b.segs[1];
    const lv = (a, c) => med(st.filter((s) => s.u != null && s.ft >= a && s.ft < c).map((s) => s.u));
    steady.push({ reader: b.reader, sex: b.sex, block: b.block, v: seg.v, N: lv(seg.s - 4, seg.s), X: lv(seg.e - 4, seg.e) });
  }
  return { ev, steady };
}

export function analyze(file) {
  const J = JSON.parse(readFileSync(file, "utf8"));
  const L = J.log;
  const w = loadWav(J.wav);
  const chunks = [];
  for (let i = 0; i < L.chunks.length; i += 4) chunks.push({ wall: L.chunks[i], ct: L.chunks[i + 1], ms: L.chunks[i + 2], len: L.chunks[i + 3] });
  const off = Math.min(...chunks.map((c) => c.wall - c.ct * 1000));
  const dispByCt = new Map(chunks.map((c) => [c.ct, c.wall]));
  const dispLag = chunks.map((c) => c.wall - c.ct * 1000 - off);
  const ctSteps = chunks.slice(1).map((c, i) => c.ct - chunks[i].ct);
  const gaps = ctSteps.filter((d) => Math.abs(d - 0.025) > 0.002).length;
  // audio the capture reader lost (MSTP drops AudioData frames when its reader falls behind)
  const lostAudioMs = ctSteps.reduce((a, d) => a + (d > 0.0275 ? (d - 0.025) * 1000 : 0), 0);
  const maxGapMs = Math.max(0, ...ctSteps.map((d) => (d - 0.025) * 1000));
  const capSr = L.diagAudio?.sampleRate ?? 48000;
  const audioRate = (chunks.at(-1).ct - chunks[0].ct) / ((chunks.at(-1).wall - chunks[0].wall) / 1000);
  const { ct0, r: alignR } = align(chunks, w, capSr);
  const fileT = (ct) => ct - ct0;
  const wallOfFileT = (t) => off + (ct0 + t) * 1000; // capture wall time of file time t
  // pitch messages
  const P = [];
  for (let i = 0; i < L.pitch.length; i += 8) P.push({ a: L.pitch[i], ct: L.pitch[i + 1], ts: L.pitch[i + 2], voiced: L.pitch[i + 3], pitch: L.pitch[i + 4], vad: L.pitch[i + 5], inferMs: L.pitch[i + 6], vadMs: L.pitch[i + 7] });
  const pitchLag = P.map((p) => p.a - (off + p.ct * 1000));           // capture of its chunk -> main arrival (incl. 2-hop decode)
  const pitchPostToMain = P.map((p) => p.a - p.ts);                   // worker post -> main
  const pitchWorkerLag = P.map((p) => p.ts - (off + p.ct * 1000));    // capture -> worker post
  const vadSeen = P.filter((p) => p.vad >= 0);
  // states
  const S = L.states.filter((s) => s.tm && s.tm.ct != null);
  const st = S.map((s) => {
    const disp = dispByCt.get(s.tm.ct);
    return {
      ...s, ft: fileT(s.tm.ct), ct: s.tm.ct,
      lagChunk: s.a - (off + s.tm.ct * 1000),                       // capture of the newest chunk in it -> main arrival
      hintLagS: s.tm.hCt != null ? s.tm.ct - s.tm.hCt : null,       // audio: newest chunk - newest hint's frame chunk (2 hops = 0.05 s by design)
      lagContent: s.tm.hCt != null ? s.a - (off + s.tm.hCt * 1000) : null, // capture of the newest hint's chunk -> main arrival
      wq: disp != null ? s.tm.chArr - disp : null,                  // chunk dispatch -> worker handling start
      wproc: s.tm.wt - s.tm.chArr,                                  // handling start -> post
      p2m: s.a - s.tm.wt,                                           // post -> main
      hintRelay: s.tm.hArr != null ? s.tm.hArr - (off + s.tm.hCt * 1000) : null, // capture of hint chunk -> hint handled in worker
    };
  });
  const last = st.at(-1) ?? {};
  const perf = last.perf ?? {};
  const statuses = L.wstatus.map((x) => `${x.kind}:${x.status}`);
  const overloads = L.wstatus.filter((x) => x.status === "overloaded").length;
  const vadSlow = L.wstatus.some((x) => x.type === "vad-status" && x.status === "slow");
  const vadFinal = [...L.wstatus].reverse().find((x) => x.type === "vad-status")?.status ?? null;
  // first position
  const firstPos = st.find((s) => s.u != null);
  const domVals = [];
  for (let i = 0; i < L.dom.length; i += 3) domVals.push({ a: L.dom[i], kind: L.dom[i + 1], v: L.dom[i + 2] });
  // DOM: value + state timeline
  let curV = null, curS = null;
  const domTL = [];
  for (const d of domVals) {
    if (d.kind === 1) curV = d.v === "" || d.v == null ? null : Number(d.v); else curS = d.v;
    domTL.push({ a: d.a, v: curV, s: curS });
  }
  const DRAWN = new Set(["live", "holding", "settling"]);
  const firstDom = domTL.find((d) => d.v != null && d.s === "live");
  const tClick = J.tClick;
  // main lateness
  const lag = [];
  for (let i = 0; i < L.lag.length; i += 4) lag.push({ sec: L.lag[i], max: L.lag[i + 1], sum: L.lag[i + 2], n: L.lag[i + 3] });
  const lagRun = lag.filter((x) => x.sec * 1000 >= tClick + 5000);
  const { ev, steady } = eventMetrics(st, w.man, domTL, wallOfFileT);
  const verdicts = {};
  for (const s of st) verdicts[s.verdict] = (verdicts[s.verdict] ?? 0) + 1;
  const audioS = st.length ? st.at(-1).ct - st[0].ct : 0;
  const ren = Object.entries(J.procCpuMsPerS).filter(([k]) => k.startsWith("renderer")).map(([, v]) => v);
  return {
    file: path.basename(file), tag: J.tag, cond: J.cond, wav: path.basename(J.wav), throttle: J.throttle, busy: J.busy, affinity: J.affinity?.mask ?? null,
    throttleAccepted: J.throttleLog.map((x) => `${x.target.split("/").pop().slice(0, 14)}:${x.ok}`).join(" "),
    rendererCpuMsPerS: r2(Math.max(0, ...ren)),
    align: { ct0: r3(ct0), r: r3(alignR) },
    audio: { capSr, chunks: chunks.length, ctGaps: gaps, lostAudioMs: r2(lostAudioMs), maxGapMs: r2(maxGapMs), audioRate: r3(audioRate), durS: r2((chunks.at(-1).ct - chunks[0].ct)) },
    dispatchLagMs: { med: r2(med(dispLag)), p90: r2(q(dispLag, 0.9)), p99: r2(q(dispLag, 0.99)), max: r2(Math.max(...dispLag)) },
    pitch: {
      msgs: P.length, lagMs: { med: r2(med(pitchLag)), p90: r2(q(pitchLag, 0.9)), p99: r2(q(pitchLag, 0.99)), max: r2(Math.max(...pitchLag)) },
      workerLagMs: { med: r2(med(pitchWorkerLag)), p99: r2(q(pitchWorkerLag, 0.99)) },
      postToMainMs: { med: r2(med(pitchPostToMain)), p90: r2(q(pitchPostToMain, 0.9)), p99: r2(q(pitchPostToMain, 0.99)), max: r2(Math.max(...pitchPostToMain)) },
      inferMs: { med: r2(med(P.filter((p) => p.inferMs >= 0).map((p) => p.inferMs))), p90: r2(q(P.filter((p) => p.inferMs >= 0).map((p) => p.inferMs), 0.9)) },
      vadMs: { med: r2(med(P.filter((p) => p.vadMs >= 0).map((p) => p.vadMs))), p90: r2(q(P.filter((p) => p.vadMs >= 0).map((p) => p.vadMs), 0.9)) },
      voicedPct: r2(100 * P.filter((p) => p.voiced).length / P.length),
      vadDecidedPct: r2(100 * vadSeen.length / P.length),
      hiddenOfVoicedPct: r2(100 * P.filter((p) => p.voiced && p.vad === 0).length / Math.max(1, P.filter((p) => p.voiced).length)),
      vadSlow, vadFinal,
    },
    states: {
      posts: st.length, postsPerAudioS: r3(st.length / audioS),
      lagChunkMs: { med: r2(med(st.map((s) => s.lagChunk))), p90: r2(q(st.map((s) => s.lagChunk), 0.9)), p99: r2(q(st.map((s) => s.lagChunk), 0.99)), max: r2(Math.max(...st.map((s) => s.lagChunk))) },
      lagContentMs: { med: r2(med(st.map((s) => s.lagContent))), p90: r2(q(st.map((s) => s.lagContent), 0.9)), p99: r2(q(st.map((s) => s.lagContent), 0.99)), max: r2(Math.max(...st.map((s) => s.lagContent ?? 0))) },
      hintLagChunks: { med: r2(med(st.map((s) => s.hintLagS / 0.025))), p90: r2(q(st.map((s) => s.hintLagS / 0.025), 0.9)), p99: r2(q(st.map((s) => s.hintLagS / 0.025), 0.99)), max: r2(Math.max(...st.map((s) => s.hintLagS / 0.025))) },
      workerQueueMs: { med: r2(med(st.map((s) => s.wq))), p99: r2(q(st.map((s) => s.wq), 0.99)) },
      workerProcMs: { med: r2(med(st.map((s) => s.wproc))), p99: r2(q(st.map((s) => s.wproc), 0.99)) },
      postToMainMs: { med: r2(med(st.map((s) => s.p2m))), p90: r2(q(st.map((s) => s.p2m), 0.9)), p99: r2(q(st.map((s) => s.p2m), 0.99)), max: r2(Math.max(...st.map((s) => s.p2m))) },
      verdicts,
    },
    resonance: {
      framesDropped: last.framesDropped ?? null, gridForcedUnvoiced: perf.gridForcedUnvoiced ?? null, binsAdmitted: perf.binsAdmitted ?? null, binsDropped: perf.binsDropped ?? null,
      msPerAudioSmean: r2(perf.meanMsPerAudioS), msPerAudioSpeak: r2(Math.max(0, ...st.map((s) => s.perf?.msPerAudioS ?? 0))), overloads, nbOnPosts: st.filter((s) => s.nbOn).length,
    },
    first: {
      posWallS: firstPos ? r2((firstPos.a - tClick) / 1000) : null, posAudioS: firstPos ? r2(firstPos.ct - chunks[0].ct) : null,
      domLiveWallS: firstDom ? r2((firstDom.a - tClick) / 1000) : null,
    },
    domUpdates: { n: domTL.filter((d) => d.v != null).length, perS: r2(domVals.filter((d) => d.kind === 1).length / audioS) },
    mainLatenessMs: { meanSumPerS: r2(med(lagRun.map((x) => x.sum))), p90Max: r2(q(lagRun.map((x) => x.max), 0.9)), max: r2(Math.max(0, ...lagRun.map((x) => x.max))) },
    statuses: [...new Set(statuses)].join(","),
    events: ev, steady,
    _st: st.map((s) => [r3(s.ft), s.u == null ? null : +s.u.toFixed(4), s.verdict, r2(s.a), r3(s.ct), w.man.blocks.find((b) => s.ft >= b.t0 && s.ft < b.t0 + 54)?.sex ?? null]),
    _dom: domTL.map((d) => [r2(d.a), d.v, d.s]),
    _wallOf0: wallOfFileT(0),
  };
}

export function pair(a, b) {
  // u trajectory: for each a-post find the b-post with the nearest file time (≤ 0.1 s)
  const bs = b._st.filter((x) => x[1] != null);
  let j = 0;
  const du = [], duS = { m: [], f: [] }, sgn = { m: [], f: [] };
  for (const x of a._st) {
    if (x[1] == null) continue;
    while (j + 1 < bs.length && Math.abs(bs[j + 1][0] - x[0]) <= Math.abs(bs[j][0] - x[0])) j++;
    if (bs[j] && Math.abs(bs[j][0] - x[0]) <= 0.1) { const d = Math.abs(x[1] - bs[j][1]); du.push(d); if (duS[x[5]]) { duS[x[5]].push(d); sgn[x[5]].push(x[1] - bs[j][1]); } }
  }
  const dstat = (a) => ({ n: a.length, med: r3(med(a)), p95: r3(q(a, 0.95)), max: r3(Math.max(0, ...a)), fracGt005: r3(a.filter((x) => x > 0.05).length / Math.max(1, a.length)) });
  const ea = a.events, eb = b.events;
  const pe = ea.map((e, i) => ({ e, f: eb[i] }));
  const longs = pe.filter((x) => x.e.kind === "long");
  const excs = pe.filter((x) => x.e.kind === "exc");
  const d = (k) => longs.map((x) => (x.e[k] != null && x.f[k] != null ? x.e[k] - x.f[k] : null));
  return {
    du: dstat(du), duSex: { m: dstat(duS.m), f: dstat(duS.f) }, bias: { m: r3(med(sgn.m)), f: r3(med(sgn.f)) },
    dT50: { med: r2(med(d("t50"))), max: r2(Math.max(...d("t50").filter((x) => x != null).map(Math.abs))) },
    dT50Wall: { med: r2(med(d("t50Wall"))) }, dT90Wall: { med: r2(med(d("t90Wall"))) }, dT50Dom: { med: r2(med(d("t50Dom"))) },
    peakRatio: Object.fromEntries(["m", "f"].map((sex) => [sex, r3(med(excs.filter((x) => x.e.sex === sex && x.f.peak > 0).map((x) => x.e.peak / x.f.peak)))])),
    peakDomRatio: Object.fromEntries(["m", "f"].map((sex) => [sex, r3(med(excs.filter((x) => x.e.sex === sex && x.f.peakDom > 0).map((x) => x.e.peakDom / x.f.peakDom)))])),
  };
}

const MAIN = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const res = MAIN ? runs.map((f) => analyze(f)) : [];
const base = MAIN && basePath ? analyze(basePath) : null;
for (const r of res) {
  if (base) r.vsBase = pair(r, base);
  if (!QUIET) {
    const { _st, _dom, events, steady, ...rest } = r;
    console.log(JSON.stringify(rest, null, 1));
    console.log("events:");
    for (const e of events) console.log(`  ${e.sex} ${e.reader} ${e.block} ${e.kind} ${e.dir}${e.dur ? ` ${e.dur}s` : ""} @${e.ts}: pre ${r2(e.pre)} ${e.kind === "long" ? `size ${r2(e.size)} T50 ${r2(e.t50)}/${r2(e.t50Wall)}/${r2(e.t50Dom)} T90 ${r2(e.t90)}/${r2(e.t90Wall)}/${r2(e.t90Dom)}` : `peak ${r2(e.peak)} (t ${r2(e.tPeak)}) dom ${r2(e.peakDom)}`}`);
  }
}
if (MAIN && arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify({ runs: res.map(({ _st, _dom, ...x }) => x), base: base ? (({ _st, _dom, ...x }) => x)(base) : null }, null, 1));
