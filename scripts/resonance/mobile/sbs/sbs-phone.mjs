// sbs-phone.mjs — the phone half of the phone-vs-headset kit on its own:
// Chrome on the Pixel over ADB (USB or wireless debugging) + CDP (as
// scripts/mobile-diag-capture.js; the tab its intent opens, every other Syrinx
// tab closed),
// the page logger injected before the app loads, a timestamped run folder.
// It also saves `adb shell dumpsys media.audio_flinger` / `media.audio_policy`
// / `audio` while listening (input preset / source, device, HAL rate) and at
// the end.
//
//   node scripts/resonance/mobile/sbs/sbs-phone.mjs [--url=https://alice-sabrina-ivy.github.io/Syrinx/]
//        [--duration=600] [--protocol=none|full|sound|voice] [--auto-start] [--pcm=1]
//        [--phone-cdp-port=<PC port; default a free one>] [--phone-serial=<adb serial, e.g. ip:port for wireless debugging>]
//        [--dry-run=<http://127.0.0.1:PORT of another Chrome>]
//
// Without --auto-start the owner taps the goal sheet / Start on the phone.
// --dry-run runs no adb at all (prints the commands) and points the CDP part at
// another Chrome's debugging endpoint — for checking the code path without a phone.
// Recording stops after --duration s or on Enter. Output and next steps: sbs-session.mjs.
import { runSession, deviceSpecsFrom, argOf } from "./sbs-session.mjs";

const argv = process.argv.slice(2);
const dry = argOf(argv, "dry-run", "");
const a = [...argv.filter((x) => !x.startsWith("--dry-run")), "--desktop=off", ...(dry ? [`--phone=dry:${dry}`] : []), ...(argv.some((x) => x.startsWith("--protocol=")) ? [] : ["--protocol=none"]),
  ...(argv.some((x) => x.startsWith("--duration=")) ? [] : ["--duration=600"]), ...(argv.some((x) => x.startsWith("--tag=")) ? [] : ["--tag=phone"])];
runSession(a, deviceSpecsFrom(a)).then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
