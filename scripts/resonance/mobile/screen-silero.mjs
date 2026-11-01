// screen-silero.mjs — the pre-registered noise screen (F5) of the narrower
// resonance-row hold round: measurements/resonance-row-hold-narrow-2026-11-01.md
// §6. It sorts each real-noise clip into "speech-free" or "talker" with a
// detector independent of the app's own voice gate (FireRedVAD) plus the
// clip's source metadata. The guards are then reported per class (§9).
//
//   node scripts/resonance/mobile/screen-silero.mjs --set=dev|fresh
//        [--list=<clip list json>] [--root=<folder holding clips/<id>.wav>]
//        [--model=C:/Coding Projects/Syrinx-cache/models/silero/silero_vad.onnx]
//        [--out=scripts/resonance/mobile/narrow-screen.json] [--replace]
//        [--only=<id,id,...>]   (prints only; never writes --out)
//
// Defaults per set: dev = scripts/resonance/mobile/hold-noise-list.json with
// clips under C:/Coding Projects/Syrinx-cache/noise-real; fresh =
// scripts/resonance/mobile/narrow-noise-list.json with clips under
// C:/Coding Projects/Syrinx-cache/noise-real-narrow. Clip i is read from
// <root>/clips/<id>.wav (as hold-noise-run.mjs).
//
// What runs (plan §6, fixed before any result):
//   - Model: Silero VAD v6.2.3, the repo's speech-detector model, from the
//     pinned SPEECH_DETECTOR.modelUrl, checked against modelSha256 and kept in
//     --model's folder (downloaded once when missing).
//   - Offline through scripts/heard-as/chain.mjs loadSpeechDetector:
//     onnxruntime-web WASM, 1 thread, createSpeechFramer + createSileroRunner,
//     a fresh framer + LSTM state per clip.
//   - Input: the clip's L2 cold-start stream — hold-noise-run.mjs
//     clipPert(clip, -40) applied to 60 s of zeros at 48 kHz, exactly as the
//     cold-start runs build it — fed in 1200-sample chunks through the app's
//     createStreamingResampler (48 -> 16 kHz, a fresh one per clip), each
//     chunk's 16 kHz samples pushed into the framer with the chunk's end time,
//     as the gender worker's handleChunk does.
//   - Frame rule: speech when p >= 0.5 (one probability per 32 ms frame).
//   - Speech runs: maximal runs of >= 8 consecutive speech frames (>= 256 ms);
//     S = the total length of the runs, s.
//   - Class: "talker" if S >= 1.0 s, or if the clip's metadata family is
//     talker and S >= 0.256 s (at least one run); "speech-free" otherwise.
//     Compared in whole frames (S >= 1.0 s <=> >= 32 run frames; one run <=>
//     >= 8 run frames), so no rounding can move a clip.
//   - Metadata talker: dev = the 11 DEMAND environments whose DEMAND.pdf
//     description has people in it (55 clips); fresh = the four talker
//     subclasses, the talker reserve and DEMAND OMEETING. Every other clip is
//     metadata speech-free.
//
// Output: --out gains (or, with --replace, replaces) the key sets.<set>; any
// other set already in the file is kept byte-for-byte. Per clip: id, source,
// cls, sub, metadata family, frames, speech frames (p >= 0.5), run frames, S,
// the runs ([start s, end s] on the stream clock, frame ends from the framer),
// the maximum p, the level check (the stream's DSP median, dBFS) and the class.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---- the rule's constants (plan §6) ---------------------------------------
export const SCREEN = Object.freeze({
  levelDb: -40,          // the clip's L2 cold-start stream
  streamS: 60,
  sr: 48000,
  chunk: 1200,           // capture chunk, as the gender worker receives it
  pSpeech: 0.5,          // frame rule
  minRunFrames: 8,       // >= 256 ms
  talkerFrames: 32,      // S >= 1.0 s (32 x 32 ms = 1.024 s; 31 x 32 ms = 0.992 s)
  metaTalkerFrames: 8,   // metadata talker: S >= 0.256 s = at least one run
});
const FRAME_S = 512 / 16000;

