// sbs-validate-checks.mjs — the checks of sbs-validate.mjs's analyze stage
// (see that file). Pure analysis of recorded validation runs, plus a check of
// the session's terminal-input helper with a fake TTY.
import { readFileSync, existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import path from "node:path";
import { analyze, loadSound, runPredict, devWallOfPc, alignDevice, displayRegime, regimeOf } from "./sbs-analyze.mjs";
import { loadDevice } from "./sbs-load.mjs";
import { crossOffset } from "./sbs-align.mjs";
import { protocolSteps, makeInput } from "./sbs-session.mjs";
import { pidAlive } from "./sbs-device.mjs";
import { welch, thirdOctPowers, THIRD_OCT, db } from "./sbs-dsp.mjs";
import { replayDevice, chainCheck } from "./sbs-replay.mjs";

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Expected band ratio (dB) of the FIR copy over the plain sound, measured exactly as the analysis measures (same spans / frames). */
function expectedFir(S, SF) {
  const m = S.man;
  const span = (y, a, b) => y.subarray(Math.round(a * m.sr), Math.round(b * m.sr));
  const one = (a, b) => { const P = thirdOctPowers(welch(span(S.y, a, b), m.sr, 0, Math.round((b - a) * m.sr), 8192)), Q = thirdOctPowers(welch(span(SF.y, a, b), m.sr, 0, Math.round((b - a) * m.sr), 8192)); return THIRD_OCT.map((_, i) => db(Q[i] / P[i])); };
  return { pink: one(m.pink[0] + 0.5, m.pink[1] - 0.5), sweep: one(m.sweep.s + 0.05, m.sweep.e - 0.05) };
}

/** The cued steps' PC times -> device page wall (clock sync) -> audio clock -> file time: file time - PC time must stay constant over the run. */
export function stepMappingSpread(D, occ, steps) {
  const w = devWallOfPc(D.clock);
  const seg = occ.seg;
  const d = steps.filter((s) => s.pc1 && s.pc1 - s.pc0 > 500).map((s) => occ.ctToFile(seg.ctOfWall(w(s.pc0))) * 1000 - s.pc0);
  return d.length ? { n: d.length, spreadMs: Math.max(...d) - Math.min(...d) } : null;
}

/** The readers' quiet pauses on one device (digital silence between words; floor far below -50 dBFS): the display classification. */
async function readerPauses(D, S) {
  const occ = (await alignDevice(D, S))[0];
  if (!occ) return null;
  const ranges = S.man.readers.map((r) => [occ.seg.wallOfCt(occ.fileToCt(r.t0 + 2)), occ.seg.wallOfCt(occ.fileToCt(r.t1 - 1))]);
  return displayRegime(D, { ranges });
}

/** The terminal-input helper with a fake TTY: Ctrl+C reaches the interrupt handler (not a silent close), and a pending question rejects when the input ends. */
async function inputChecks() {
  const mk = () => { const i = new PassThrough(); i.isTTY = true; i.setRawMode = () => i; const o = new PassThrough(); o.isTTY = true; o.columns = 80; o.resume(); return { i, o }; };
  const res = {};
  {
    const { i, o } = mk();
    let why = null;
    const inp = makeInput({ input: i, output: o, onInterrupt: (w) => { why = w; } });
    const q = inp.ask("? ").then(() => "answered", (e) => `rejected: ${e.message}`);
    i.write("\x03");
    await new Promise((r) => setTimeout(r, 50));
    res.ctrlC = why;
    res.closedAfterCtrlC = inp.closed;
    inp.close();
    res.pendingAfterClose = await q;
  }
  {
    const { i, o } = mk();
    const inp = makeInput({ input: i, output: o, onInterrupt: () => {} });
    const q = inp.ask("? ").then(() => "answered", (e) => `rejected: ${e.message}`);
    i.end();
    res.pendingAfterEnd = await q;
  }
  return res;
}

export async function analyzeValidation({ v0, v1, v2, v3 = null, v4 = null, v5 = null, v6 = null, noisyFloorDb = -44, knownFirDb, firPath, soundPath, soundFirPath, nullVariant = null, predictOnly = [], predict = true, shards = 2 }) {
  const checks = [];
  const add = (name, value, pass, detail = null) => checks.push({ name, value, pass, detail });
  const S = loadSound(soundPath), SF = loadSound(soundFirPath);
  const rec = {};

  // ---- V0: the cued protocol (time-scaled)
  if (v0) {
    const s0 = readJson(path.join(v0, "session.json"));
    const want = protocolSteps("full", { dongle: true }).map((s) => s.name), got = s0.steps.map((s) => s.name);
    const ordered = s0.steps.every((s, i) => s.pc1 >= s.pc0 && (i === 0 || s.pc0 >= s0.steps[i - 1].pc0));
    add("V0 cued protocol (x0.02 time): every step logged, in order, with PC times", `${got.length}/${want.length} steps`, JSON.stringify(got) === JSON.stringify(want) && ordered);
    const d0 = loadDevice(path.join(v0, "desktop"));
    add("V0 device logged during the protocol", `${d0.rows.chunk.length} chunks, ${d0.rows.state.length} posts`, d0.rows.chunk.length > 100 && d0.rows.state.length > 10);
  }

  // ---- V1: identical inputs ("phone" = the dry-run phone path on a spawned Chrome, "desktop" = a spawned Chrome)
  let R1 = null;
  if (v1) {
    const s1 = readJson(path.join(v1, "session.json"));
    R1 = await analyze({ devA: path.join(v1, "phone"), devB: path.join(v1, "desktop"), session: s1, soundPath, out: path.join(v1, "analysis"), hook: true });
    const m1 = readJson(path.join(v1, "phone", "meta.json"));
    add("V1 phone code path ran (dry-run: no adb, CDP on a spawned Chrome)", `${m1.kind}, ${m1.stats?.chunks} chunks, ${m1.stats?.pulls} pulls, ${m1.stats?.errors} pull errors`, m1.kind === "phone-dry" && m1.stats?.chunks > 5000 && m1.stats?.errors === 0);
    for (const k of ["A", "B"]) {
      const pv = R1.display[`postsVsDom${k}`];
      add(`V1 ${k === "A" ? "phone" : "desktop"}: logged resonance posts = what the strip showed (each data-value change = one of the latest posts' u)`, `${pv.equal}/${pv.checked}`, pv.checked > 100 && pv.mismatch === 0);
    }
    for (const [k, occ] of [["phone", R1.sound.occurrencesA], ["desktop", R1.sound.occurrencesB]]) {
      const o = occ?.[0];
      add(`V1 ${k}: test sound found, sample-exact click-train refine`, o ? `r ${o.coarseR} coarse, click r ${o.pcmR?.join(" / ")}, ${o.method}` : "not found", !!o && o.method === "pcm-clicks");
      add(`V1 ${k}: alignment from the chunk envelope alone vs the PCM click trains (<= 25 ms)`, o ? `${o.envVsFinalMs} ms (mid-sound); clock ratio ${o.ppm} ppm` : "—", !!o && Math.abs(o.envVsFinalMs) <= 25);
    }
    // device-to-device offset from the two envelopes (no source) vs the PCM-exact one
    const A = loadDevice(path.join(v1, "phone")), B = loadDevice(path.join(v1, "desktop"));
    const xo = crossOffset(A.segments[0], B.segments[0]);
    const truth = R1.sound.occurrencesA[0].ct0 - R1.sound.occurrencesB[0].ct0;
    add("V1 device-to-device alignment from the envelopes alone vs PCM-exact (<= 25 ms)", `${((xo.offset - truth) * 1000).toFixed(2)} ms (r ${xo.r.toFixed(3)})`, Math.abs(xo.offset - truth) <= 0.025);
    const rr = R1.response.relativeRaw;
    for (const k of ["pink", "sweep", "speech"]) {
      const v = rr[k].filter((x) => x.ok).map((x) => Math.abs(x.db));
      add(`V1 identical inputs: ${k} transfer function flat within +-0.5 dB (200 Hz – 8 kHz, ${v.length} bands)`, `max |dB| ${Math.max(...v).toFixed(2)}`, v.length >= 15 && Math.max(...v) <= 0.5);
    }
    const C = R1.sound.compare;
    add("V1 identical inputs (bit-identical fake-mic streams): shown u on the same sound", `bias ${C.bias} u, swing ${C.swingLong}, short ${C.swingShort}`, Math.abs(C.bias) <= 0.02 && Math.abs(C.swingLong - 1) <= 0.05);
    const cs = (d) => { const c = d.clock; return c.map((x) => `${x.label} ${x.offset.toFixed(2)} ms (rtt ${x.rtt.toFixed(2)})`).join(", "); };
    add("V1 clock sync (min round trip, start / end)", `phone: ${cs(A)}; desktop: ${cs(B)}`, A.clock.length >= 2 && B.clock.length >= 2 && A.clock.every((x) => x.rtt < 20));
    const hk = R1.hook?.b;
    const dB = R1.display.b;
    add("V1 hook replay (real hook) onset blinks vs the strip's own (DOM) count", hk?.idle ? `${hk.idle.onset.perMin} / min vs ${dB.onsetBlinksPerMin} / min` : JSON.stringify(hk), !!hk?.idle && Math.abs(hk.idle.onset.perMin - dB.onsetBlinksPerMin) <= 1.5);
    for (const [k, pr] of [["phone", R1.sound.probeA], ["desktop", R1.sound.probeB]]) add(`V1 ${k}: probe pauses (digital silence): thumb never gone INSIDE a pause (only at the onset)`, pr ? pr.map((x) => `${x.durS}s:${x.inside ? "IN" : ""}${x.onset ? "onset" : ""}`).join(" ") : "—", !!pr && pr.every((x) => !x.inside));
    for (const [k, D] of [["phone", A], ["desktop", B]]) {
      const dr = await readerPauses(D, S);
      const p = dr?.pauses;
      add(`V1 ${k}: the readers' quiet pauses (floor ${dr?.floor?.median} dBFS): none counted as a dropout INSIDE the pause (onset blinks only)`,
        p ? `inside ${p.short.goneInsidePct}% of ${p.short.n} short, ${p.mid.goneInsidePct}% of ${p.mid.n} 1–5 s, ${p.judged.goneInsidePct}% of ${p.judged.n} judged (1.5–5 s); at the onset ${p.short.goneAtOnsetPct}% / ${p.mid.goneAtOnsetPct}%` : "—",
        !!p && p.short.n + p.mid.n > 10 && [p.short, p.mid, p.judged].every((c) => !c.n || c.goneInsidePct === 0));
    }
    rec.R1 = { verdict: R1.verdict, sound: R1.sound.compare, health: R1.health };
  }

  // ---- V2: a known FIR on one device (the FIR copy of the sound) vs V1's desktop
  if (v2 && v1) {
    const R2 = await analyze({ devA: path.join(v2, "desktop"), devB: path.join(v1, "desktop"), nameA: "fir", nameB: "plain", soundPath, out: path.join(v2, "analysis"), predict, predictOnly, shards, noise: true });
    const exp = expectedFir(S, SF);
    const r2raw = R2.response.relativeRaw;
    for (const k of ["pink", "sweep"]) {
      const errs = r2raw[k].map((x, i) => (x.ok ? Math.abs(x.db - exp[k][i]) : null)).filter((x) => x != null);
      add(`V2 known FIR recovered from ${k} (vs the FIR's effect on the same source spans, <= 1 dB)`, `max err ${Math.max(...errs).toFixed(2)} dB over ${errs.length} bands`, errs.length >= 15 && Math.max(...errs) <= 1);
    }
    {
      const errs = r2raw.speech.map((x, i) => (x.ok ? Math.abs(x.db - knownFirDb[THIRD_OCT[i]]) : null)).filter((x) => x != null);
      add("V2 known FIR recovered from speech (vs the FIR's nominal band gains, <= 1 dB)", `max err ${Math.max(...errs).toFixed(2)} dB over ${errs.length} bands`, errs.length >= 15 && Math.max(...errs) <= 1);
      const nom = r2raw[R2.response.relative.use].map((x, i) => `${THIRD_OCT[i]}:${x.db}`).join(" ");
      add("V2 recovered response (dB, the estimate the FIR is built from)", nom, true, { nominal: knownFirDb });
    }
    if (predict && R2.predict?.summary) {
      const known = runPredict(firPath, "validate-known-fir", { only: predictOnly, shards });
      const a = R2.predict.summary.all, b = known.summary.all;
      add(`V2 prediction on ${predictOnly.length || 12} public readers: recovered FIR vs the known FIR`,
        `bias ${a.bias} vs ${b.bias} u, sensitivity ${a.sens} vs ${b.sens}, 3/5/8 s excursions ${a.exc3}/${a.exc5}/${a.exc8} vs ${b.exc3}/${b.exc5}/${b.exc8}`,
        Math.abs(a.bias - b.bias) <= 0.03 && Math.abs(a.sens - b.sens) <= 0.05, { recovered: R2.predict.summary, known: known.summary, chainFilesDiffer: R2.predict.chainFilesDifferFromOriginMain });
      add("V2 (a) is decided on the prediction: the known FIR (+6 dB at 2.5 kHz) reads darker -> \"device\"", `${R2.decisionA.rule} (bias ${R2.decisionA.bias} u, sens ${R2.decisionA.sens})`, R2.decisionA.rule === "device");
    }
    const X = R2.crossCheck;
    add("V2 cross-check (positive control): the meter's same-sound difference = the plain capture through the recovered response, replayed (inside the band)",
      X ? `meter ${X.bias} u / swing ${X.swing}; expected ${X.expBias} u / swing ${X.expSwing}; band ±${X.bandBiasCc} u / ±${X.bandSwingCc}` : "—", !!X && X.biasConsistent === true && X.swingConsistent === true, X);
    add("V2 negative control: the same difference is NOT inside the null band (the band can see a 0.36 u effect)", X ? `|${X.bias}| vs ±${X.bandBias}` : "—", !!X && Math.abs(X.bias) > X.bandBias);
    rec.R2 = { response: R2.response.relative, predict: R2.predict?.summary ?? null, decisionA: R2.decisionA, crossCheck: X };
  }

  // ---- replays of V1's desktop capture
  if (v1) {
    const D = loadDevice(path.join(v1, "desktop"));
    const n1 = await replayDevice(D, { hints: "node" });
    add("Replay of the logged PCM through the REAL workers in Node (pitch + FireRedVAD + resonance), |du| median <= 0.02", `median ${n1.du.median?.toExponential(2)}, p95 ${r3(n1.du.p95)}, max ${r3(n1.du.max)}, > 0.05 u on ${r3(100 * n1.du.over005)} % of posts; ${n1.matchedSameChunk}/${n1.live} posts on the same chunk, null mismatches ${n1.nullMismatch}`, n1.du.median <= 0.02 && n1.nullMismatch === 0);
    const l1 = await replayDevice(D, { hints: "live" });
    add("Replay with the device's own logged pitch hints (resonance worker only), |du| max", `max ${l1.du.max?.toExponential(2)} over ${l1.du.n} posts`, l1.du.max <= 1e-6);
    const ch = await chainCheck(D, n1.seg, { tag: "validate-v1desk" });
    add("chain.mjs (48 kHz runner) on the capture resampled from 44.1 kHz (reported: the rate conversion is in it); its temp copy deleted", `median ${r3(ch.median)}, p95 ${r3(ch.p95)} over ${ch.n} posts; replay-tmp left: ${existsSync(path.join(v1, "replay-tmp", "desktop-validate-v1desk"))}`, !existsSync(path.join(v1, "replay-tmp", "desktop-validate-v1desk")), ch);
  }

  // ---- V3: the "voice" protocol (time-scaled 0.5) with both stand-ins: the own-voice analysis end to end
  if (v3 && existsSync(path.join(v3, "session.json"))) {
    const s3 = readJson(path.join(v3, "session.json"));
    const R3 = await analyze({ devA: path.join(v3, "phone"), devB: path.join(v3, "desktop"), session: s3, soundPath, out: path.join(v3, "analysis"), hook: true });
    const ov = R3.ownVoice;
    add("V3 own-voice analysis ran: hold / try swings, per-step medians, cued silences, SNR, claps (identical inputs)",
      `holds ${ov?.holdSwingA} / ${ov?.holdSwingB} u, tries ${ov?.tryPeakA} / ${ov?.tryPeakB} u, steps ${ov?.steps?.length}, silences ${R3.silences?.a?.length}/4, SNR ${R3.snr?.a?.snrDb} / ${R3.snr?.b?.snrDb} dB, claps ${R3.claps?.claps?.pairs ?? 0} pairs`,
      ov?.holdSwingA != null && ov?.holdSwingB != null && ov.steps.length >= 15 && R3.silences?.a?.length === 4 && R3.display.fromSteps);
    const D3a = loadDevice(path.join(v3, "phone")), D3b = loadDevice(path.join(v3, "desktop"));
    for (const [n, D] of [["phone", D3a], ["desktop", D3b]]) {
      const occ = (await alignDevice(D, S))[0];
      const sp = occ ? stepMappingSpread(D, occ, s3.steps) : null;
      add(`V3 ${n}: cued steps PC clock -> device clock -> audio clock -> file time, constant over the run (<= 25 ms)`, sp ? `spread ${sp.spreadMs.toFixed(1)} ms over ${sp.n} steps` : "—", !!sp && sp.spreadMs <= 25);
    }
    const m3 = readJson(path.join(v3, "phone", "meta.json"));
    const pre = existsSync(path.join(path.dirname(path.dirname(v3)), "v3-preopened-tab.json")) ? readJson(path.join(path.dirname(path.dirname(v3)), "v3-preopened-tab.json")).id : null;
    add("V3 phone path with a Syrinx tab already open: picks the tab its intent opened, closes the other one", `pre-opened ${pre?.slice(0, 8)}, chosen ${m3.info?.targetId?.slice(0, 8)}, closed [${(m3.info?.closedTabs ?? []).map((x) => x.slice(0, 8)).join(", ")}]`,
      !!pre && m3.info?.targetId !== pre && (m3.info?.closedTabs ?? []).includes(pre));
  }

  // ---- V4: the null — the same sound, another chunk phase and level
  if (v4 && existsSync(path.join(v4, "session.json"))) {
    const s4 = readJson(path.join(v4, "session.json"));
    const R4 = await analyze({ devA: path.join(v4, "phone"), devB: path.join(v4, "desktop"), session: s4, soundPath, out: path.join(v4, "analysis"), predict, predictOnly, shards, noise: true, replay: true });
    const oa = R4.sound.occurrencesA?.[0], ob = R4.sound.occurrencesB?.[0];
    add(`V4 null (the phone stand-in's copy ${nullVariant?.offsetS} s later, ${nullVariant?.gainDb} dB): both found, sample-exact`, `${oa?.method} / ${ob?.method}, offset ${oa && ob ? r3(oa.ct0 - ob.ct0) : "?"} s`, oa?.method === "pcm-clicks" && ob?.method === "pcm-clicks");
    const rel = R4.response.relative, raw = R4.response.relativeRaw;
    const flat = ["pink", "sweep", "speech"].map((k) => [k, Math.max(...rel[k].filter((x) => x.ok).map((x) => Math.abs(x.db)))]);
    add("V4 null: response flat within +-0.5 dB re 1 kHz (pink, sweep, speech)", flat.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "), flat.every(([, v]) => v <= 0.5));
    const lvl = raw.speech.find((x) => x.fc === 1000)?.db;
    add("V4 null: the level difference recovered (speech, 1 kHz band; within 0.5 dB)", `${lvl} dB vs ${nullVariant?.gainDb}`, lvl != null && Math.abs(lvl - nullVariant.gainDb) <= 0.5);
    if (predict) add("V4 null: (a) decided on the prediction = \"not-device\"", `${R4.decisionA.rule} (bias ${R4.decisionA.bias} u, sens ${R4.decisionA.sens})`, R4.decisionA.rule === "not-device");
    const X = R4.crossCheck;
    add("V4 null: the meter's same-sound bias inside the noise band the verdict uses", X ? `${X.bias} u (per reader ${R4.sound.compare.biasPerReader.join(" / ")}) vs ±${X.bandBias}` : "—", !!X && X.nullBiasConsistent === true, X);
    add("V4 null: the meter's same-sound swing inside the noise band (|swing - 1|)", X ? `${X.swing} vs 1 ± ${X.bandSwing}` : "—", !!X && X.nullSwingConsistent === true);
    add("V4 null: cross-check consistent with the like-for-like expectation", X ? `meter ${X.bias} u / ${X.swing}; expected ${X.expBias} u / ${X.expSwing}` : "—", !!X && X.biasConsistent === true && X.swingConsistent === true);
    const D4a = loadDevice(path.join(v4, "phone")), D4b = loadDevice(path.join(v4, "desktop"));
    for (const [k, D, pr] of [["phone", D4a, R4.sound.probeA], ["desktop", D4b, R4.sound.probeB]]) {
      const dr = await readerPauses(D, S);
      const p = dr?.pauses;
      add(`V4 ${k}: no quiet pause (reading pauses, probe gaps) counted as a dropout INSIDE the pause`,
        p ? `reading: inside ${p.short.goneInsidePct}% of ${p.short.n} short, ${p.mid.goneInsidePct}% of ${p.mid.n} 1–5 s; probe: ${pr?.filter((x) => x.inside).length}/${pr?.length}` : "—",
        !!p && [p.short, p.mid, p.judged].every((c) => !c.n || c.goneInsidePct === 0) && !!pr && pr.every((x) => !x.inside));
    }
    // the reconnect (the desktop's socket dropped once at 60 s)
    const m4 = readJson(path.join(v4, "desktop", "meta.json"));
    const h4 = R4.health.b;
    const idx = D4b.pcm?.idx ?? [];
    let gaps = 0;
    for (let i = 1; i < idx.length; i++) if (idx[i].ct - idx[i - 1].ct > 1.5 * (idx[i].len / (D4b.segments[0].sr || 44100))) gaps++;
    add("V4 desktop: CDP socket dropped at 60 s -> the recorder reconnected and nothing was lost (no capture or PCM gap, no queue drops)",
      `reconnects ${m4.stats?.reconnects}, outages ${(m4.stats?.outages ?? []).map((o) => `${((o.to - o.from) / 1000).toFixed(1)} s`).join(", ")}, capture holes ${h4.segments.map((s) => s.holes).join("/")}, PCM gaps ${gaps}, PCM dropped ${D4b.pcmDropped ?? 0}, queue drops ${JSON.stringify(D4b.drops)}`,
      m4.stats?.reconnects >= 1 && h4.segments.every((s) => s.holes === 0) && gaps === 0 && !(D4b.pcmDropped > 0) && Object.values(D4b.drops ?? {}).every((v) => !v));
    rec.R4 = { decisionA: R4.decisionA, crossCheck: X, verdict: R4.verdict.text };
  }

  // ---- V5: terminal input closed at once (not --auto): the clean shutdown
  if (v5 && existsSync(path.join(v5, "session.json"))) {
    const s5 = readJson(path.join(v5, "session.json"));
    const m5 = existsSync(path.join(v5, "desktop", "meta.json")) ? readJson(path.join(v5, "desktop", "meta.json")) : {};
    const ex = existsSync(path.join(path.dirname(path.dirname(v5)), "v5-exit.json")) ? readJson(path.join(path.dirname(path.dirname(v5)), "v5-exit.json")).code : null;
    add("V5 terminal input closed: stopped through the clean shutdown (end clock sync, meta stats, session ended, Chrome gone, exit 1)",
      `exit ${ex}, stoppedBy "${s5.stoppedBy}", ended ${!!s5.ended}, meta stats ${!!m5.stats}, end clock sync ${loadDevice(path.join(v5, "desktop")).clock.some((c) => c.label === "end")}, Chrome pid ${m5.info?.pid} alive ${m5.info?.pid ? pidAlive(m5.info.pid) : "?"}`,
      ex === 1 && /terminal input closed/.test(s5.stoppedBy ?? "") && !!s5.ended && !!m5.stats && !(m5.info?.pid && pidAlive(m5.info.pid)));
  }
  // ---- V6: the positive control of the pause classification (a steady pink floor in every pause)
  if (v6 && existsSync(path.join(v6, "desktop", "log.jsonl"))) {
    const R6 = await analyze({ devA: path.join(v6, "desktop"), devB: null, nameA: "noisy", soundPath, out: path.join(v6, "analysis") });
    const pr = R6.sound.probeA ?? [];
    const long = pr.filter((x) => x.durS >= 2.5);
    const fl = pr.map((x) => x.floorDb).filter((x) => x != null).sort((a, b) => a - b)[Math.floor(pr.length / 2)];
    const rg = regimeOf(fl, null);
    add(`V6 positive control (pink floor ${noisyFloorDb} dBFS in every pause): the probe's >= 2.5 s gaps show the thumb gone INSIDE the pause, ~0.8–1.3 s after the last voiced frame; the floor reads "dropout"`,
      `${long.map((x) => `${x.durS}s:${x.inside ? `IN@${x.insideAfterMs}ms` : "-"}${x.onset ? "+onset" : ""}`).join(" ")}; floor ${fl} dBFS -> ${rg.byFloor}`,
      long.length >= 3 && long.every((x) => x.inside && x.insideAfterMs >= 500 && x.insideAfterMs <= 1600) && rg.byFloor === "dropout");
    const dr = await readerPauses(loadDevice(path.join(v6, "desktop")), S);
    const j = dr?.pauses?.judged;
    add("V6 the readers' 1.5–5 s pauses over the same floor (reported)", j ? `inside ${j.goneInsidePct}% of ${j.n}, a median ${j.insideAfterMsMedian} ms after the last voiced frame; floor ${dr.floor.median} dBFS` : "—", true);
  }
  // ---- the input helper (Ctrl+C with a TTY in raw mode)
  {
    const r = await inputChecks();
    add("Terminal input: Ctrl+C on a TTY (readline raw mode) reaches the stop handler; a pending question rejects on close / end of input",
      JSON.stringify(r), r.ctrlC === "Ctrl+C" && r.closedAfterCtrlC === false && /rejected/.test(r.pendingAfterClose) && /rejected/.test(r.pendingAfterEnd));
  }
  const pass = checks.filter((c) => !c.pass).length === 0;
  const text = [`validation: ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`, ...checks.map((c) => `${c.pass ? "PASS" : "FAIL"}  ${c.name}: ${c.value}`)].join("\n");
  return { pass, checks, text, ...rec };
}
