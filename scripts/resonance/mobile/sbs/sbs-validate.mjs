// sbs-validate.mjs — checks the phone-vs-headset kit on this desktop without
// a phone: two (three) spawned Chromes play known WAVs as their fake mics,
// through the same logger / recorder / session / analysis code the real
// session uses (the phone half in its --dry-run form, its CDP part pointed at
// a spawned Chrome).
//
//   node scripts/resonance/mobile/sbs/sbs-validate.mjs [--stage=prep,record,analyze] [--out=build/resonance-mobile/sbs/validate]
//        [--runs=v0,v1,v2,v3,v4,v5] [--predict-only=dev__174,dev__84] [--no-predict] [--shards=2]
//
// prep    the app built from a clean `git archive <rev>` tree (default origin/main, the deployed source) (a work-in-progress
//         src/ in this worktree never leaks in) into build/resonance-mobile/sbs/dist;
//         the test sound (sbs-sound.mjs), a copy through a KNOWN FIR (+6 dB
//         around 2.5 kHz, -6 dB above 6 kHz), and a NULL copy (the same sound
//         1.337 s later and 5 dB quieter: another chunk phase and level, as two
//         real devices have)
// record  vite preview of that build (its own child, killed by PID); a quick
//         cue-protocol run (time-scaled); then at once:
//           V1  session: "desktop" = a spawned Chrome with the test sound,
//               "phone" = the dry-run phone path on another spawned Chrome
//               with the SAME test sound (identical inputs);
//           V2  sbs-desktop.mjs --spawn with the FIR copy
//         then at once:
//           V3  the "voice" protocol at half time with both stand-ins (the
//               own-voice analysis end to end; the step -> audio-clock
//               mapping); the stand-in already has a Syrinx tab open, which
//               the phone path must close (duplicate tabs);
//           V4  the NULL session: "desktop" = the plain sound, "phone" = the
//               null copy; the desktop's CDP socket is dropped once at 60 s
//               (SBS_TEST_DROP: the recorder must reconnect and lose nothing)
//         then V5: a non-auto session whose terminal input ends at once: it
//         must stop through the clean shutdown (meta stats, Chrome gone);
//         then V6: one device on the test sound over a steady pink floor at
//         -44 dBFS (the note's dropout regime): the positive control of the
//         pause classification
// analyze sbs-analyze.mjs on V1 (identical inputs), on V1-desktop vs V2
//         (known FIR) and on V4 (null), the PCM replays (sbs-replay.mjs, real
//         workers; and chain.mjs at 48 kHz), the FIR prediction on a reader
//         subset, and the checks: logged posts = what the strip showed;
//         alignment error <= 25 ms; identical inputs flat within +-0.5 dB; the
//         known FIR recovered within +-1 dB; the replay |du| median <= 0.02;
//         the null: flat, (a) "not-device" from the prediction, the same-sound
//         bias and swing inside the noise band the verdict uses; no quiet
//         pause counted as a dropout INSIDE the pause; the reconnect; Ctrl+C /
//         closed input through the clean shutdown.
// Every spawned process is killed by its own PID (hard rule 2).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designFir, THIRD_OCT, firGainDb, readWav, writeWav16 } from "./sbs-dsp.mjs";
import { spawnChrome, killPid, sleep } from "./sbs-device.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const stages = arg("stage", "prep,record,analyze").split(",");
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/sbs/validate"));
const SB = path.join(repo, "build/resonance-mobile/sbs");
const TREE = path.join(SB, "tree"), DIST = path.join(SB, "dist");
const SOUND = path.join(SB, "sound/sbs-test.wav"), SOUND_FIR = path.join(SB, "sound/sbs-test-fir.wav"), FIR = path.join(SB, "sound/known-fir.json");
const SOUND_NULL = path.join(SB, "sound/sbs-test-null.wav"), SOUND_NOISY = path.join(SB, "sound/sbs-test-noisy.wav");
export const NOISY_FLOOR_DB = -44;
export const NULL_VARIANT = { offsetS: 1.337, gainDb: -5 };
const RUNS = arg("runs", "v0,v1,v2,v3,v4,v5,v6").split(",");
export const KNOWN_FIR_DB = { 200: 0, 250: 0, 315: 0, 400: 0, 500: 0, 630: 0, 800: 0, 1000: 0, 1250: 0, 1600: 0, 2000: 3, 2500: 6, 3150: 4, 4000: 0, 5000: -3, 6300: -6, 8000: -6 };
mkdirSync(OUT, { recursive: true });
const run = (args, opts = {}) => { const r = spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts }); if (r.status !== 0) throw new Error(`${args.join(" ")}: ${r.stderr || r.stdout}`); return r.stdout; };

