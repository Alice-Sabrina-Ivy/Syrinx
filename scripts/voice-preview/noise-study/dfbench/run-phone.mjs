// run-phone.mjs — the bench on a USB-attached Android phone's Chrome (screen on, unlocked, USB
// debugging authorised). The phone reaches this PC's localhost through `adb reverse`; the page
// POSTs its result back. Nothing is installed on the phone; the reverse is removed at the end.
//   node scripts/voice-preview/noise-study/dfbench/run-phone.mjs
import { spawnSync } from "node:child_process";
import { serve } from "./serve.mjs";
const ADB = process.env.ADB ?? "adb";
const adb = (...a) => { const r = spawnSync(ADB, a, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`adb ${a.join(" ")}: ${r.stderr || r.stdout}`); return r.stdout.trim(); };
const devs = adb("devices").split("\n").slice(1).filter((l) => /\tdevice$/.test(l));
if (devs.length !== 1) throw new Error(`need exactly one authorised device, got ${devs.length}`);
console.log(adb("shell", "getprop", "ro.product.model"), "Android", adb("shell", "getprop", "ro.build.version.release"));
const done = new Promise((res) => { globalThis.srv = serve(4198, res); });
adb("reverse", "tcp:4198", "tcp:4198");
try {
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", `am start -a android.intent.action.VIEW -d 'http://localhost:4198/index.html?t=${Date.now()}' com.android.chrome`);
  const r = await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("no result in 5 min — is the tab in front and the screen on?")), 300000))]);
  console.log(JSON.stringify(r, null, 1));
} finally {
  try { adb("reverse", "--remove", "tcp:4198"); } catch { /* gone */ }
  globalThis.srv?.close();
}
