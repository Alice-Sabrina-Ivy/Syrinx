// LabView.jsx — the resonance lab view (lazy chunk; opening it starts the lab).
//
// A research instrument, not a coach: four calibration-free resonance
// readouts side by side on one neutral axis ("larger / darker" <->
// "smaller / brighter"), each with faint reference bands from recorded
// adult speakers, a settling / steadiness indicator, a 3-minute trace and a
// one-line description. No targets, no verdicts, no good/bad colours.

import { useEffect, useState } from "react";
import { subscribe, resetReadings, downloadReadings } from "./labPipeline.js";
import { requestResonanceLab } from "./labRequest.js";

const U_MIN = -1.0;
const U_MAX = 2.2;

const FINALISTS = [
  {
    key: "vtln",
    title: "Spectral warp (VTLN)",
    what: "How far your 800–5000 Hz spectral envelope is stretched along the frequency axis to best match an average-voice model. Tracks formant spacing; uses your pitch value to smooth the spectrum, so octave errors in the pitch track bias it.",
  },
  {
    key: "pnml",
    title: "Resonance-weighted voice model (ML)",
    what: "The app's voice model's internal embedding, re-read by a small head trained to follow formant scaling. Steadiest and least affected by noise, but part of it reflects overall voice-identity cues, not resonance alone.",
  },
  {
    key: "le",
    title: "Learned envelope (tiny network)",
    what: "A small neural network reading the pitch-free band envelope from 500 to 6000 Hz. Cheapest of the four. Background noise pushes it toward smaller/brighter more than the others.",
  },
  {
    key: "fv",
    title: "Formant scale (LPC)",
    what: "The average log-frequency of your first four formants from the app's own formant tracker, corrected for which vowel you are saying. The most transparent of the four; unreliable on narrow-band (phone / Bluetooth headset) audio.",
  },
];

const x = (u) => ((Math.min(U_MAX, Math.max(U_MIN, u)) - U_MIN) / (U_MAX - U_MIN)) * 100;
const toU = (ref, v) => (v - ref.menMedian) / (ref.womenMedian - ref.menMedian);

function Continuum({ band: ref, snap }) {
  // rows: men band above the axis, women band below; labels outside the bands
  const bandRow = (q, y, label, labelY) => {
    const a = x(toU(ref, q.q10)), b = x(toU(ref, q.q90)), m = x(toU(ref, q.q50));
    return (
      <g>
        <rect x={`${a}%`} y={y} width={`${Math.max(0.5, b - a)}%`} height="7" rx="2" className="fill-neutral-500/25" />
        <line x1={`${m}%`} x2={`${m}%`} y1={y} y2={y + 7} className="stroke-neutral-400/70" strokeWidth="1" />
        <text x={`${Math.min(92, Math.max(8, m))}%`} y={labelY} textAnchor="middle" className="fill-neutral-500" fontSize="9">{label}</text>
      </g>
    );
  };
  const u = snap?.u;
  const j = snap?.jitter ?? 0;
  const settled = (snap?.fill ?? 0) >= 1;
  const AX = 34;
  return (
    <svg width="100%" height="68" className="block overflow-visible">
      {bandRow(ref.men, 20, "LibriSpeech adult men (test)", 15)}
      {bandRow(ref.women, 41, "LibriSpeech adult women (test)", 59)}
      <line x1="0%" x2="100%" y1={AX} y2={AX} className="stroke-neutral-700" strokeWidth="1" />
      {u !== null && u !== undefined && (
        <g opacity={settled ? 1 : 0.45}>
          <line x1={`${x(u - j)}%`} x2={`${x(u + j)}%`} y1={AX} y2={AX} className="stroke-neutral-200/60" strokeWidth="3" strokeLinecap="round" />
          <line x1={`${x(u)}%`} x2={`${x(u)}%`} y1={AX - 14} y2={AX + 14} className="stroke-neutral-100" strokeWidth="2" />
          <circle cx={`${x(u)}%`} cy={AX} r="5" className="fill-neutral-100" />
        </g>
      )}
    </svg>
  );
}

