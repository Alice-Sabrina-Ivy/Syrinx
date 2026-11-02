// sbs-session.mjs — the phone-vs-headset session: drives the Pixel (ADB + CDP)
// and the desktop Chrome with the Maxwell (attach to the user's debug Chrome)
// at once, both with the page logger (sbs-logger.mjs), syncs both clocks with
// repeated minimum-round-trip probes at the start and the end, and cues the
// user step by step in this terminal (step names + countdowns). Every step's
// start / end (PC clock) goes into session.json for sbs-analyze.mjs.
//
//   node scripts/resonance/mobile/sbs/sbs-session.mjs
//        [--phone=adb | dry:<http://127.0.0.1:PORT> | off] [--desktop=attach | spawn:<abs wav> | off]
//        [--url=https://alice-sabrina-ivy.github.io/Syrinx/] [--port=9223] [--phone-cdp-port=<free port>]
//        [--phone-serial=<adb serial, e.g. 192.168.1.20:41234 for wireless debugging>]
//        [--protocol=full | sound | voice | none] [--duration=<s, protocol none>] [--dongle]
//        [--play-pc=<abs wav>] [--play-pc-force] [--auto] [--auto-start] [--goal=exploring] [--time-scale=1]
//        [--pcm=1] [--worker-hook=1] [--expect-mic=maxwell] [--out=build/resonance-mobile/sbs/runs] [--tag=<name>]
//        [--heard-as=on|off (spawned Chromes only)]
//
// Ctrl+C at any point stops cleanly: the end clock sync, a last pull, meta.json
// with the stats, the desktop window closed, the adb forward removed. Terminal
// input that ends (stdin closed) stops the same way.
//
// Output: <out>/<ISO time>[-tag]/{session.json, phone/, desktop/} — each
// device folder: log.jsonl, pcm.f32 + pcm.jsonl, clock.jsonl, meta.json (+ the
// phone's dumpsys snapshots). The user's voice is in these files: they stay
// in the gitignored build/ folder and are never committed (CLAUDE.md
// §Private session data).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { Recorder, desktopAttach, desktopSpawn, phone, autoStart, waitListening, adbAudioDump, appState, pcNow, sleep, killPid, DEFAULT_URL } from "./sbs-device.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
export const argOf = (argv, k, d) => (argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
export const flagOf = (argv, k) => argv.includes(`--${k}`) || argv.some((a) => a === `--${k}=1`);

const RAINBOW = `When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow.
The rainbow is a division of white light into many beautiful colors. These take the shape
of a long round arch, with its path high above, and its two ends apparently beyond the
horizon. There is, according to legend, a boiling pot of gold at one end. People look, but
no one ever finds it. When a man looks for something beyond his reach, his friends say he
is looking for the pot of gold at the end of the rainbow.   (Fairbanks 1960, public domain)`;

/** The cued protocol. Each step: { name, say, s (seconds) | enter: true, read?, kind } */
export function protocolSteps(kind, { dongle = false } = {}) {
  const sound = [
    { name: "sound-place", enter: true, say: "TEST SOUND. Take the headset off. Put the Maxwell's boom and the Pixel's mic end side by side, about 25 cm in front of the loudspeaker, both pointing at it, nothing touching them. Have the test sound (sbs-test.wav) ready on the speaker device. Press Enter, then start the sound." },
    { name: "sound", s: 205, say: "Play the test sound now and keep still and quiet until it ends (about 3 min 16 s)." },
  ];
  const voice = [
    { name: "voice-place", enter: true, say: "YOUR VOICE. Headset on, boom where you normally wear it. Hold the phone in your hand the way you held it when you saw the difference (Dashboard showing). Press Enter to start." },
    { name: "read", s: 60, read: true, say: "Read the passage aloud in your normal voice (start again at the top if you finish)." },
    ...["brighter", "normal", "darker", "normal", "brighter", "normal", "darker", "normal"].map((w, i) => ({ name: `hold${i + 1}-${w}`, s: 8, read: true, say: w === "normal" ? "Keep reading in your NORMAL voice." : `Keep reading with a ${w.toUpperCase()} resonance and hold it (pitch as normal).` })),
    ...["brighter", "normal", "darker", "normal", "brighter", "normal", "darker", "normal"].map((w, i) => ({ name: `try${i + 1}-${w}`, s: w === "normal" ? 5 : 3, read: true, say: w === "normal" ? "Back to NORMAL." : `Quick try: ${w.toUpperCase()} for 3 seconds.` })),
    ...[1, 2, 3, 4].flatMap((i) => [{ name: `pause${i}-talk`, s: 4, read: true, say: "Say one sentence." }, { name: `pause${i}-quiet`, s: 3, say: "Stay SILENT (watch the phone: does the resonance thumb vanish?)." }]),
  ];
  const placements = [
    { name: "place-mouth", place: "Phone's mic end about 5 cm from the corner of your mouth (where the boom is)." },
    { name: "place-chest", place: "Phone in your hand at chest height, screen toward you (a usual practice position)." },
    { name: "place-desk", place: "Phone lying on the desk about 40 cm in front of you." },
  ].flatMap((p) => [
    { name: `${p.name}-set`, s: 5, say: `PLACEMENT: ${p.place} Get ready.` },
    { name: p.name, s: 20, read: true, say: `${p.place} Read aloud.` },
    { name: `${p.name}-quiet`, s: 4, say: "Stay SILENT." },
  ]);
  const opening = [
    { name: "setup", enter: true, say: "Both devices are listening. Sit where you will do the session. Press Enter to begin." },
    { name: "claps", s: 6, say: "CLAP your hands 3 times, sharply, about a second apart, between the two mics." },
    { name: "room", s: 30, say: "Stay QUIET (room sound, 30 s). Nobody talks, nothing plays." },
  ];
  const dongleSteps = !dongle ? [] : [
    { name: "dongle-plug", enter: true, say: "OPTIONAL: plug the Maxwell's USB dongle into the Pixel (the phone stays connected over wireless debugging). On the phone, tap 'Turn Mic off', then start again (the boom is now the phone's mic). Press Enter once the phone is listening." },
    { name: "dongle-read", s: 30, read: true, say: "Headset on. Read aloud (the phone now hears the boom)." },
    { name: "dongle-sound-place", enter: true, say: "Put the headset with its boom 25 cm in front of the loudspeaker as before. Press Enter, then start the test sound again." },
    { name: "dongle-sound", s: 205, say: "Play the test sound now; stay quiet until it ends." },
  ];
  const closing = [{ name: "claps-end", s: 6, say: "CLAP 3 times again (end marker)." }];
  if (kind === "none") return [];
  if (kind === "sound") return [...opening, ...sound, ...closing];
  if (kind === "voice") return [...opening, ...voice, ...placements, ...closing];
  return [...opening, ...sound, ...voice, ...placements, ...dongleSteps, ...closing];
}

/** Windows' default playback device (what Media.SoundPlayer plays through), or null. Read-only query. */
export function defaultOutputName() {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "sbs-audio-out.ps1")], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  const name = (r.stdout || "").trim().split(/\r?\n/).pop();
  return r.status === 0 && name ? name : null;
}
function playWav(wav) {
  const ps = `$p = New-Object Media.SoundPlayer '${wav.replace(/'/g, "''")}'; $p.PlaySync()`;
  const child = spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore", windowsHide: true });
  return child.pid;
}