if (stages.includes("prep")) {
  // clean tree + build
  const dirty = spawnSync("git", ["status", "--porcelain", "--", "vite.config.js", "scripts/third-party-notices.mjs", "package.json"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  if (dirty) throw new Error(`build config files modified in the worktree: ${dirty}`);
  rmSync(TREE, { recursive: true, force: true });
  mkdirSync(TREE, { recursive: true });
  const REV = arg("rev", "origin/main");
  const tar = spawnSync("sh", ["-c", `git archive ${REV} src public index.html | tar -x -C "${TREE.replace(/\\/g, "/")}"`], { cwd: repo, encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`git archive: ${tar.stderr}`);
  run([path.join(repo, "node_modules/vite/bin/vite.js"), "build", path.relative(repo, TREE), "--config", "vite.config.js", "--outDir", "../dist", "--emptyOutDir"]);
  console.log(`prep: built ${path.relative(repo, DIST)} from ${REV} = ${spawnSync("git", ["rev-parse", "--short", REV], { cwd: repo, encoding: "utf8" }).stdout.trim()}`);
  // sounds
  run([path.join(here, "sbs-sound.mjs"), `--out=${SOUND}`]);
  const h = designFir(THIRD_OCT, THIRD_OCT.map((f) => KNOWN_FIR_DB[f]), 48000, 1023);
  writeFileSync(FIR, JSON.stringify(Array.from(h)));
  run([path.join(here, "sbs-sound.mjs"), `--out=${SOUND_FIR}`, `--fir=${FIR}`]);
  console.log(`prep: sounds ${path.basename(SOUND)}, ${path.basename(SOUND_FIR)}; known FIR at band centres: ${THIRD_OCT.map((f) => `${f}:${firGainDb(h, f, 48000).toFixed(1)}`).join(" ")}`);
  makeNullSound();
  await makeNoisySound();
}
/** The test sound over a steady pink floor at NOISY_FLOOR_DB (RMS): the note's dropout regime (>= ~-50 dBFS in pauses). */
async function makeNoisySound() {
  const { makeNoise } = await import("../perturb.mjs");
  const { y, sr } = readWav(SOUND);
  const nz = makeNoise("pink", y.length, 11);
  let e = 0; for (const v of nz) e += v * v;
  const g = Math.sqrt(10 ** (NOISY_FLOOR_DB / 10) / (e / nz.length));
  const z = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) z[i] = y[i] + g * nz[i];
  writeWav16(SOUND_NOISY, z, sr);
  console.log(`prep: noisy sound ${path.basename(SOUND_NOISY)} (pink floor ${NOISY_FLOOR_DB} dBFS)`);
}
function makeNullSound() {
  const { y, sr } = readWav(SOUND);
  const pad = Math.round(NULL_VARIANT.offsetS * sr), g = 10 ** (NULL_VARIANT.gainDb / 20);
  const z = new Float32Array(pad + y.length);
  for (let i = 0; i < y.length; i++) z[pad + i] = y[i] * g;
  writeWav16(SOUND_NULL, z, sr);
  console.log(`prep: null sound ${path.basename(SOUND_NULL)} (+${NULL_VARIANT.offsetS} s, ${NULL_VARIANT.gainDb} dB)`);
}

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

if (stages.includes("record")) {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(port), "--strictPort", "--outDir", path.relative(repo, DIST)], { cwd: repo, stdio: "ignore", windowsHide: true });
  const kids = [];
  let standIn = null;
  const cleanup = () => { for (const k of kids) if (k.exitCode == null) killPid(k.pid); standIn?.cleanup(); killPid(server.pid); };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${port}/Syrinx/`)).ok) break; } catch { /* not yet */ } await sleep(200); }
    const url = `http://localhost:${port}/Syrinx/?sr=48000`;
    const outRuns = path.relative(repo, path.join(OUT, "runs"));
    if (!existsSync(SOUND_NULL)) makeNullSound();
    if (!existsSync(SOUND_NOISY)) await makeNoisySound();
    const stand = [];
    standIn = { cleanup: () => { while (stand.length) stand.pop().cleanup(); } };
    const newStandIn = async (wav, label) => { const c = await spawnChrome({ wav, headless: true, log: (x) => console.log(`record: ${label}: ${x}`) }); stand.push(c); return c; };
    const logs = path.join(OUT, "logs");
    mkdirSync(logs, { recursive: true });
    const start = (name, args, { env = {}, stdin = "ignore" } = {}) => {
      const f = path.join(logs, `${name}.log`);
      writeFileSync(f, "");
      const k = spawn(process.execPath, args, { cwd: repo, stdio: [stdin, "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...env } });
      if (stdin === "pipe") k.stdin.end(); // terminal input that ends at once
      k.stdout.on("data", (d) => writeFileSync(f, d, { flag: "a" }));
      k.stderr.on("data", (d) => writeFileSync(f, d, { flag: "a" }));
      kids.push(k);
      return new Promise((res) => k.on("exit", (code) => res({ name, code, log: f })));
    };
    const dur = 215;
    // V0: the cue protocol, time-scaled, one spawned device
    if (RUNS.includes("v0")) {
      console.log("record: V0 (the cued protocol, time-scaled 0.02, desktop spawn only)");
      run([path.join(here, "sbs-session.mjs"), "--phone=off", `--desktop=spawn:${SOUND}`, `--url=${url}`, "--protocol=full", "--dongle", "--time-scale=0.02", "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v0-protocol"], { timeout: 240000 });
    }
    // V1 + V2 at once
    if (RUNS.includes("v1") || RUNS.includes("v2")) {
      const ps = [];
      if (RUNS.includes("v1")) {
        const si = await newStandIn(SOUND, "phone stand-in (V1)");
        console.log(`record: V1 (identical inputs: desktop spawn + phone dry-run, ${dur} s)`);
        ps.push(start("v1-same", [path.join(here, "sbs-session.mjs"), `--phone=dry:http://127.0.0.1:${si.port}`, `--desktop=spawn:${SOUND}`, `--url=${url}`, "--protocol=none", `--duration=${dur}`, "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v1-same"]));
        await sleep(8000); // stagger the model downloads
      }
      if (RUNS.includes("v2")) {
        console.log(`record: V2 (known FIR, ${dur} s)`);
        ps.push(start("v2-fir", [path.join(here, "sbs-desktop.mjs"), `--spawn=${SOUND_FIR}`, `--url=${url}`, `--duration=${dur}`, "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v2-fir"]));
      }
      for (const r of await Promise.all(ps)) console.log(`record: ${r.name} exit ${r.code} (log ${path.relative(repo, r.log)})`);
      while (stand.length) stand.pop().cleanup();
    }
    // V3 + V4 at once
    if (RUNS.includes("v3") || RUNS.includes("v4")) {
      const ps = [];
      if (RUNS.includes("v3")) {
        const si = await newStandIn(SOUND, "phone stand-in (V3)");
        // a Syrinx tab already open on the "phone": the phone path must pick the new one and close this one
        const pre = await (await fetch(`http://127.0.0.1:${si.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
        writeFileSync(path.join(OUT, "v3-preopened-tab.json"), JSON.stringify({ id: pre.id }));
        await sleep(3000);
        console.log("record: V3 (the voice protocol, time-scaled 0.5, desktop spawn + phone dry-run with a Syrinx tab already open)");
        ps.push(start("v3-voice", [path.join(here, "sbs-session.mjs"), `--phone=dry:http://127.0.0.1:${si.port}`, `--desktop=spawn:${SOUND}`, `--url=${url}`, "--protocol=voice", "--time-scale=0.5", "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v3-voice"]));
        await sleep(8000);
      }
      if (RUNS.includes("v4")) {
        const si = await newStandIn(SOUND_NULL, "phone stand-in (V4 null)");
        console.log(`record: V4 (null: the same sound ${NULL_VARIANT.offsetS} s later and ${NULL_VARIANT.gainDb} dB on the phone stand-in; the desktop's socket dropped once at 60 s; ${dur + 2} s)`);
        ps.push(start("v4-null", [path.join(here, "sbs-session.mjs"), `--phone=dry:http://127.0.0.1:${si.port}`, `--desktop=spawn:${SOUND}`, `--url=${url}`, "--protocol=none", `--duration=${dur + 2}`, "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v4-null"], { env: { SBS_TEST_DROP: "desktop:60" } }));
      }
      for (const r of await Promise.all(ps)) console.log(`record: ${r.name} exit ${r.code} (log ${path.relative(repo, r.log)})`);
      while (stand.length) stand.pop().cleanup();
    }
    // V5: terminal input that ends at once (not --auto): the clean shutdown, exit 1
    if (RUNS.includes("v5")) {
      console.log("record: V5 (non-auto, terminal input closed at once)");
      const r5 = await start("v5-stdin", [path.join(here, "sbs-session.mjs"), "--phone=off", `--desktop=spawn:${SOUND}`, `--url=${url}`, "--protocol=sound", "--heard-as=off", `--out=${outRuns}`, "--tag=v5-stdin"], { stdin: "pipe" });
      writeFileSync(path.join(OUT, "v5-exit.json"), JSON.stringify({ code: r5.code }));
      console.log(`record: ${r5.name} exit ${r5.code} (log ${path.relative(repo, r5.log)})`);
    }
    // V6: the positive control for the pause classification: the test sound over a steady pink floor
    if (RUNS.includes("v6")) {
      console.log(`record: V6 (the test sound over a pink floor at ${NOISY_FLOOR_DB} dBFS, desktop spawn, 205 s)`);
      const r6 = await start("v6-noisy", [path.join(here, "sbs-desktop.mjs"), `--spawn=${SOUND_NOISY}`, `--url=${url}`, "--duration=205", "--auto", "--heard-as=off", `--out=${outRuns}`, "--tag=v6-noisy"]);
      console.log(`record: ${r6.name} exit ${r6.code} (log ${path.relative(repo, r6.log)})`);
    }
  } finally { cleanup(); }
  console.log("record: done");
}

if (stages.includes("analyze")) {
  const { analyzeValidation } = await import("./sbs-validate-checks.mjs");
  const runs = path.join(OUT, "runs");
  const pick = (tag) => readdirSync(runs).filter((d) => d.endsWith(tag)).sort().pop();
  const opt = (tag) => (pick(tag) ? path.join(runs, pick(tag)) : null);
  const res = await analyzeValidation({
    v0: opt("v0-protocol"), v1: opt("v1-same"), v2: opt("v2-fir"), v3: opt("v3-voice"), v4: opt("v4-null"), v5: opt("v5-stdin"), v6: opt("v6-noisy"), noisyFloorDb: NOISY_FLOOR_DB,
    knownFirDb: KNOWN_FIR_DB, firPath: FIR, soundPath: SOUND, soundFirPath: SOUND_FIR, out: OUT, nullVariant: NULL_VARIANT,
    predictOnly: arg("predict-only", "dev__174,dev__84").split(",").filter(Boolean), predict: !process.argv.includes("--no-predict"), shards: Number(arg("shards", "2")),
  });
  writeFileSync(path.join(OUT, "validation.json"), JSON.stringify(res, null, 1));
  console.log(res.text);
}
process.exit(0);