/** Dev: the DEMAND environments whose DEMAND.pdf description has people in it. */
export const DEV_TALKER_ENVS = Object.freeze(["PCAFETER", "PRESTO", "PSTATION", "SPSQUARE", "SCAFE", "TMETRO", "TBUS", "NPARK", "NFIELD", "OOFFICE", "OHALLWAY"]);
/** Fresh (plan §5.3): the talker family's subclasses, its reserve and OMEETING. */
export const FRESH_TALKER_CLS = Object.freeze(["café, restaurant, bar", "station, airport, mall", "TV or radio in the room", "people nearby", "talker reserve"]);
export const FRESH_SPEECHFREE_CLS = Object.freeze([
  "fans / PC / coil whine", "HVAC", "fridge / freezer", "mains hum / transformer / ballast",
  "washing machine / kitchen appliance", "traffic", "room and home appliances", "household machines",
  "rain, wind, water", "vehicle interior", "distant street and road", "speech-free reserve",
]);

/** The clip's metadata family: "talker" | "speech-free". */
export function metadataFamily(set, c) {
  if (set === "dev") return c.source === "demand" && DEV_TALKER_ENVS.includes(c.sub) ? "talker" : "speech-free";
  if (set !== "fresh") throw new Error(`screen: unknown set ${set}`);
  let byCls = null;
  if (c.source === "demand") byCls = c.sub === "OMEETING" ? "talker" : null;
  else if (FRESH_TALKER_CLS.includes(c.cls)) byCls = "talker";
  else if (FRESH_SPEECHFREE_CLS.includes(c.cls)) byCls = "speech-free";
  const own = c.family ?? null;   // a family the fetch script may write per clip
  if (own != null && !["talker", "speech-free"].includes(own)) throw new Error(`screen: ${c.id}: family ${own}`);
  if (byCls != null && own != null && byCls !== own) throw new Error(`screen: ${c.id}: family ${own} vs subclass ${c.cls} (${byCls})`);
  const fam = byCls ?? own;
  if (fam == null) throw new Error(`screen: ${c.id}: no metadata family (cls ${c.cls}, sub ${c.sub})`);
  return fam;
}

/** Speech runs and class from the per-frame probabilities (frame i ends at ts[i] ms). */
export function screenProbs(probs, ts, family) {
  const runs = [];
  let runFrames = 0, speechFrames = 0, maxP = 0;
  let i = 0;
  while (i < probs.length) {
    if (probs[i] > maxP) maxP = probs[i];
    if (!(probs[i] >= SCREEN.pSpeech)) { i++; continue; }
    let j = i;
    while (j < probs.length && probs[j] >= SCREEN.pSpeech) { if (probs[j] > maxP) maxP = probs[j]; j++; }
    speechFrames += j - i;
    if (j - i >= SCREEN.minRunFrames) {
      runs.push([+((ts[i] / 1000) - FRAME_S).toFixed(3), +(ts[j - 1] / 1000).toFixed(3), j - i]);
      runFrames += j - i;
    }
    i = j;
  }
  const cls = runFrames >= SCREEN.talkerFrames || (family === "talker" && runFrames >= SCREEN.metaTalkerFrames) ? "talker" : "speech-free";
  return { frames: probs.length, speechFrames, runFrames, S: +(runFrames * FRAME_S).toFixed(3), maxP: +maxP.toFixed(4), runs, class: cls };
}

