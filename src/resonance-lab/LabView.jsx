// LabView.jsx — the resonance lab view (lazy chunk; opening it starts the lab).
//
// A research instrument, not a coach: four calibration-free resonance
// readouts side by side on one neutral axis ("larger / darker" <->
// "smaller / brighter"), each with faint reference bands from recorded
// adult speakers, a settling / steadiness indicator, a 3-minute trace and a
// one-line description. No targets, no verdicts, no good/bad colours.
//
// Below Tailwind's sm breakpoint (phones in portrait) a compact layout keeps
// all four cards on screen at once: descriptions, footnotes and the lab's
// intro sit behind small info toggles, statuses and band labels shorten, and
// the axis and 3-minute trace are sized from the height actually available
// (see usePhoneFit); short screens drop the traces first. sm and up keeps the
// full layout.

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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

// Continuum geometry. FULL is the sm-and-up layout. Phones use ROOMY (same
// rows, short band labels) when the screen has height to spare, else COMPACT:
// the band labels sit beside their bands instead of on rows of their own, and
// bands + marker hug the axis.
const FULL = {
  h: 68, ax: 34, bandH: 7, menY: 20, womenY: 41, menLabelY: 15, womenLabelY: 59, tick: 14, r: 5, clamp: 8,
  men: "LibriSpeech adult men (test)", women: "LibriSpeech adult women (test)",
};
const ROOMY = { ...FULL, clamp: 5, men: "men", women: "women" };
const COMPACT = { h: 30, ax: 16, bandH: 5, menY: 4, womenY: 23, tick: 11, r: 4.5, beside: true, men: "men", women: "women" };

function Continuum({ band: ref, snap, g = FULL }) {
  // rows: men band above the axis, women band below; labels outside the bands
  // (above / below them, or beside them on the outer side when compact)
  const bandRow = (q, y, label, labelY, outerLeft) => {
    const a = x(toU(ref, q.q10)), b = x(toU(ref, q.q90)), m = x(toU(ref, q.q50));
    let text;
    if (g.beside) {
      const left = outerLeft ? a >= 12 : 100 - b < 12;
      text = { x: left ? a - 1.5 : b + 1.5, y: y + g.bandH / 2 + 3, anchor: left ? "end" : "start" };
    } else {
      text = { x: Math.min(100 - g.clamp, Math.max(g.clamp, m)), y: labelY, anchor: "middle" };
    }
    return (
      <g>
        <rect x={`${a}%`} y={y} width={`${Math.max(0.5, b - a)}%`} height={g.bandH} rx="2" className="fill-neutral-500/25" />
        <line x1={`${m}%`} x2={`${m}%`} y1={y} y2={y + g.bandH} className="stroke-neutral-400/70" strokeWidth="1" />
        <text x={`${text.x}%`} y={text.y} textAnchor={text.anchor} className="fill-neutral-500" fontSize="9">{label}</text>
      </g>
    );
  };
  const u = snap?.u;
  const j = snap?.jitter ?? 0;
  const settled = (snap?.fill ?? 0) >= 1;
  const AX = g.ax;
  return (
    <svg width="100%" height={g.h} className="block overflow-visible" data-lab-continuum="">
      {bandRow(ref.men, g.menY, g.men, g.menLabelY, true)}
      {bandRow(ref.women, g.womenY, g.women, g.womenLabelY, false)}
      <line x1="0%" x2="100%" y1={AX} y2={AX} className="stroke-neutral-700" strokeWidth="1" />
      {u !== null && u !== undefined && (
        <g opacity={settled ? 1 : 0.45}>
          <line x1={`${x(u - j)}%`} x2={`${x(u + j)}%`} y1={AX} y2={AX} className="stroke-neutral-200/60" strokeWidth="3" strokeLinecap="round" />
          <line x1={`${x(u)}%`} x2={`${x(u)}%`} y1={AX - g.tick} y2={AX + g.tick} className="stroke-neutral-100" strokeWidth="2" />
          <circle cx={`${x(u)}%`} cy={AX} r={g.r} className="fill-neutral-100" />
        </g>
      )}
    </svg>
  );
}

