// trace.jsx — fixed-input render of the real PitchTrace
// (scripts/main-thread/visual-check.mjs). ?target=none|feminine|masculine.
// window.__step(n): n data frames (25 ms each, like the DSP cadence: append a
// point the way the hook does — octave-class gap entry, 15 s trim — notify
// subscribers, run one animation frame). window.__idle(ms): advance the clock
// without data and run one frame. window.__pixels(): the canvas pixels.
import "./clock.js";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { PitchTrace } from "../../src/components/PitchTrace.jsx";
import { pitchTargetFor } from "../../src/utils/trainingDirection.js";

const params = new URLSearchParams(location.search);
const target = pitchTargetFor(params.get("target") ?? "none");
const ref = { current: [] };
const listeners = new Set();
const subscribeTrace = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Deterministic pitch pattern: 2 s cycles (1.5 s voiced, 0.5 s gap); every
// 4th cycle an octave up (an octave-class break), every 7th dips below the
// display floor and every 9th rises above the ceiling (clipped values).
function pitchAt(k) {
  const cyc = Math.floor(k / 80), j = k % 80;
  if (j >= 60) return null;
  let hz = 150 + 55 * Math.sin(k / 23) + 12 * Math.sin(k / 3.1);
  if (cyc % 4 === 3) hz *= 2;
  if (cyc % 7 === 5 && j > 20 && j < 35) hz = 62 + j;
  if (cyc % 9 === 8 && j > 30 && j < 45) hz = 380 + 3 * j;
  return hz;
}
let k = 0;
function push() {
  const f = window.__fake;
  f.epoch += 25;
  const now = f.epoch;
  const hz = pitchAt(k++);
  const arr = ref.current;
  if (hz !== null) {
    const prev = arr[arr.length - 1];
    if (prev && prev.voiced && prev.pitch !== null && Math.abs(12 * Math.log2(hz / prev.pitch)) >= 9.5) {
      arr.push({ time: now, pitch: null, voiced: false });
    }
    arr.push({ time: now, pitch: hz, voiced: true });
  } else {
    arr.push({ time: now, pitch: null, voiced: false });
  }
  while (arr.length > 0 && arr[0].time < now - 15000) arr.shift();
  for (const fn of listeners) fn();
}
window.__step = (n = 1) => { for (let i = 0; i < n; i++) { push(); window.__flush(); } };
window.__idle = (ms) => { window.__fake.epoch += ms; window.__flush(); };
window.__pixels = () => {
  // Read through a copy: getImageData on the trace canvas itself would make
  // Chrome move it off the GPU after a few reads (unlike production).
  const c = document.querySelector("canvas");
  const copy = document.createElement("canvas");
  copy.width = c.width; copy.height = c.height;
  const cc = copy.getContext("2d", { willReadFrequently: true });
  cc.drawImage(c, 0, 0);
  const d = cc.getImageData(0, 0, c.width, c.height).data;
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
  return { w: c.width, h: c.height, b64: btoa(s) };
};

createRoot(document.getElementById("root")).render(
  <div style={{ width: 640, height: 240 }}>
    <PitchTrace pitchTraceRef={ref} subscribeTrace={subscribeTrace} voiced holding={false}
      pitch={200} pitchLevel={200} target={target} compact />
  </div>,
);
window.__ready = true;
