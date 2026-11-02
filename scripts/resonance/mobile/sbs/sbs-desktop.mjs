// sbs-desktop.mjs — the desktop half of the phone-vs-headset kit on its own:
// attaches to the user's Chrome started with the debug port (the
// desktop-diag-capture-attach.js pattern: its OWN new window, only that target
// is ever closed), injects the page logger before the app loads, starts
// listening, and records into a timestamped run folder.
//
//   node scripts/resonance/mobile/sbs/sbs-desktop.mjs [--url=https://alice-sabrina-ivy.github.io/Syrinx/]
//        [--port=9223] [--duration=600] [--protocol=none|full|sound|voice] [--expect-mic=maxwell] [--pcm=1]
//        [--spawn=<abs wav>]   (validation: a fresh Chrome with that WAV as its fake mic, killed by PID afterwards)
//
// One-time: start the debug Chrome (your normal Chrome can stay open: its own
// --user-data-dir makes it a separate browser) with
//   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="$env:TEMP\chrome-debug-profile"
// (any folder outside your normal Chrome profile; reuse the same one so the microphone choice
// is kept) and pick the Maxwell as the microphone in that profile (chrome://settings/content/microphone).
// Recording stops after --duration s or on Enter.
import { runSession, deviceSpecsFrom, argOf } from "./sbs-session.mjs";

const argv = process.argv.slice(2);
const sp = argOf(argv, "spawn", "");
const a = [...argv.filter((x) => !x.startsWith("--spawn")), "--phone=off", ...(sp ? [`--desktop=spawn:${sp}`] : []), ...(argv.some((x) => x.startsWith("--protocol=")) ? [] : ["--protocol=none"]),
  ...(argv.some((x) => x.startsWith("--duration=")) ? [] : ["--duration=600"]), ...(argv.some((x) => x.startsWith("--tag=")) ? [] : ["--tag=desktop"])];
runSession(a, deviceSpecsFrom(a)).then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
