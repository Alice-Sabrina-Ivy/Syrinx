// CueStrip.jsx — the Dashboard's graded cues (Design A "cue strip",
// 2026-10-07): Pitch and Resonance · approx., each on one neutral axis
// (typically-men end on the left, with bands for typical adult speakers),
// a dot for the current value and a trail so movement is visible. The third
// row (Clarity · approx., CPP; "Vocal weight" until 2026-10-11) is HIDDEN
// since 2026-10-11 (user decision): the clarity study failed
// (measurements/clarity-cue-2026-10-08.md), so the strip shows no clarity or
// weight row until a measure passes its test, and the CPP pipeline behind it
// is retired (measurements/vocal-weight-pipeline-retire-2026-10-11.md). Answers "how do I come across" and "what to change" at a glance;
// replaces the Perceived-voice bar, the F2 readout and the stats row.
//
// Geometry, the direction highlight, colours, the trails, the row states,
// the header words and the screen-reader summaries are pure
// (cueStripModel.js, unit-tested). This file only lays them out: one inline
// SVG per row in pixel units (the strip measures its width) for the axis,
// bands, labels and trail; the dot is an HTML element over the SVG moved
// with a 200 ms CSS transform transition (composited — an SVG element's
// transition re-ran style + paint on the main thread every display frame,
// measurements/main-thread-cpu-2026-10-08.md); rows are memoised and
// re-rendered by one 250 ms tick (4 Hz; no canvas, no rAF). Rows expose data-cue / data-state /
// data-target-low|high for the smoke test, and each is a labelled group
// with a screen-reader summary refreshed once a second.
//
// Only the pitch dot is coloured on / off target (the F0 readout's rule),
// and off target it is also hollow and the row says "↑ higher" / "↓ lower"
// (not colour alone); resonance shows the direction as an outline only —
// its absolute position is approximate across microphones and rooms
// (measurements/resonance-cue-production-path-2026-10-07.md §8).
// Review fixes: measurements/cue-strip-review-fixes-2026-10-07.md.

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SteadinessReadout } from "./SteadinessReadout";
import { useInfoPopover } from "./useInfoPopover";
import {
  axisPos,
  bandsFor,
  createTrail,
  cueResonanceRef,
  cueSummary,
  dotColor,
  dotHollow,
  dotOpacity,
  NARROWBAND_INFO,
  highlightFor,
  cueRowStates,
  pitchCueWord,
  resonanceClamp,
  resonanceHeader,
  rowValue,
  ticks,
  trailOpacity,
  RESONANCE_TRAIL,
  TRAIL_EVERY_MS,
} from "./cueStripModel";
import { pitchStatus, pitchTargetFor } from "../utils/trainingDirection";
import { COLORS, statusTextClass } from "../utils/constants";

// Row geometry (px). Compact: phones and short landscape; roomy: desktop
// (read at arm's length from a laptop — bigger dots and labels).
// The end words ("lower" / "higher" …) sit on the axis row, the axis runs
// between them, so the band rows above / below are free for the band labels.
const COMPACT = { h: 33, menY: 3, bandH: 5, ax: 16, womenY: 24, fs: 10, r: 5, tr: 2.5 };
const ROOMY = { h: 58, menY: 8, bandH: 8, ax: 29, womenY: 42, fs: 12, r: 7, tr: 3.5 };
const PAD = 8; // px between an end word and the axis (room for a pinned dot + chevron)
const HALO = "#141414"; // the strip's background: a halo keeps labels legible over the highlight

// A number that keeps one width whatever it shows ("—" or digits): the widest
// text is laid out invisibly in the same grid cell, right-aligned, so nothing
// beside it shifts as the voice comes and goes (2026-10-19).
const Fixed = ({ widest, children, ...rest }) => (
  <span className="inline-grid justify-items-end whitespace-nowrap tabular-nums" {...rest}>
    {widest.map((t) => <span key={t} aria-hidden="true" className="invisible col-start-1 row-start-1">{t}</span>)}
    <span className="col-start-1 row-start-1">{children}</span>
  </span>
);