function Trace({ history, k, band: ref, height = 40 }) {
  const pts = history.filter((h) => h.u[k] !== null && h.u[k] !== undefined);
  if (pts.length < 2) return <div style={{ height }} />;
  const t1 = history[history.length - 1].t;
  const t0 = t1 - 180;
  const xs = (t) => ((t - t0) / 180) * 100;
  const ys = (u) => 38 - ((Math.min(U_MAX, Math.max(U_MIN, u)) - U_MIN) / (U_MAX - U_MIN)) * 36;
  const d = pts.map((p) => `${xs(p.t).toFixed(2)},${ys(p.u[k]).toFixed(2)}`).join(" ");
  const m0 = ys(toU(ref, ref.men.q50)), m1 = ys(toU(ref, ref.women.q50));
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height={height} className="block">
      <line x1="0" x2="100" y1={m0} y2={m0} className="stroke-neutral-600" strokeWidth="0.4" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2="100" y1={m1} y2={m1} className="stroke-neutral-600" strokeWidth="0.4" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
      <polyline points={d} fill="none" className="stroke-neutral-300" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const steadinessWord = (j) => (j < 0.15 ? "steady" : j < 0.35 ? "moving" : "unsettled");

function stability(snap) {
  if (!snap || snap.u === null) return "waiting for voiced speech";
  if (snap.fill < 1) return `settling — ${(snap.fill * 5).toFixed(1)} / 5 s of voicing`;
  if (snap.jitter === null) return "settled";
  const j = snap.jitter;
  return `${steadinessWord(j)} (±${j.toFixed(2)} of the men–women spacing)`;
}

// Phone wording of the same status (the ± unit is explained in the card's info).
function stabilityShort(snap) {
  if (!snap || snap.u === null) return "waiting for voice";
  if (snap.fill < 1) return `settling ${(snap.fill * 5).toFixed(1)}/5 s`;
  if (snap.jitter === null) return "settled";
  return `${steadinessWord(snap.jitter)} ±${snap.jitter.toFixed(2)}`;
}

function pnmlStatus(s) {
  if (s.pnml === "ready") return null;
  return s.pnml === "error" ? "model failed to load" : `loading model${s.pnmlProgress ? ` ${Math.round(s.pnmlProgress)}%` : "…"}`;
}

const Intro = () => (
  <>
    Four candidate resonance readouts, side by side, with no calibration. Each position is the
    last ~5 s of <em>voiced</em> speech and only moves while you are voicing. The faint bands show
    where recorded adult speakers fall; they are reference points, not targets — the axis works
    the same in either direction.
  </>
);

const ReadingNote = ({ s }) => (
  <>
    Reading this: compare changes within one session and one setup. Microphone, room and noise shift every
    absolute position by roughly a third to half of the spacing between the two bands (background noise
    pushes the three signal-processing readouts toward smaller/brighter), and isolated held vowels read
    less reliably than running speech. Reference bands: {s.reference?.source ?? "LibriSpeech test-clean"}.
    {s.perf?.dspMsPerAudioS != null && ` Lab cost here: ${s.perf.dspMsPerAudioS.toFixed(0)} ms CPU per s of audio (DSP)`}
    {s.perf?.pnmlInferMsMedian != null && `, ${s.perf.pnmlInferMsMedian.toFixed(0)} ms per model inference`}
    {s.perf?.dspMsPerAudioS != null && "."}
  </>
);

const PitchStat = ({ snap }) => (
  <span>
    Pitch {snap?.pitch ? `${Math.round(snap.pitch)} Hz` : "—"}
    {!snap?.pitch && snap?.lastPitch ? <span className="text-neutral-600"> (last {Math.round(snap.lastPitch)} Hz)</span> : null}
  </span>
);

// Tailwind's `max-sm` (below the 40rem sm breakpoint) as a live boolean.
const PHONE_QUERY = "(width < 40rem)";
const subscribePhone = (cb) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

export default function LabView() {
  const [s, setS] = useState(null);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  useEffect(() => subscribe(setS), []);
  // First open of the tab starts the lab (now if listening, else at the next start).
  useEffect(() => { requestResonanceLab(); }, []);
  if (!s) return null;
  return phone ? <PhoneLab s={s} /> : <FullLab s={s} />;
}

function FullLab({ s }) {
  const ref = s.reference;
  const snap = s.snapshot;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-3xl mx-auto px-1 pb-6">
      <div className="mb-3">
        <h2 className="text-base text-neutral-200 font-medium">Resonance lab <span className="text-neutral-500 font-normal text-xs">experimental</span></h2>
        <p className="text-xs text-neutral-500 leading-relaxed mt-1">
          <Intro />
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
          <PitchStat snap={snap} />
          <span>Voiced so far {snap ? `${snap.voicedS.toFixed(0)} s` : "—"}</span>
          {s.dsp !== "ready" && <span>{s.dsp === "error" ? `Lab error: ${s.error}` : "Loading lab…"}</span>}
          <button onClick={resetReadings} className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer">Reset readings</button>
          <button onClick={downloadReadings} className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer">Save readings (JSON)</button>
        </div>
      </div>
      {!s.running && <p className="text-sm text-neutral-500">Start listening to see the readouts.</p>}
      {ref && FINALISTS.map((f) => {
        const fs = snap?.finalists?.[f.key];
        const extra = f.key === "pnml" ? pnmlStatus(s) : null;
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
        <ReadingNote s={s} />
      </p>
    </div>
  );
}

// Small "i" toggle with a popover (same pattern as SteadinessReadout): tap to
// open, tap again / outside / Escape to close. The popover spans its nearest
// positioned ancestor (the row it belongs to) and opens toward whichever side
// of the lab's scroll area has more room, capped to that room.
function InfoToggle({ label, boundsRef, children }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ up: false, maxH: 320 });
  const wrapRef = useRef(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const row = wrapRef.current?.offsetParent?.getBoundingClientRect();
      const box = boundsRef.current?.getBoundingClientRect();
      if (row && box) {
        const below = box.bottom - row.bottom, above = row.top - box.top;
        const up = above > below;
        setPlace({ up, maxH: Math.max(96, Math.floor((up ? above : below) - 8)) });
      }
    }
    setOpen((o) => !o);
  };

  return (
    <span ref={wrapRef} className="flex">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={label}
        className="relative inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full border border-neutral-600 text-[10px] leading-none text-neutral-500 hover:text-neutral-300 hover:border-neutral-400 transition-colors cursor-pointer before:absolute before:-inset-2.5 before:content-['']"
      >
        i
      </button>
      {open && (
        <div
          id={tipId}
          role="note"
          style={{ maxHeight: place.maxH }}
          className={`absolute inset-x-0 z-20 ${place.up ? "bottom-full" : "top-full"} overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-xs leading-relaxed font-normal normal-case tracking-normal text-neutral-300 shadow-lg space-y-1.5`}
        >
          {children}
        </div>
      )}
    </span>
  );
}