async function ensureModel(modelPath, SPEECH_DETECTOR, sha256Hex) {
  if (existsSync(modelPath)) {
    const b = readFileSync(modelPath);
    if (sha256(b) === SPEECH_DETECTOR.modelSha256) return;
    throw new Error(`${modelPath}: present but not the pinned Silero model (sha256 ${sha256(b)}); remove it to re-download`);
  }
  console.log(`downloading ${SPEECH_DETECTOR.modelUrl}`);
  const r = await fetch(SPEECH_DETECTOR.modelUrl);
  if (!r.ok) throw new Error(`model download: HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  if ((await sha256Hex(ab)) !== SPEECH_DETECTOR.modelSha256) throw new Error("model download: sha256 mismatch");
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, Buffer.from(ab));
}

/** One clip through the screen. detector = loadSpeechDetector()'s factory. */
export async function screenClip(clipPath, family, detector, { clipPert, applyPert, createStreamingResampler, dspMedianDb }, ctx) {
  const pert = clipPert(clipPath, SCREEN.levelDb);
  const y0 = new Float32Array(SCREEN.streamS * SCREEN.sr);
  const { y } = await applyPert(pert, y0, SCREEN.sr, ctx);
  const { framer, run } = detector();          // fresh framer + LSTM state
  framer.reset();
  const resample = createStreamingResampler(SCREEN.sr, 16000);
  const probs = [], ts = [];
  for (let s = 0; s < y.length; s += SCREEN.chunk) {
    const e = Math.min(y.length, s + SCREEN.chunk);
    const x16 = resample(y.slice(s, e));
    for (const f of framer.push(x16, (e / SCREEN.sr) * 1000)) {
      probs.push(await run(f.input));
      ts.push(f.ts);
    }
  }
  return { ...screenProbs(probs, ts, family), levelDb: +dspMedianDb(y).toFixed(3), pertKey: JSON.stringify(pert) };
}

function countBy(rows, keyFn) {
  const o = {};
  for (const r of rows) {
    const k = keyFn(r);
    o[k] ??= { "speech-free": 0, talker: 0 };
    o[k][r.class]++;
  }
  return o;
}

/** narrow-screen.json: top-level pretty, one clip per line. */
function serialise(doc) {
  const head = { ...doc, sets: undefined };
  const lines = ["{"];
  const keys = Object.keys(head).filter((k) => k !== "sets");
  for (const k of keys) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(head[k])},`);
  lines.push(`  "sets": {`);
  const setNames = Object.keys(doc.sets);
  setNames.forEach((sn, si) => {
    const s = doc.sets[sn];
    lines.push(`    ${JSON.stringify(sn)}: {`);
    for (const k of Object.keys(s).filter((k) => k !== "clips")) lines.push(`      ${JSON.stringify(k)}: ${JSON.stringify(s[k])},`);
    lines.push(`      "clips": [`);
    s.clips.forEach((c, i) => lines.push(`        ${JSON.stringify(c)}${i < s.clips.length - 1 ? "," : ""}`));
    lines.push(`      ]`);
    lines.push(`    }${si < setNames.length - 1 ? "," : ""}`);
  });
  lines.push("  }");
  lines.push("}");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const set = arg("set", "");
  if (!["dev", "fresh"].includes(set)) throw new Error("--set=dev|fresh");
  const listPath = path.resolve(repo, arg("list", set === "dev" ? "scripts/resonance/mobile/hold-noise-list.json" : "scripts/resonance/mobile/narrow-noise-list.json"));
  const root = arg("root", set === "dev" ? "C:/Coding Projects/Syrinx-cache/noise-real" : "C:/Coding Projects/Syrinx-cache/noise-real-narrow");
  const modelPath = arg("model", "C:/Coding Projects/Syrinx-cache/models/silero/silero_vad.onnx");
  const outPath = path.resolve(repo, arg("out", "scripts/resonance/mobile/narrow-screen.json"));
  const only = arg("only", "").split(",").filter(Boolean);
  const replace = process.argv.includes("--replace");

  const { SPEECH_DETECTOR, sha256Hex } = await imp("src/ml/speech-detector.js");
  const { createStreamingResampler } = await imp("src/ml/audio-utils.js");
  const { loadSpeechDetector } = await imp("scripts/heard-as/chain.mjs");
  const { clipPert } = await import("./hold-noise-run.mjs");
  const { applyPert } = await import("./perturb.mjs");
  const { dspMedianDb } = await import("./pause-noise.mjs");

  await ensureModel(modelPath, SPEECH_DETECTOR, sha256Hex);
  const detector = await loadSpeechDetector(modelPath);

  const listBuf = readFileSync(listPath);
  let clips = JSON.parse(listBuf.toString("utf8")).clips;
  if (only.length) clips = clips.filter((c) => only.includes(c.id));
  if (set === "dev" && !only.length) {
    const n = clips.filter((c) => metadataFamily("dev", c) === "talker").length;
    if (n !== 55) throw new Error(`dev metadata talker clips: ${n}, the plan says 55`);
  }

  const t0 = Date.now();
  const rows = [];
  for (const c of clips) {
    const clipPath = path.join(root, "clips", `${c.id}.wav`);
    if (!existsSync(clipPath)) throw new Error(`missing clip ${clipPath}`);
    if (c.clipSha256 && sha256(readFileSync(clipPath)) !== c.clipSha256) throw new Error(`${clipPath}: sha256 differs from the list`);
    const family = metadataFamily(set, c);
    const ctx = { id: c.id, reader: c.id, sex: "na", kind: "ext" };   // hold-noise-run.mjs's
    const r = await screenClip(clipPath, family, detector, { clipPert, applyPert, createStreamingResampler, dspMedianDb }, ctx);
    if (Math.abs(r.levelDb - SCREEN.levelDb) > 0.01) throw new Error(`${c.id}: stream level ${r.levelDb} dBFS, not ${SCREEN.levelDb}`);
    const row = { id: c.id, source: c.source, cls: c.cls, sub: c.sub, family, frames: r.frames, speechFrames: r.speechFrames,
      runFrames: r.runFrames, S: r.S, maxP: r.maxP, levelDb: r.levelDb, runs: r.runs, class: r.class };
    rows.push(row);
    console.log(`${c.id.padEnd(28)} ${family.padEnd(11)} S ${r.S.toFixed(3).padStart(7)} s  runs ${String(r.runs.length).padStart(3)}  speech frames ${String(r.speechFrames).padStart(4)}/${r.frames}  maxP ${r.maxP.toFixed(3)}  -> ${r.class}`);
  }
  const secs = (Date.now() - t0) / 1000;
  const counts = {
    total: countBy(rows, () => "all").all,
    bySource: countBy(rows, (r) => r.source),
    byFamily: countBy(rows, (r) => r.family),
    bySourceFamily: countBy(rows, (r) => `${r.source} | ${r.family}`),
    bySubclass: countBy(rows, (r) => `${r.source} | ${r.cls} | ${r.source === "demand" ? r.sub : "*"}`),
  };
  console.log(JSON.stringify(counts, null, 1));
  console.log(`${rows.length} clips in ${secs.toFixed(1)} s`);
  if (only.length) { console.log("(--only: nothing written)"); process.exit(0); }

  const doc = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { sets: {} };
  if (doc.sets?.[set] && !replace) throw new Error(`${outPath} already has set "${set}" (--replace to redo it)`);
  doc.note = "Noise screen (F5) of measurements/resonance-row-hold-narrow-2026-11-01.md §6, made by scripts/resonance/mobile/screen-silero.mjs. Per clip: S = total length of the Silero speech runs (>= 8 consecutive frames with p >= 0.5, 32 ms frames) in the clip's L2 (-40 dBFS) cold-start stream; class talker if S >= 1.0 s, or metadata family talker and S >= 0.256 s; speech-free otherwise. runs = [start s, end s, frames].";
  doc.rule = SCREEN;
  doc.model = { url: SPEECH_DETECTOR.modelUrl, sha256: SPEECH_DETECTOR.modelSha256, runtime: "onnxruntime-web WASM, 1 thread (scripts/heard-as/chain.mjs loadSpeechDetector)" };
  doc.sets = doc.sets ?? {};
  doc.sets[set] = {
    list: path.relative(repo, listPath).replace(/\\/g, "/"),
    listSha256: sha256(listBuf),
    scriptSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    ranAt: new Date().toISOString(),
    node: process.version,
    metadataTalker: set === "dev" ? { demandEnvs: DEV_TALKER_ENVS } : { cls: FRESH_TALKER_CLS, demandEnvs: ["OMEETING"] },
    counts,
    clips: rows,
  };
  // keep any other set byte-for-byte: re-read it from the old file
  const before = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const txt = serialise(doc);
  if (before) for (const k of Object.keys(before.sets ?? {})) if (k !== set && JSON.stringify(before.sets[k]) !== JSON.stringify(JSON.parse(txt).sets[k])) throw new Error(`set ${k} would change`);
  writeFileSync(outPath, txt);
  console.log(`wrote ${path.relative(repo, outPath)} (set ${set})`);
  process.exit(0);
}