function Trace({ history, k, band: ref }) {
  const pts = history.filter((h) => h.u[k] !== null && h.u[k] !== undefined);
  if (pts.length < 2) return <div className="h-10" />;
  const t1 = history[history.length - 1].t;
  const t0 = t1 - 180;
  const xs = (t) => ((t - t0) / 180) * 100;
  const ys = (u) => 38 - ((Math.min(U_MAX, Math.max(U_MIN, u)) - U_MIN) / (U_MAX - U_MIN)) * 36;
  const d = pts.map((p) => `${xs(p.t).toFixed(2)},${ys(p.u[k]).toFixed(2)}`).join(" ");
  const m0 = ys(toU(ref, ref.men.q50)), m1 = ys(toU(ref, ref.women.q50));
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="40" className="block">
      <line x1="0" x2="100" y1={m0} y2={m0} className="stroke-neutral-600" strokeWidth="0.4" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2="100" y1={m1} y2={m1} className="stroke-neutral-600" strokeWidth="0.4" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
      <polyline points={d} fill="none" className="stroke-neutral-300" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function stability(snap) {
  if (!snap || snap.u === null) return "waiting for voiced speech";
  if (snap.fill < 1) return `settling — ${(snap.fill * 5).toFixed(1)} / 5 s of voicing`;
  if (snap.jitter === null) return "settled";
  const j = snap.jitter;
  return `${j < 0.15 ? "steady" : j < 0.35 ? "moving" : "unsettled"} (±${j.toFixed(2)} of the men–women spacing)`;
}

export default function LabView() {
  const [s, setS] = useState(null);
  useEffect(() => subscribe(setS), []);
  // First open of the tab starts the lab (now if listening, else at the next start).
  useEffect(() => { requestResonanceLab(); }, []);
  if (!s) return null;
  const ref = s.reference;
  const snap = s.snapshot;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-3xl mx-auto px-1 pb-6">
      <div className="mb-3">
        <h2 className="text-base text-neutral-200 font-medium">Resonance lab <span className="text-neutral-500 font-normal text-xs">experimental</span></h2>
        <p className="text-xs text-neutral-500 leading-relaxed mt-1">
          Four candidate resonance readouts, side by side, with no calibration. Each position is the
          last ~5 s of <em>voiced</em> speech and only moves while you are voicing. The faint bands show
          where recorded adult speakers fall; they are reference points, not targets — the axis works
          the same in either direction.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
          <span>
            Pitch {snap?.pitch ? `${Math.round(snap.pitch)} Hz` : "—"}
            {!snap?.pitch && snap?.lastPitch ? <span className="text-neutral-600"> (last {Math.round(snap.lastPitch)} Hz)</span> : null}
          </span>
          <span>Voiced so far {snap ? `${snap.voicedS.toFixed(0)} s` : "—"}</span>
          {s.dsp !== "ready" && <span>{s.dsp === "error" ? `Lab error: ${s.error}` : "Loading lab…"}</span>}
          <button onClick={resetReadings} className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer">Reset readings</button>
          <button onClick={downloadReadings} className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer">Save readings (JSON)</button>
        </div>
      </div>
      {!s.running && <p className="text-sm text-neutral-500">Start listening to see the readouts.</p>}
      {ref && FINALISTS.map((f) => {
        const fs = snap?.finalists?.[f.key];
        let extra = null;
        if (f.key === "pnml" && s.pnml !== "ready") {
          extra = s.pnml === "error" ? "model failed to load" : `loading model${s.pnmlProgress ? ` ${Math.round(s.pnmlProgress)}%` : "…"}`;
        }
        return (
          <section key={f.key} className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm text-neutral-200">{f.title}</h3>
              <span className="text-[11px] text-neutral-500 text-right">{extra ?? stability(fs)}</span>
            </div>
            <p className="text-[11px] text-neutral-500 leading-snug mb-1">{f.what}</p>
            <div className="flex justify-between text-[10px] text-neutral-500 uppercase tracking-wide">
              <span>larger / darker</span>
              <span>smaller / brighter</span>
            </div>
            <Continuum band={ref[f.key]} snap={fs} />
            <Trace history={s.history} k={f.key} band={ref[f.key]} />
            <div className="text-[10px] text-neutral-600 text-right">last 3 min · up = smaller / brighter · dotted = band medians</div>
          </section>
        );
      })}
      <p className="text-[11px] text-neutral-600 leading-relaxed mt-2">
        Reading this: compare changes within one session and one setup. Microphone, room and noise shift every
        absolute position by roughly a third to half of the spacing between the two bands (background noise
        pushes the three signal-processing readouts toward smaller/brighter), and isolated held vowels read
        less reliably than running speech. Reference bands: {ref?.source ?? "LibriSpeech test-clean"}.
        {s.perf?.dspMsPerAudioS != null && ` Lab cost here: ${s.perf.dspMsPerAudioS.toFixed(0)} ms CPU per s of audio (DSP)`}
        {s.perf?.pnmlInferMsMedian != null && `, ${s.perf.pnmlInferMsMedian.toFixed(0)} ms per model inference`}
        {s.perf?.dspMsPerAudioS != null && "."}
      </p>
    </div>
  );
}
