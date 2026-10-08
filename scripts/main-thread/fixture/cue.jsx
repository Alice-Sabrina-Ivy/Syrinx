// cue.jsx — fixed-input run of the real CueStrip
// (scripts/main-thread/visual-check.mjs). ?direction=exploring|feminine|masculine.
// window.__set(i): props + resonance snapshot of scripted step i.
// window.__tick(): the strip's 250 ms tick. window.__dump(): every row's
// state and geometry (transitions disabled by the page's CSS).
import "./clock.js";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { CueStrip } from "../../src/components/CueStrip.jsx";

const params = new URLSearchParams(location.search);
const direction = params.get("direction") ?? "exploring";
const resonanceRef = { current: null };

// Scripted inputs: 3 s silent, then talk in 4 s phrases with 1 s pauses;
// weight calibrates over the first ~10 s of steps; resonance warms, settles,
// goes live, has a held-note ("sustained") stretch and a clamp.
function inputsAt(i) {
  const t = i * 0.25;
  const talking = t >= 3 && (t - 3) % 5 < 4;
  const justStopped = !talking && t >= 3 && (t - 3) % 5 < 4.5;
  const pitchLevel = talking ? 150 + 60 * Math.sin(i / 6) + (i % 40 > 30 ? 90 : 0) : null;
  const calibrated = t > 13;
  const vocalWeight = {
    cpp: talking ? 10 + Math.sin(i / 4) : null,
    position: null,
    sigmaDelta: talking ? Math.sin(i / 5) : null,
    sigmaLevel: calibrated && talking ? 1.4 * Math.sin(i / 9) : null,
    baselineProgress: Math.min(1, Math.max(0, (t - 3) / 10)),
    baselineReady: calibrated,
  };
  const voicedS = Math.max(0, t - 3) * 0.8;
  const snap = t < 2 ? null : {
    u: voicedS > 2 ? 0.8 * Math.sin(i / 17) + (t > 40 && t < 44 ? 3 : 0) : null,
    raw: t > 40 && t < 44 ? 2.9 : 0.8 * Math.sin(i / 17),
    startU: t > 18 ? 0.1 : null,
    voicedS,
    fill: Math.min(1, voicedS / 6),
    sinceResumeS: 10,
    verdict: t > 30 && t < 34 ? "sustained" : "running",
  };
  return {
    props: {
      voiced: talking, holding: justStopped, pitch: pitchLevel, pitchLevel,
      steadiness: talking ? 0.2 + 0.1 * Math.abs(Math.sin(i)) : null, steadinessHeld: false,
      hnr: talking ? 12 + 3 * Math.sin(i / 7) : null, vocalWeight,
      resonanceStatus: t < 1 ? "loading" : "ready",
    },
    snap,
  };
}

let setStep = null;
function Harness() {
  const [i, setI] = useState(0);
  setStep = setI;
  const { props } = inputsAt(i);
  // Parent effects run after the strip's: the strip has seen step i.
  useEffect(() => { window.__committed = i; }, [i]);
  return (
    <div style={{ width: Number(params.get("w") ?? 480) }}>
      <CueStrip direction={direction} {...props} resonanceRef={resonanceRef} />
    </div>
  );
}
window.__set = (i) => { resonanceRef.current = inputsAt(i).snap; setStep(i); };
window.__tick = () => window.__runIntervals(250);
window.__dump = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const centre = (el) => { const b = el.getBoundingClientRect(); return [r2(b.left + b.width / 2), r2(b.top + b.height / 2)]; };
  return [...document.querySelectorAll("[data-cue]")].map((row) => {
    const svg = row.querySelector("svg");
    const dotEl = row.querySelector("[data-cue-dot-mark]") ?? row.querySelector("[data-cue-dot] circle");
    const trail = svg ? [...svg.querySelectorAll("circle")].filter((c) => !c.closest("[data-cue-dot]") && !c.hasAttribute("data-cue-start"))
      .map((c) => [...centre(c), c.getAttribute("opacity")]) : [];
    const dotStyle = dotEl ? getComputedStyle(dotEl) : null;
    return {
      cue: row.dataset.cue, state: row.dataset.state, dot: row.dataset.dot, hollow: row.dataset.hollow, trailN: row.dataset.trail,
      value: row.dataset.value, lo: row.dataset.targetLow ?? null, hi: row.dataset.targetHigh ?? null,
      header: row.querySelector("[data-cue-value]")?.textContent ?? "", word: row.querySelector("[data-cue-word]")?.textContent ?? null,
      sr: row.querySelector("[data-cue-sr]")?.textContent ?? "",
      dotCentre: dotEl ? centre(dotEl) : null, dotOpacity: dotStyle ? dotStyle.opacity : null,
      start: (() => { const s = row.querySelector("[data-cue-start]"); return s ? centre(s) : null; })(),
      change: (() => { const c = row.querySelector("[data-cue-change]"); return c ? [c.getAttribute("x1"), c.getAttribute("x2")].map(Number).map(r2) : null; })(),
      chevron: row.querySelector("[data-cue-dot] path")?.getAttribute("d") ?? null,
      progress: (() => { const p = row.querySelector("[data-cue-progress]"); return p ? [p.getAttribute("x"), p.getAttribute("width")].map(Number).map(r2) : null; })(),
      trail,
    };
  });
};

createRoot(document.getElementById("root")).render(<Harness />);