// How much the phone layout can afford, measured against the lab's real scroll
// area (so it adapts to browser chrome, wrapped titles and text zoom). Each
// card's fixed parts (title row, axis labels) are measured as laid out; the
// continuum is ROOMY or COMPACT and the trace takes what is left, split four
// ways. Order of preference: ROOMY with a trace of at least ROOMY_TRACE_MIN,
// else COMPACT with a trace of at least TRACE_MIN, else COMPACT without traces
// (traces are the first thing short screens lose); if even that does not fit,
// the lab scrolls.
const TRACE_MIN = 20;
const ROOMY_TRACE_MIN = 32;
const TRACE_MAX = 56;
const TRACE_PAD = 2; // the trace wrapper's top padding (pt-0.5)
const FIT_SLACK = 2; // sub-pixel safety

function usePhoneFit(rootRef, contentRef) {
  const [fit, setFit] = useState({ roomy: false, traceH: 0 });
  useLayoutEffect(() => {
    const root = rootRef.current, content = contentRef.current;
    if (!root || !content) return undefined;
    const measure = () => {
      const sum = (sel) => [...content.querySelectorAll(sel)].reduce((t, el) => t + el.getBoundingClientRect().height, 0);
      const n = FINALISTS.length;
      const base = content.getBoundingClientRect().height - sum("[data-lab-trace]") - sum("[data-lab-continuum]");
      const traceFor = (g) => Math.floor((root.clientHeight - FIT_SLACK - base - n * g.h) / n) - TRACE_PAD;
      const roomyTrace = traceFor(ROOMY);
      const compactTrace = traceFor(COMPACT);
      const next = roomyTrace >= ROOMY_TRACE_MIN
        ? { roomy: true, traceH: Math.min(TRACE_MAX, roomyTrace) }
        : { roomy: false, traceH: compactTrace >= TRACE_MIN ? Math.min(TRACE_MAX, compactTrace) : 0 };
      setFit((prev) => (prev.roomy === next.roomy && prev.traceH === next.traceH ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(content);
    return () => ro.disconnect();
  }, [rootRef, contentRef]);
  return fit;
}

function PhoneLab({ s }) {
  const ref = s.reference;
  const snap = s.snapshot;
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const { roomy, traceH } = usePhoneFit(rootRef, contentRef);
  return (
    <div ref={rootRef} className="flex-1 min-h-0 overflow-y-auto w-full pb-0.5">
      <div ref={contentRef}>
        <div className="mb-1.5">
          <div className="relative flex items-center gap-2">
            <h2 className="text-sm leading-5 text-neutral-200 font-medium">Resonance lab <span className="text-neutral-500 font-normal text-xs">experimental</span></h2>
            <InfoToggle label="About the resonance lab" boundsRef={rootRef}>
              <p><Intro /></p>
              <p className="text-neutral-400"><ReadingNote s={s} /></p>
            </InfoToggle>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={resetReadings} aria-label="Reset readings" title="Reset readings" className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] leading-4 text-neutral-300 cursor-pointer">Reset</button>
              <button onClick={downloadReadings} aria-label="Save readings (JSON)" title="Save readings (JSON)" className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] leading-4 text-neutral-300 cursor-pointer">Save</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 text-[11px] leading-4 text-neutral-400">
            <PitchStat snap={snap} />
            <span>Voiced so far {snap ? `${snap.voicedS.toFixed(0)} s` : "—"}</span>
            {s.dsp !== "ready" && <span>{s.dsp === "error" ? `Lab error: ${s.error}` : "Loading lab…"}</span>}
          </div>
        </div>
        {!s.running && <p className="text-sm text-neutral-500 mb-1.5">Start listening to see the readouts.</p>}
        {ref && (
          <div className="flex flex-col gap-1">
            {FINALISTS.map((f) => {
              const fs = snap?.finalists?.[f.key];
              const extra = f.key === "pnml" ? pnmlStatus(s) : null;
              return (
                <section key={f.key} className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-2.5 py-1">
                  <div className="relative flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex items-baseline gap-1.5">
                      <h3 className="min-w-0 text-[13px] leading-[18px] text-neutral-200">{f.title}</h3>
                      <InfoToggle label={`About ${f.title}`} boundsRef={rootRef}>
                        <p>{f.what}</p>
                        <p className="text-neutral-400">
                          Bands: LibriSpeech adult men (test) above the axis, adult women (test) below — each
                          spans the 10th–90th percentile of speakers; the tick is the median.
                        </p>
                        <p className="text-neutral-400">± is how much the readout moved over the last ~3&nbsp;s, as a fraction of the men–women spacing.</p>
                        {traceH > 0 && <p className="text-neutral-400">Trace: last 3 min · up = smaller / brighter · dotted = band medians.</p>}
                      </InfoToggle>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-[11px] leading-[18px] text-neutral-500 tabular-nums">{extra ?? stabilityShort(fs)}</span>
                  </div>
                  <div className="flex justify-between text-[9px] leading-3 text-neutral-500 uppercase tracking-wide">
                    <span>larger / darker</span>
                    <span>smaller / brighter</span>
                  </div>
                  <Continuum g={roomy ? ROOMY : COMPACT} band={ref[f.key]} snap={fs} />
                  {traceH > 0 && (
                    <div data-lab-trace className="pt-0.5">
                      <Trace history={s.history} k={f.key} band={ref[f.key]} height={traceH} />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