// The resonance lab's assets (one source of truth): fetched once. A failed
// fetch is not cached (it was cached as null until a page reload — 2026-10-19
// review S-2): the strip asks again when the resonance worker's status
// changes (it loads the same reference.json) and, while the worker is
// ready but the strip still has no reference, on a timer that backs off
// from 10 s to 80 s (review F2-2: a failure while the worker was already
// ready otherwise left the row at "starting…" until a reload).
const REF_RETRY_MS = 10000;
const REF_RETRY_MAX_MS = 80000;
let refPromise = null;
function loadReference() {
  if (!refPromise) {
    const get = (name) => fetch(`${import.meta.env.BASE_URL}resonance-lab/${name}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const p = Promise.all([get("reference.json"), get("cue-bands.json")])
      .then(([reference, cueBands]) => (reference ? { reference, cueBands } : null));
    refPromise = p;
    p.then((r) => { if (!r && refPromise === p) refPromise = null; });
  }
  return refPromise;
}

function useMedia(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

// Text width estimate for the SVG labels (tabular-free sans): used only to
// decide which side of a band its label goes.
const textW = (s, fs = 10) => s.length * fs * 0.56;

const PITCH_INFO =
  "Your speaking pitch over the last ~1.5 s — the level the target judges, shown by the dot and the number " +
  "(the trace above shows each moment). Off target the dot is hollow and the row says which way to go. " +
  "Bands: typical adult men's (85–155 Hz) and women's (165–255 Hz) average speaking pitch. The trail shows the last ~2 s.";
const RESONANCE_INFO =
  "Spectral warp: how stretched your voice's spectrum is compared with an average voice, from about your last " +
  "5 s of running speech (after a clear change, from the last ~1.5 s, so it catches up in about 3 s; held vowels and single words don't count). The ring marks where you started this " +
  "session (the middle of your first ~12 s of speech) and the header says how far you have moved from it — that change is what this cue measures reliably. " +
  "The dashed bands are where 8 in 10 single readings of 20 men and 20 women reading audiobooks on good " +
  "microphones fell, so even typical speakers' dots land outside their band about 1 time in 5. Your microphone, " +
  "room and distance shift the whole scale, so trust how the dot moves more than where it sits. What you say moves it too, so judge a change over " +
  "tens of seconds, not sentence by sentence. The trail shows the last ~30 s.";
function directionNote(cue, direction) {
  if (!direction || direction === "exploring") return null;
  if (cue === "pitch") {
    const t = pitchTargetFor(direction);
    return t ? `Your target (highlighted): ${t.low}–${t.high} Hz.` : null;
  }
  if (cue === "resonance") {
    return direction === "androgynous"
      ? "Highlighted: between typical men's and women's readings — an outline only, never judged, since the scale shifts with your setup."
      : `Highlighted: the typical ${direction === "feminine" ? "women's" : "men's"} band — an outline only, never judged, since the scale shifts with your setup.`;
  }
  return null;
}

// Small "i" toggle with a popover. The popover is a card fixed in the middle
// of the viewport (≤ 80 % of its height, scrolls inside): anchored to its row
// it ran off the bottom of short screens (360 × 690, 890 × 360 landscape).
// whitespace-normal: the header row the toggle sits in is nowrap.
const INFO_POPOVER_CLASS =
  "fixed z-40 inset-x-4 top-1/2 -translate-y-1/2 mx-auto max-w-md max-h-[80dvh] overflow-y-auto whitespace-normal break-words " +
  "rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-left text-xs lg:text-sm leading-relaxed font-normal normal-case " +
  "tracking-normal text-neutral-200 shadow-2xl shadow-black/70 space-y-1.5 outline-none";
function InfoToggle({ label, children }) {
  const { open, toggle, wrapRef, buttonRef, tipId, onBlur } = useInfoPopover();
  return (
    <span ref={wrapRef} className="inline-flex" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={label}
        className="relative ml-1 inline-flex items-center justify-center w-3.5 h-3.5 lg:w-4 lg:h-4 rounded-full border border-neutral-500 text-[9px] lg:text-[10px] leading-none text-neutral-400 hover:text-neutral-200 hover:border-neutral-300 transition-colors cursor-pointer before:absolute before:-inset-2 before:content-['']"
      >
        i
      </button>
      {open && (
        <div
          id={tipId}
          role="note"
          tabIndex={-1}
          data-cue-info=""
          className={INFO_POPOVER_CLASS}
        >
          {children}
        </div>
      )}
    </span>
  );
}

// Places a band label beside its band, outside it, without running into the
// end words of the bottom row. -> { x, anchor, text } | null
function placeLabel(band, text, W, { left, right, preferLeft, fs, endsLeftW = 0, endsRightW = 0 }) {
  if (!band) return null;
  const a = left(band.x0), b = right(band.x1);
  for (const t of [text, text.replace("typical ", "")]) {
    const w = textW(t, fs);
    const tryLeft = () => (a - 4 - w >= endsLeftW ? { x: a - 4, anchor: "end", text: t } : null);
    const tryRight = () => (b + 4 + w <= W - endsRightW ? { x: b + 4, anchor: "start", text: t } : null);
    const p = preferLeft ? tryLeft() ?? tryRight() : tryRight() ?? tryLeft();
    if (p) return p;
  }
  return null;
}

// SVG text with a halo in the strip's colour, so a label stays legible where
// it crosses the highlight, a band or the start ring.
function Label({ x, y, anchor = "start", fs, children }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={fs} className="fill-neutral-400"
      stroke={HALO} strokeWidth={3} strokeLinejoin="round" style={{ paintOrder: "stroke" }}>
      {children}
    </text>
  );
}

// The axis end words (module constants: stable props for the memoised rows).
const ENDS = { pitch: ["lower", "higher"], resonance: ["darker", "brighter"] };

// Memoised: every prop is a primitive or a stable object (CueStrip memoises
// bands, highlights, the info and pitch header elements; a trail array is
// replaced only when it changes), so a row re-renders only when its own
// inputs change (main-thread pass 2026-10-08).
const CueRow = memo(function CueRow({ cue, title, titleWord, info, headerRight, headerClass, valueClip = true, state, value, beyond, trail, color, hollow, bands, dashed, highlight, startX, ends, g, W, srText }) {
  const titleId = useId();
  const endW = [textW(ends[0], g.fs), textW(ends[1], g.fs)];
  const axL = endW[0] + PAD, axR = Math.max(axL + 1, W - endW[1] - PAD);
  const X = (f) => axL + f * (axR - axL);
  const showDot = dotOpacity(state);
  const ax = g.ax;
  // Labels on the OUTER side of their band (men's left, women's right), on
  // the band rows — they may run above / below an end word (other row);
  // the inner side only when the outer side would leave the card.
  const keep = { left: X, right: X, fs: g.fs };
  const menLabel = bands ? placeLabel(bands.men, "typical men", W, { ...keep, preferLeft: true }) : null;
  const womenLabel = bands ? placeLabel(bands.women, "typical women", W, { ...keep, preferLeft: false }) : null;
  const dotPos = showDot !== null && value !== null && value !== undefined ? axisPos(cue, value, { clamp: beyond }) : null;
  return (
    <div
      className="relative"
      role="group"
      aria-labelledby={titleId}
      data-cue={cue}
      data-state={state}
      data-dot={dotPos ? "1" : "0"}
      data-hollow={dotPos && hollow ? "1" : "0"}
      data-trail={trail.length}
      data-value={value === null || value === undefined ? "" : String(Math.round(value * 1000) / 1000)}
      {...(highlight ? { "data-target-low": String(Math.round(highlight.low * 1000) / 1000), "data-target-high": String(Math.round(highlight.high * 1000) / 1000) } : {})}
    >
      <div className="flex items-center justify-between gap-2 h-[18px] lg:h-6 text-[11px] lg:text-[13px] leading-[18px] lg:leading-6 whitespace-nowrap">
        <span className="inline-flex items-center text-neutral-300 font-medium min-w-0">
          {/* The title and its "i" never shrink, so the "i" stays put whatever
              the value beside it says; the direction word after it, then the
              text value, give way first. */}
          <span className="shrink-0" id={titleId} data-cue-title="">{title}</span>
          <InfoToggle label={`About the ${cue} cue`}>{info}</InfoToggle>
          {titleWord && <span className="ml-1.5 min-w-0 overflow-x-clip text-ellipsis font-normal text-neutral-300" data-cue-word="">· {titleWord}</span>}
        </span>
        {/* Text values ellipsize; the pitch value (number + steadiness + its "i",
            whose enlarged hit area overhangs) is short and never clipped. */}
        <span className={`${valueClip ? "min-w-0 overflow-x-clip text-ellipsis" : "shrink-0"} tabular-nums ${headerClass}`} data-cue-value="">{headerRight}</span>
      </div>
      <span className="sr-only" data-cue-sr="">{srText}</span>
      {W > 0 && (
        <div className="relative" style={{ height: g.h }}>
        <svg width={W} height={g.h} className="block overflow-visible" aria-hidden="true">
          {highlight && (
            <rect
              data-cue-highlight=""
              x={X(highlight.x0)}
              y={0.5}
              width={Math.max(1, X(highlight.x1) - X(highlight.x0))}
              height={g.h - 1}
              rx={highlight.style.rx}
              fill={highlight.style.fill}
              stroke={highlight.style.stroke}
              strokeWidth={highlight.style.strokeWidth}
            />
          )}
          {bands && [[bands.men, g.menY], [bands.women, g.womenY]].map(([b, y], i) => (
            <g key={i} data-cue-band="">
              {/* ≥ 3:1 against the strip: a neutral-400 outline (dashed for
                  the approximate resonance bands) over a light fill. */}
              <rect x={X(b.x0)} y={y} width={Math.max(1, X(b.x1) - X(b.x0))} height={g.bandH} rx="2"
                className={dashed ? "fill-neutral-500/15 stroke-neutral-400" : "fill-neutral-500/35 stroke-neutral-400"}
                strokeWidth="1" strokeDasharray={dashed ? "3 2" : undefined} />
              <line x1={X(b.xm)} x2={X(b.xm)} y1={y} y2={y + g.bandH} className="stroke-neutral-300" strokeWidth="1" />
            </g>
          ))}
          {menLabel && <Label x={menLabel.x} y={g.menY + g.bandH / 2 + g.fs * 0.35} anchor={menLabel.anchor} fs={g.fs}>{menLabel.text}</Label>}
          {womenLabel && <Label x={womenLabel.x} y={g.womenY + g.bandH / 2 + g.fs * 0.35} anchor={womenLabel.anchor} fs={g.fs}>{womenLabel.text}</Label>}
          <line x1={X(0)} x2={X(1)} y1={ax} y2={ax} className="stroke-neutral-500" strokeWidth="1" />
          {ticks(cue).map((t) => (
            <line key={t.v} x1={X(t.x)} x2={X(t.x)} y1={ax - 2} y2={ax + 2} className="stroke-neutral-500" strokeWidth="1" />
          ))}
          <Label x={0} y={ax + g.fs * 0.35} anchor="start" fs={g.fs}>{ends[0]}</Label>
          <Label x={W} y={ax + g.fs * 0.35} anchor="end" fs={g.fs}>{ends[1]}</Label>
          {startX !== null && startX !== undefined && (
            <>
              {dotPos && (
                <line x1={X(startX)} x2={X(dotPos.x)} y1={ax} y2={ax} stroke={color} strokeOpacity={0.55} strokeWidth="2" data-cue-change="" />
              )}
              <circle cx={0} cy={ax} r={g.r} fill="none" className="stroke-neutral-300" strokeWidth="1.25"
                style={{ transform: `translateX(${X(startX)}px)` }} data-cue-start="" />
            </>
          )}
          {trail.map((v, i) => {
            const p = axisPos(cue, v);
            return p ? (
              <circle key={i} cx={0} cy={ax} r={g.tr} fill={color} opacity={trailOpacity(i, trail.length)}
                style={{ transform: `translateX(${X(p.x)}px)` }} />
            ) : null;
          })}
          {dotPos && (() => {
            const x = X(dotPos.x);
            return (
              <g data-cue-dot="">
                {dotPos.beyond !== 0 && (
                  <path d={dotPos.beyond > 0 ? `M ${x + g.r + 2} ${ax - 4} l 4 4 l -4 4` : `M ${x - g.r - 2} ${ax - 4} l -4 4 l 4 4`}
                    fill="none" stroke={color} strokeWidth="1.5" opacity={showDot} />
                )}
              </g>
            );
          })()}
        </svg>
        {/* The dot: an HTML element over the SVG, same geometry as the SVG
            circle it replaced (radius g.r; hollow = a 1.5 px ring), so its
            200 ms transform transition runs on the compositor — an SVG
            element's transition runs on the main thread at the display
            rate (measurements/main-thread-cpu-2026-10-08.md). No transition
            under prefers-reduced-motion: the dot jumps (review N-7). */}
        {dotPos && (
          <span
            data-cue-dot-mark=""
            aria-hidden="true"
            className="absolute left-0 rounded-full box-border pointer-events-none motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
            style={{
              top: ax - g.r,
              width: 2 * g.r,
              height: 2 * g.r,
              background: hollow ? HALO : color,
              border: hollow ? `1.5px solid ${color}` : "none",
              opacity: showDot,
              transform: `translateX(${X(dotPos.x) - g.r}px)`,
              willChange: "transform",
            }}
          />
        )}
        </div>
      )}
    </div>
  );
});

export function CueStrip({
  direction = null,
  voiced,
  holding,
  // The pitch display's voiced flags (the voice gate's mask): both rows and
  // the caption read these (cueRowStates; the resonance row since
  // 2026-10-21). voiced / holding are only their defaults.
  pitchVoiced = voiced,
  pitchHolding = holding,
  pitch,
  pitchLevel,
  steadiness,
  steadinessHeld,
  hnr,
  resonanceRef,
  resonanceStatus,
  shortLandscape = false,
}) {
  const roomy = useMedia("(min-width: 1024px) and (min-height: 600px)");
  const g = roomy ? ROOMY : COMPACT;
  const wrapRef = useRef(null);
  const [W, setW] = useState(0);
  const [assets, setAssets] = useState(null);
  // What the 4 Hz tick saw: the resonance worker's latest state, each row's
  // trail and (once a second) the screen-reader summaries. Render reads only
  // this, never the refs.
  const [view, setView] = useState({ snap: null, trails: { pitch: [], resonance: [] }, everVoiced: false, sr: {} });
  const latest = useRef(null);
  useEffect(() => { latest.current = { pitchVoiced, pitchHolding, pitchLevel, resonanceStatus, direction }; });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    // Inner width (the padding differs between compact and roomy).
    const measure = () => {
      const cs = getComputedStyle(el);
      setW(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0")));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (assets) return undefined;
    let alive = true;
    let timer = null;
    let wait = REF_RETRY_MS;
    const attempt = () => {
      loadReference().then((r) => {
        if (!alive) return;
        if (r) { setAssets(r); return; }
        if (resonanceStatus !== "ready") return; // a status change retries
        timer = setTimeout(attempt, wait);
        wait = Math.min(wait * 2, REF_RETRY_MAX_MS);
      });
    };
    attempt();
    return () => { alive = false; clearTimeout(timer); };
  }, [assets, resonanceStatus]);

  const vtlnRef = useMemo(() => (assets?.reference?.vtln ? cueResonanceRef(assets.reference.vtln, assets.cueBands) : null), [assets]);

  // One 4 Hz tick: sample each row's value into its trail while live; the
  // screen-reader summaries every 4th tick (1 Hz).
  useEffect(() => {
    const t = { pitch: createTrail(), resonance: createTrail(RESONANCE_TRAIL.n, RESONANCE_TRAIL.everyTicks) };
    let ever = false;
    let n = 0;
    let sr = {};
    const ref = assets?.reference?.vtln ? cueResonanceRef(assets.reference.vtln, assets.cueBands) : null;
    const id = setInterval(() => {
      const p = latest.current;
      if (!p) return;
      const snap = resonanceRef?.current ?? null;
      if (p.pitchVoiced) ever = true;
      const inputs = { ...p, snap, workerStatus: p.resonanceStatus };
      const states = cueRowStates({ ...inputs, hasRef: !!ref });
      if (n++ % 4 === 0) {
        sr = {
          pitch: cueSummary("pitch", { state: states.pitch, direction: p.direction, pitchLevel: p.pitchLevel }),
          resonance: cueSummary("resonance", { state: states.resonance, snap, vtlnRef: ref }),
        };
      }
      setView({
        snap,
        everVoiced: ever,
        sr,
        trails: {
          pitch: t.pitch.tick(states.pitch, rowValue("pitch", inputs)),
          resonance: t.resonance.tick(states.resonance, rowValue("resonance", inputs)),
        },
      });
    }, TRAIL_EVERY_MS);
    return () => clearInterval(id);
  }, [resonanceRef, assets]);

  const snap = view.snap;
  const inputs = { pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus: resonanceStatus };
  const { pitch: pState, resonance: rState } = cueRowStates({ ...inputs, hasRef: !!vtlnRef });
  // The header number IS the dot: the 1.5 s level the target judges.
  const levelStatus = pitchLevel != null ? pitchStatus(pitchLevel, pitchTargetFor(direction)) : null;
  const rClamp = resonanceClamp(snap);
  const rValue = rowValue("resonance", inputs);
  const pitchWord = pState !== "idle" && pitchLevel != null ? pitchCueWord(pitchLevel, direction) : null;
  void pitch; // the moment-to-moment value lives in the trace above

  // Stable row props (the rows are memoised): bands / highlights / info
  // follow the direction and the reference assets only; the pitch header
  // follows its own values.
  const pitchBands = useMemo(() => bandsFor("pitch"), []);
  const resonanceBands = useMemo(() => (vtlnRef ? bandsFor("resonance", vtlnRef) : null), [vtlnRef]);
  const pitchHighlight = useMemo(() => highlightFor("pitch", direction), [direction]);
  const resonanceHighlight = useMemo(() => (vtlnRef ? highlightFor("resonance", direction, vtlnRef) : null), [direction, vtlnRef]);
  const pitchInfo = useMemo(() => <><p>{PITCH_INFO}</p>{directionNote("pitch", direction) && <p>{directionNote("pitch", direction)}</p>}</>, [direction]);
  // Phone-quality audio: the reason the row is paused comes first.
  const rNarrow = rState === "narrowband";
  const resonanceInfo = useMemo(() => <>{rNarrow && <p data-cue-narrowband-info="">{NARROWBAND_INFO}</p>}<p>{RESONANCE_INFO}</p>{directionNote("resonance", direction) && <p>{directionNote("resonance", direction)}</p>}</>, [direction, rNarrow]);
  const pitchHeader = useMemo(() => (
    <span className="inline-flex items-baseline gap-2">
      <span className={`text-sm lg:text-base leading-[18px] lg:leading-6 font-light ${pitchLevel != null ? statusTextClass(levelStatus) : "text-neutral-400"}`} data-cue-f0="">
        <Fixed widest={["000"]}>{pitchLevel != null ? Math.round(pitchLevel) : "—"}</Fixed>
        <span className="text-[10px] lg:text-xs text-neutral-400 ml-0.5">Hz</span>
      </span>
      <SteadinessReadout value={steadiness} held={steadinessHeld} variant="compact" />
    </span>
  ), [pitchLevel, levelStatus, steadiness, steadinessHeld]);

  return (
    <div
      ref={wrapRef}
      data-cue-strip=""
      className="w-full rounded-xl bg-neutral-900/60 border border-neutral-800 p-2 lg:p-3 flex flex-col gap-1 lg:gap-2"
    >
      <CueRow
        cue="pitch"
        title="Pitch"
        titleWord={pitchWord}
        info={pitchInfo}
        headerRight={pitchHeader}
        headerClass=""
        valueClip={false}
        state={pState}
        value={rowValue("pitch", inputs)}
        beyond={0}
        trail={view.trails.pitch}
        color={dotColor("pitch", { pitchLevel, direction })}
        hollow={dotHollow("pitch", { pitchLevel, direction })}
        bands={pitchBands}
        highlight={pitchHighlight}
        ends={ENDS.pitch}
        g={g}
        W={W}
        srText={view.sr.pitch}
      />
      <CueRow
        cue="resonance"
        title="Resonance · approx."
        info={resonanceInfo}
        headerRight={resonanceHeader(rState, snap)}
        headerClass="text-neutral-300"
        state={rState}
        value={rValue}
        beyond={rClamp}
        trail={view.trails.resonance}
        color={COLORS.neutralTrace}
        bands={resonanceBands}
        dashed
        highlight={resonanceHighlight}
        startX={!rNarrow && snap?.startU != null ? axisPos("resonance", snap.startU)?.x : null}
        ends={ENDS.resonance}
        g={g}
        W={W}
        srText={view.sr.resonance}
      />
      {!shortLandscape && (
        <div className="flex items-start justify-between gap-2 text-[10px] lg:text-xs leading-[14px] lg:leading-4 text-neutral-400" data-cue-caption="">
          <span className="min-w-0">
            {view.everVoiced || pitchVoiced ? "Dots follow your recent speech · bands: typical adult speakers" : "Start speaking — the dots follow your recent speech"}
          </span>
          <span className="shrink-0" data-cue-hnr="">
            <Fixed widest={["HNR -00 dB"]}>HNR {hnr !== null && hnr !== undefined ? `${Math.round(hnr)} dB` : "—"}</Fixed>
          </span>
        </div>
      )}
    </div>
  );
}