/**
 * Terminal input that stops cleanly: Ctrl+C calls onInterrupt (readline puts a
 * TTY in raw mode, so Ctrl+C reaches readline, not process 'SIGINT'), and a
 * pending question rejects when the input ends or the interface closes.
 */
export function makeInput({ auto = false, input = process.stdin, output = process.stdout, onInterrupt = () => {} } = {}) {
  if (auto) return { ask: async () => "", close() {}, get closed() { return false; } };
  const rl = readline.createInterface({ input, output });
  let closed = false;
  const pending = new Set();
  rl.on("SIGINT", () => onInterrupt("Ctrl+C"));
  rl.on("close", () => { closed = true; for (const p of pending) p.reject(new Error("terminal input closed")); pending.clear(); });
  return {
    ask: (q) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error("terminal input closed")); return; }
      const p = { resolve, reject };
      pending.add(p);
      rl.question(q, (ans) => { pending.delete(p); resolve(ans); });
    }),
    close() { if (!closed) rl.close(); },
    get closed() { return closed; },
  };
}
class Stopped extends Error {}

/** Run a session with any set of devices. devices: [{ name: "phone" | "desktop", open: async () => device }] */
export async function runSession(argv, deviceSpecs) {
  const url = argOf(argv, "url", DEFAULT_URL);
  const outRoot = path.resolve(repo, argOf(argv, "out", "build/resonance-mobile/sbs/runs"));
  const tag = argOf(argv, "tag", "");
  const id = new Date().toISOString().replace(/[:.]/g, "-") + (tag ? `-${tag}` : "");
  const dir = path.join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  const AUTO = flagOf(argv, "auto");
  const scale = Number(argOf(argv, "time-scale", "1"));
  const protocol = argOf(argv, "protocol", "full");
  const playPc = argOf(argv, "play-pc", "");
  const expectMic = argOf(argv, "expect-mic", "maxwell");
  const session = { id, dir, url, argv, protocol, timeScale: scale, started: pcNow(), steps: [], devices: {}, notes: [] };
  const save = () => writeFileSync(path.join(dir, "session.json"), JSON.stringify(session, null, 1));
  const log = (s) => console.log(s);
  save();
  const devs = [];
  let playerPid = null, stopping = false, shutdownP = null, interrupted = false;
  const doShutdown = async (why) => {
    stopping = true;
    session.stoppedBy = why;
    log(`\nstopping (${why}) …`);
    if (playerPid) { killPid(playerPid); playerPid = null; }
    for (const d of devs) { try { await d.rec.clockSync("end"); } catch { /* ignore */ } }
    for (const d of devs) { try { await d.rec.stop(); } catch { /* ignore */ } }
    for (const d of devs) {
      if (d.name === "phone" && d.dev.kind === "phone") { try { d.meta.dumpsysEnd = adbAudioDump(d.dir, "end"); } catch (e) { d.meta.dumpsysEndErr = String(e.message); } }
      d.meta.stats = { ...d.rec.stats, docs: [...d.rec.stats.docs] };
      d.meta.ended = pcNow();
      writeFileSync(path.join(d.dir, "meta.json"), JSON.stringify(d.meta, null, 1));
      try { if (!flagOf(argv, "keep-open")) await d.dev.close(); } catch { /* ignore */ }
    }
    session.ended = pcNow();
    save();
    input.close();
    log(`\nsaved: ${dir}`);
    for (const d of devs) {
      const s = d.meta.stats;
      log(`  ${d.name}: ${s.pulls} pulls, ${s.chunks} chunks (${(s.chunks * 0.025).toFixed(0)} s), ${s.pitch} pitch msgs, ${s.state} resonance posts, PCM ${((s.pcmSamples || 0) / 1e6).toFixed(2)} M samples, pull errors ${s.errors}${s.reconnects ? `, reconnects ${s.reconnects}` : ""}${s.lastErr ? ` (last: ${s.lastErr})` : ""}`);
    }
    if (devs.length) log(`next: node scripts/resonance/mobile/sbs/sbs-analyze.mjs --session="${dir}"`);
    else log("nothing was recorded (no device opened).");
  };
  const shutdown = (why) => (shutdownP ??= doShutdown(why));
  const onInterrupt = (why) => {
    if (interrupted) { log("\nsecond Ctrl+C: exiting without waiting for the clean stop"); process.exit(130); }
    interrupted = true;
    log("\n(Ctrl+C: stopping cleanly; press it again to exit at once)");
    shutdown(why).finally(() => process.exit(130));
  };
  const input = makeInput({ auto: AUTO, onInterrupt });
  process.on("SIGINT", () => onInterrupt("Ctrl+C"));
  const check = () => { if (stopping) throw new Stopped("stopped"); };
  const enter = async (q) => { check(); await input.ask(q); check(); };

  try {
    // ---- --play-pc: refuse to play through the headset (the sound must come from a loudspeaker 25 cm from both mics)
    if (playPc) {
      const out = defaultOutputName();
      session.playPcDevice = out;
      log(`--play-pc: Windows will play the test sound through "${out ?? "unknown"}".`);
      if (out && new RegExp(`${expectMic}|audeze|headset|headphone`, "i").test(out) && !flagOf(argv, "play-pc-force")) {
        throw new Error(`the PC's default playback device is "${out}": the test sound would come out of the headset next to the boom, not from a loudspeaker. ` +
          "Set the PC speakers as the default playback device (Windows Settings > System > Sound > Output), or play the WAV from another device; --play-pc-force overrides this check.");
      }
    }

    // ---- open every device (in parallel), start the pulls
    const opened = await Promise.allSettled(deviceSpecs.map(async (spec) => {
      const ddir = path.join(dir, spec.name);
      mkdirSync(ddir, { recursive: true });
      const dlog = (s) => log(`[${spec.name}] ${s}`);
      const dev = await spec.open({ log: dlog });
      if (stopping) { try { await dev.close(); } catch { /* ignore */ } throw new Stopped("stopped while opening"); }
      const rec = new Recorder(spec.name, ddir, dev, { pcm: argOf(argv, "pcm", "1") !== "0", log });
      rec.start(1000);
      const meta = { name: spec.name, kind: dev.kind, info: dev.info, url, opened: pcNow() };
      writeFileSync(path.join(ddir, "meta.json"), JSON.stringify(meta, null, 1));
      return { name: spec.name, dev, rec, dir: ddir, meta, spec };
    }));
    for (const o of opened) if (o.status === "fulfilled") devs.push(o.value); else log(`device failed: ${o.reason?.message ?? o.reason}`);
    if (devs.length < deviceSpecs.length) { session.notes.push("a device failed to open"); await shutdown("device failed"); process.exit(2); }
    check();

    // ---- listening on each
    await Promise.all(devs.map(async (d) => {
      const st = await appState(d.dev.cdp);
      if (!st.listening) {
        if (d.spec.autoStart) { await autoStart(d.dev.cdp, { goal: argOf(argv, "goal", "exploring") }); }
        else log(`[${d.name}] tap Start on the ${d.name === "phone" ? "phone" : "desktop window"} (the goal sheet's "Start practicing" / "Start — allow the microphone").`);
      }
      let lastHint = 0;
      await waitListening(d.dev.cdp, 300000, (s) => {
        check();
        if (s && s.vis && s.vis !== "visible" && Date.now() - lastHint > 10000) {
          lastHint = Date.now();
          log(`[${d.name}] the Syrinx page the session is watching is hidden: bring that tab to the front${d.name === "phone" ? " on the phone (the newest Syrinx tab; the session closed the others)" : ""}.`);
        }
      });
      d.meta.listening = pcNow();
      log(`[${d.name}] listening`);
    }));
    await sleep(1500);
    check();
    for (const d of devs) {
      const g = await d.dev.cdp.eval("(() => { const L = window.__sbs; return L ? { id: L.id, nChunks: L.nChunks } : null; })()");
      d.meta.firstCheck = g;
      if (d.name === "phone" && d.dev.kind === "phone") {
        try {
          d.meta.dumpsysListening = adbAudioDump(d.dir, "listening");
          const ai = d.meta.dumpsysListening.activeInput;
          log(`[phone] recording input: ${ai ?? "not found in dumpsys"}${d.meta.dumpsysListening.activeInputLines?.length ? `\n         ${d.meta.dumpsysListening.activeInputLines.slice(0, 4).join("\n         ")}` : ""}`);
        } catch (e) { log(`[phone] dumpsys failed: ${e.message}`); }
      }
      const sync = await d.rec.clockSync("start");
      log(`[${d.name}] clock: offset ${sync?.offset?.toFixed(1)} ms (round trip ${sync?.rtt?.toFixed(1)} ms); chunks so far ${g?.nChunks ?? "?"}`);
      if (!g?.nChunks) log(`[${d.name}] WARNING: no capture chunks seen on the page — the AudioContext capture path? (the transfer function then cannot be measured)`);
      writeFileSync(path.join(d.dir, "meta.json"), JSON.stringify(d.meta, null, 1));
    }
    save();
    // mic label check (desktop: the Maxwell)
    const desk = devs.find((d) => d.name === "desktop");
    if (desk && desk.dev.kind === "desktop-attach" && expectMic) {
      await sleep(1500);
      const label = (() => {
        try {
          const lines = readFileSync(path.join(desk.dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
          const g = lines.flatMap((l) => l.rows.gum).filter((x) => x.label != null).pop();
          return g?.label ?? null;
        } catch { return null; }
      })();
      if (label && !new RegExp(expectMic, "i").test(label)) log(`\n!!! desktop microphone is "${label}", not the ${expectMic}. Pick the Maxwell in the debug Chrome (chrome://settings/content/microphone), Turn Mic off and start again, or press Ctrl+C.\n`);
      else if (label) log(`[desktop] microphone: ${label}`);
    }
    // the headset's noise filter (the reference's processing; recorded for the analysis)
    if (!AUTO && desk) {
      const f = await input.ask("\nThe Maxwell's noise filter as you use it (e.g. off / low / high / don't know), then Enter: ");
      session.headsetNoiseFilter = String(f || "").trim() || "not given";
      save();
    }

    // ---- the protocol
    const phoneDev = devs.find((d) => d.name === "phone");
    const micEnd = (() => {
      const ai = phoneDev?.meta?.dumpsysListening?.activeInput || "";
      if (/BACK_MIC/.test(ai) && !/BUILTIN_MIC/.test(ai)) return "the Pixel's BACK mic (the small hole near the camera)";
      if (/BUILTIN_MIC/.test(ai)) return "the Pixel's bottom end (its main mic)";
      return "the Pixel's bottom end (its main mic; the terminal could not tell which mic the recording uses)";
    })();
    const steps = protocolSteps(protocol, { dongle: flagOf(argv, "dongle") });
    if (protocol === "none") {
      const dur = Number(argOf(argv, "duration", "60"));
      session.steps.push({ name: "run", pc0: pcNow() });
      if (playPc) { playerPid = playWav(playPc); session.steps.at(-1).playPc = playPc; }
      if (AUTO) { const t0 = Date.now(); while (Date.now() - t0 < dur * 1000) { check(); await sleep(Math.min(500, dur * 1000 - (Date.now() - t0))); } }
      else await Promise.race([sleep(dur * 1000), enter(`recording for ${dur} s — press Enter to stop early\n`)]);
      session.steps.at(-1).pc1 = pcNow();
    }
    let readShown = false;
    for (const st of steps) {
      check();
      const say = st.name === "sound-place" ? st.say.replace("the Pixel's mic end", micEnd) : st.say;
      log(`\n=== ${st.name.toUpperCase()} ===\n${say}`);
      if (st.read && !readShown) { log(`\n${RAINBOW}\n`); readShown = true; }
      if (st.enter) { await enter("[press Enter] "); session.steps.push({ name: st.name, pc0: pcNow(), pc1: pcNow() }); save(); continue; }
      const S = st.s * scale;
      const rec = { name: st.name, pc0: pcNow() };
      session.steps.push(rec);
      if (st.name.endsWith("sound") && playPc) { playerPid = playWav(playPc); rec.playPc = playPc; log(`(playing ${path.basename(playPc)} from the PC through "${session.playPcDevice ?? "the default device"}", pid ${playerPid})`); }
      const t0 = Date.now();
      while (Date.now() - t0 < S * 1000) {
        check();
        const left = Math.ceil(S - (Date.now() - t0) / 1000);
        process.stdout.write(`\r   ${String(left).padStart(4)} s  ${"#".repeat(Math.min(40, left))}${" ".repeat(Math.max(0, 40 - left))}`);
        await sleep(Math.min(250, S * 1000 - (Date.now() - t0)));
      }
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      rec.pc1 = pcNow();
      if (playerPid) { killPid(playerPid); playerPid = null; }
      save();
      // health line per device
      log(devs.map((d) => `[${d.name}] ${d.rec.stats.chunks} chunks, ${d.rec.stats.state} posts${d.rec.stats.errors ? `, ${d.rec.stats.errors} pull errors` : ""}${d.rec.outage ? " — RECONNECTING" : ""}`).join("   "));
    }
    await shutdown("done");
    return dir;
  } catch (e) {
    if (interrupted || e instanceof Stopped) { await shutdownP; return dir; }
    session.error = String(e?.message || e);
    await shutdown(`error: ${session.error}`);
    throw e;
  }
}

export function deviceSpecsFrom(argv) {
  const url = argOf(argv, "url", DEFAULT_URL);
  const cfg = { pcm: argOf(argv, "pcm", "1") !== "0", workerHook: argOf(argv, "worker-hook", "1") !== "0" };
  const specs = [];
  const ph = argOf(argv, "phone", "adb");
  if (ph !== "off") {
    const dry = ph.startsWith("dry:");
    specs.push({ name: "phone", autoStart: flagOf(argv, "auto-start") || dry,
      open: ({ log }) => phone({ url, cfg, dryRun: dry, cdpUrl: dry ? ph.slice(4) : null, cdpPort: Number(argOf(argv, "phone-cdp-port", "0")), serial: argOf(argv, "phone-serial", "") || null,
        needWireless: flagOf(argv, "dongle"), heardAs: argOf(argv, "heard-as", "on") !== "off", log }) });
  }
  const dk = argOf(argv, "desktop", "attach");
  if (dk !== "off") {
    if (dk.startsWith("spawn:")) specs.push({ name: "desktop", autoStart: true, open: ({ log }) => desktopSpawn({ wav: dk.slice(6), url, cfg, heardAs: argOf(argv, "heard-as", "on") !== "off", log }) });
    else specs.push({ name: "desktop", autoStart: true, open: ({ log }) => desktopAttach({ port: Number(argOf(argv, "port", "9223")), url, cfg, log }) });
  }
  return specs;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const argv = process.argv.slice(2);
  runSession(argv, deviceSpecsFrom(argv)).then(() => process.exit(0), (e) => { console.error(e?.message ?? e); process.exit(1); });
}
