// CueStrip.jsx — the Dashboard's graded cues: Pitch and Resonance · approx.
// as TWIN VERTICAL COLUMNS side by side (the owner's "Twin columns" pick,
// 2026-10-25; one horizontal row per cue — Design A "cue strip", 2026-10-07 —
// until then). Each column is a meter with low / darker at the bottom and
// high / brighter at the top, the typical men's and women's ranges as soft
// bands up the column, the target as an outlined band, a thumb for the
// current value that slides, a short streak for the recent trail, and the
// value + status beside it. The third cue (Clarity · approx., CPP; "Vocal
// weight" until 2026-10-11) is HIDDEN since 2026-10-11 (user decision): the
// clarity study failed (measurements/clarity-cue-2026-10-08.md), so the strip
// shows no clarity or weight cue until a measure passes its test, and the CPP
// pipeline behind it is retired
// (measurements/vocal-weight-pipeline-retire-2026-10-11.md). Answers "how do I
// come across" and "what to change" at a glance; replaces the Perceived-voice
// bar, the F2 readout and the stats row.
//
// Geometry along each meter (pitch on the log scale, resonance on its u
// axis), the direction highlight, colours, the trails, the cue states, the
// status words and the screen-reader summaries are pure (cueStripModel.js,
// unit-tested) and unchanged by the column layout — only the orientation and
// the styling changed. This file only lays them out: one inline SVG per
// column in pixel units (the column measures its own box) for the track,
// bands, labels, start ring and trail; the thumb is an HTML element over the
// SVG moved with a 200 ms CSS transform transition (composited — an SVG
// element's transition re-ran style + paint on the main thread every display
// frame, measurements/main-thread-cpu-2026-10-08.md); columns are memoised
// and re-rendered by one 250 ms tick (4 Hz; no canvas, no rAF). Each column
// exposes data-cue / data-state / data-dot / data-hollow / data-trail /
// data-value / data-target-low|high for the smoke test, and is a labelled
// group with a screen-reader summary refreshed once a second.
//
// Only the pitch thumb is coloured on / off target (the F0 readout's rule),
// and off target it is also hollow and the column says "↑ higher" / "↓ lower"
// (not colour alone); resonance stays neutral (lavender, never judged) and
// shows the direction as an outline only — its absolute position is
// approximate across microphones and rooms
// (measurements/resonance-cue-production-path-2026-10-07.md §8); its words
// say how far you moved from where you started.
// Review fixes: measurements/cue-strip-review-fixes-2026-10-07.md.
//
// Sizes: every box has a fixed reserved size (nothing moves while speaking):
// phones (portrait) give each meter clamp(150px, 74dvh − 285px, 232px), so the
// trace and both columns fit the first screen from 448 × 890 down to
// 360 × 690; short landscape lets the meters fill the height beside the
// trace; desktop (lg) a taller meter, clamp(180px, 100dvh − 620px, 300px), so
// the strip and the heard-as dome under it fit the right-hand column without
// scrolling from 1280 × 800 up (280 px at 1440 × 900). The meter's
// own geometry (track width, label and number sizes) follows its measured
// width in four tiers.

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
  trailOpacity,
  RESONANCE_TRAIL,
  TRAIL_EVERY_MS,
} from "./cueStripModel";
import { pitchStatus, pitchTargetFor } from "../utils/trainingDirection";
import { COLORS, statusTextClass } from "../utils/constants";

const HALO = "#141414"; // the strip's background: rings the thumb, fills a hollow one
const TRACK_STROKE = "#333333";
const OVERHANG = 7; // px the thumb reaches past the track on each side (the target outline: 6)

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
// ready otherwise left the cue at "starting…" until a reload).
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

// Text width of the SVG labels: measured with a canvas in the page's font
// (an estimate where no canvas is available).
let measureCtx = null;
function textWidth(s, fs, weight = 400) {
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${weight} ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return measureCtx.measureText(s).width;
  } catch {
    return s.length * fs * 0.56;
  }
}

const PITCH_INFO =
  "Your speaking pitch over the last ~1.5 s — the level the target judges, shown by the marker and the number " +
  "(the trace above shows each moment). Off target the marker is hollow and the meter says which way to go. " +
  "Bands: typical adult men's (85–155 Hz) and women's (165–255 Hz) average speaking pitch. The streak shows the last ~2 s.";
const RESONANCE_INFO =
  "Spectral warp: how stretched your voice's spectrum is compared with an average voice, from about your last " +
  "5 s of running speech (after a clear change, from the last ~1.5 s, so it catches up in about 3 s; held vowels and single words don't count). The ring marks where you started this " +
  "session (the middle of your first ~12 s of speech) and the words beside the meter say how far you have moved from it — that change is what this cue measures reliably. " +
  "The dashed bands are where 8 in 10 single readings of 20 men and 20 women reading audiobooks on good " +
  "microphones fell, so even typical speakers' readings land outside their band about 1 time in 5. Your microphone, " +
  "room and distance shift the whole scale, so trust how the marker moves more than where it sits. What you say moves it too, so judge a change over " +
  "tens of seconds, not sentence by sentence. The streak shows the last ~30 s.";
function directionNote(cue, direction) {
  if (!direction || direction === "exploring") return null;
  if (cue === "pitch") {
    const t = pitchTargetFor(direction);
    return t ? `Your target (outlined): ${t.low}–${t.high} Hz.` : null;
  }
  if (cue === "resonance") {
    return direction === "androgynous"
      ? "Outlined: between typical men's and women's readings — an outline only, never judged, since the scale shifts with your setup."
      : `Outlined: the typical ${direction === "feminine" ? "women's" : "men's"} band — an outline only, never judged, since the scale shifts with your setup.`;
  }
  return null;
}

// Small "i" toggle with a popover. The popover is a card fixed in the middle
// of the viewport (≤ 80 % of its height, scrolls inside): anchored to its
// column it ran off the bottom of short screens (360 × 690, 890 × 360
// landscape). whitespace-normal: the header row the toggle sits in is
// nowrap. The hit area is 44 px (the ::before overhang).
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
        className="relative ml-1.5 inline-flex items-center justify-center w-3.5 h-3.5 lg:w-4 lg:h-4 rounded-full border border-neutral-500 text-[9px] lg:text-[10px] leading-none text-neutral-400 hover:text-neutral-200 hover:border-neutral-300 transition-colors cursor-pointer before:absolute before:-inset-[15px] lg:before:-inset-[14px] before:content-['']"
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

// ---- one meter's geometry, from its measured box (px). Four width tiers:
// desktop (roomy), >= 180 px (448-wide phones), >= 156 px (402), narrower
// (360: single-word band labels). The value along the meter follows
// axisPos() (cueStripModel.js): fraction 0 at the bottom, 1 at the top.
const LABEL_WORDS = { full: ["typical", "women", "men"], short: ["women", "men"] };
function meterGeometry(w, h, roomy) {
  const tier = roomy ? 3 : w >= 180 ? 2 : w >= 156 ? 1 : 0;
  const fs = [10, 11, 11, 12][tier];
  const trackW = [24, 28, 32, 36][tier];
  const short = tier === 0;
  const labelW = Math.ceil(Math.max(textWidth("target", fs, 600), ...LABEL_WORDS[short ? "short" : "full"].map((t) => textWidth(t, fs))));
  const trackX = labelW + 5 + OVERHANG;
  const endH = fs + 7; // the end word above / below the track
  const trackTop = endH;
  const trackBot = Math.max(trackTop + 40, h - endH);
  // The axis stops short of the pill's rounded caps, so a thumb pinned at an
  // end stays inside the track's outline.
  const inset = Math.max(9, trackW / 2 - 3);
  const axisTop = trackTop + inset, axisBot = trackBot - inset;
  return {
    tier, fs, lh: fs + 2, short, labelW, trackW, trackX, trackCx: trackX + trackW / 2,
    svgW: trackX + trackW + OVERHANG, trackTop, trackBot,
    y: (f) => axisBot - f * (axisBot - axisTop),
    thumbW: trackW + 2 * OVERHANG, thumbH: roomy ? 16 : 14,
    numFs: [22, 26, 30, 34][tier], subFs: [11, 12, 12, 13][tier], resFs: [12, 13, 14, 15][tier],
  };
}

// Band labels beside the track (left of it, right-aligned), centred on their
// band and pushed apart where they would touch; the target's label merges
// with the band it coincides with ("target / typical / women"), else sits
// on its own. Falls back to single-word labels when the full ones do not
// fit the track's height. -> [{ key, top, lines: [{ t, strong }] }]
function stackLabels(items, top, bottom, lh) {
  const s = items.map((it) => ({ ...it, h: it.lines.length * lh })).sort((a, b) => a.cy - b.cy);
  let y = top;
  for (const it of s) { it.top = Math.max(it.cy - it.h / 2, y); y = it.top + it.h + 3; }
  let limit = bottom;
  for (let i = s.length - 1; i >= 0; i--) { if (s[i].top + s[i].h > limit) s[i].top = limit - s[i].h; limit = s[i].top - 3; }
  const fits = s.every((it, i) => it.top >= top - 0.5 && (i === 0 || it.top >= s[i - 1].top + s[i - 1].h + 2));
  return { items: s, fits };
}
function bandLabels(G, bands, highlight) {
  const mid = (b) => G.y((b.x0 + b.x1) / 2);
  const same = (b) => !!highlight && !!b && Math.abs(b.x0 - highlight.x0) < 0.005 && Math.abs(b.x1 - highlight.x1) < 0.005;
  const build = (short) => {
    const items = [];
    let merged = false;
    for (const who of ["women", "men"]) {
      const b = bands?.[who];
      if (!b) continue;
      const tgt = same(b);
      merged ||= tgt;
      items.push({ key: who, cy: mid(b), lines: [...(tgt ? [{ t: "target", strong: true }] : []), ...(short ? [who] : ["typical", who]).map((t) => ({ t }))] });
    }
    if (highlight && !merged) items.push({ key: "target", cy: mid(highlight), lines: [{ t: "target", strong: true }] });
    return stackLabels(items, G.trackTop, G.trackBot, G.lh);
  };
  const full = G.short ? null : build(false);
  return full?.fits ? full.items : build(true).items;
}

function useBoxSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// The axis end words (module constants: stable props for the memoised
// columns): [bottom, top].
const ENDS = { pitch: ["lower", "higher"], resonance: ["darker", "brighter"] };

// Memoised: every prop is a primitive or a stable object (CueStrip memoises
// bands, highlights, the info and the pitch value block; a trail array is
// replaced only when it changes), so a column re-renders only when its own
// inputs change (main-thread pass 2026-10-08).
const CueColumn = memo(function CueColumn({ cue, title, titleNote, info, side, sideClass = "", state, value, beyond, trail, color, hollow, bands, dashed, highlight, startX, ends, roomy, srText }) {
  const titleId = useId();
  const gradId = useId();
  const areaRef = useRef(null);
  const { w, h } = useBoxSize(areaRef);
  const G = useMemo(() => (w > 0 && h > 0 ? meterGeometry(w, h, roomy) : null), [w, h, roomy]);
  const labels = useMemo(() => (G ? bandLabels(G, bands, highlight) : []), [G, bands, highlight]);
  const showDot = dotOpacity(state);
  const dotPos = showDot !== null && value !== null && value !== undefined ? axisPos(cue, value, { clamp: beyond }) : null;
  const band = (b) => ({ y0: G.y(b.x1), y1: G.y(b.x0) });
  // The value block beside the meter: one fixed top (it never follows the
  // thumb), so nothing in it moves while speaking.
  const sideTop = G ? Math.max(0, Math.round(h / 2 - (G.numFs + 40) / 2)) : 0;
  return (
    <div
      className="relative flex flex-col gap-1.5 shortland:gap-1 min-w-0 min-h-0"
      role="group"
      aria-labelledby={titleId}
      data-cue={cue}
      data-state={state}
      data-dot={dotPos ? "1" : "0"}
      data-hollow={dotPos && hollow ? "1" : "0"}
      data-trail={trail.length}
      data-value={value === null || value === undefined ? "" : String(Math.round(value * 1000) / 1000)}
      {...(highlight ? { "data-target-low": String(Math.round(highlight.low * 1000) / 1000), "data-target-high": String(Math.round(highlight.high * 1000) / 1000) } : {})}
      style={G ? { "--cue-num": `${G.numFs}px`, "--cue-sub": `${G.subFs}px`, "--cue-res": `${G.resFs}px` } : undefined}
    >
      <div className="flex items-center h-[22px] text-xs min-[400px]:text-[13px] lg:text-sm leading-[22px] whitespace-nowrap">
        {/* The title and its "i" never shrink, so the "i" stays put. */}
        <span className="shrink-0 text-neutral-300 font-medium" id={titleId} data-cue-title="">
          {title}{titleNote && <span className="font-normal text-neutral-400"> · {titleNote}</span>}
        </span>
        <InfoToggle label={`About the ${cue} cue`}>{info}</InfoToggle>
      </div>
      <span className="sr-only" data-cue-sr="">{srText}</span>
      <div
        ref={areaRef}
        className="relative h-[clamp(150px,calc(74dvh-285px),232px)] lg:h-[clamp(180px,calc(100dvh-620px),300px)] shortland:h-auto shortland:flex-1 shortland:min-h-0"
        data-cue-meter=""
      >
        {G && (
          <svg width={G.svgW} height={h} className="absolute left-0 top-0 block overflow-visible" aria-hidden="true">
            <defs>
              {/* darker at the bottom, lighter at the top (the "lower / darker"
                  end is down) */}
              <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#111111" />
                <stop offset="1" stopColor="#2c2c2c" />
              </linearGradient>
            </defs>
            <text x={G.trackCx} y={G.fs} textAnchor="middle" fontSize={G.fs} className="fill-neutral-400" data-cue-end="top">{ends[1]}</text>
            <rect data-cue-track="" x={G.trackX} y={G.trackTop} width={G.trackW} height={G.trackBot - G.trackTop} rx={G.trackW / 2}
              fill={`url(#${gradId})`} stroke={TRACK_STROKE} strokeWidth="1" />
            {bands && ["men", "women"].map((k) => {
              const b = bands[k];
              if (!b) return null;
              const { y0, y1 } = band(b);
              return (
                <g key={k} data-cue-band={k}>
                  {/* ≥ 3:1 against the strip: a neutral-400 outline (dashed for
                      the approximate resonance bands) over a light fill. */}
                  <rect x={G.trackX + 3} y={y0} width={G.trackW - 6} height={Math.max(1, y1 - y0)} rx="3"
                    className={dashed ? "fill-neutral-500/15 stroke-neutral-400" : "fill-neutral-500/35 stroke-neutral-400"}
                    strokeWidth="1" strokeDasharray={dashed ? "3 2" : undefined} />
                  {/* the typical speaker */}
                  <line x1={G.trackX + 3} x2={G.trackX + G.trackW - 3} y1={G.y(b.xm)} y2={G.y(b.xm)} className="stroke-neutral-300" strokeWidth="1" />
                </g>
              );
            })}
            {highlight && (() => {
              const { y0, y1 } = band(highlight);
              return (
                <rect
                  data-cue-highlight=""
                  x={G.trackX - 6}
                  y={y0}
                  width={G.trackW + 12}
                  height={Math.max(1, y1 - y0)}
                  rx={highlight.style.rx}
                  fill={highlight.style.fill}
                  stroke={highlight.style.stroke}
                  strokeWidth={highlight.style.strokeWidth}
                />
              );
            })()}
            {labels.map((l) => (
              <text key={l.key} textAnchor="end" fontSize={G.fs} data-cue-label={l.key}>
                {l.lines.map((ln, i) => (
                  <tspan key={i} x={G.labelW} y={l.top + i * G.lh + G.fs * 0.82}
                    className={ln.strong ? "fill-green-400" : "fill-neutral-400"} fontWeight={ln.strong ? 600 : undefined}>{ln.t}</tspan>
                ))}
              </text>
            ))}
            {startX !== null && startX !== undefined && (
              <>
                {dotPos && (
                  <line x1={G.trackCx} x2={G.trackCx} y1={G.y(startX)} y2={G.y(dotPos.x)} stroke={color} strokeOpacity={0.55} strokeWidth="2" data-cue-change="" />
                )}
                <circle cx={G.trackCx} cy={0} r={roomy ? 6 : 5} fill="none" className="stroke-neutral-300" strokeWidth="1.25"
                  style={{ transform: `translateY(${G.y(startX)}px)` }} data-cue-start="" />
              </>
            )}
            {/* The streak: the recent values as faint marks along the track,
                oldest faintest (where the voice dwelt, they merge). */}
            {trail.map((v, i) => {
              const p = axisPos(cue, v);
              return p ? (
                <rect key={i} x={G.trackX + 5} y={-2} width={G.trackW - 10} height="4" rx="2" fill={color} opacity={trailOpacity(i, trail.length)}
                  style={{ transform: `translateY(${G.y(p.x)}px)` }} />
              ) : null;
            })}
            <text x={G.trackCx} y={h - 2} textAnchor="middle" fontSize={G.fs} className="fill-neutral-400" data-cue-end="bottom">{ends[0]}</text>
          </svg>
        )}
        {/* The thumb: an HTML element over the SVG so its 200 ms transform
            transition runs on the compositor — an SVG element's transition
            runs on the main thread at the display rate
            (measurements/main-thread-cpu-2026-10-08.md). Hollow = a 1.5 px
            ring (off target). A chevron inside it when the value is pinned
            at an end of the scale. Its colours are inline backgrounds, kept
            as authored under Windows high contrast (forced-color-adjust:
            none), where they would otherwise be flattened to the page
            colour. No transition under prefers-reduced-motion: the thumb
            jumps (review N-7). */}
        {G && dotPos && (
          <span
            data-cue-dot-mark=""
            aria-hidden="true"
            className="absolute left-0 top-0 flex items-center justify-center rounded-full box-border pointer-events-none forced-color-adjust-none motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
            style={{
              width: G.thumbW,
              height: G.thumbH,
              background: hollow ? HALO : color,
              border: hollow ? `1.5px solid ${color}` : "none",
              boxShadow: `0 0 0 2px ${HALO}`,
              opacity: showDot,
              transform: `translate(${G.trackCx - G.thumbW / 2}px, ${G.y(dotPos.x) - G.thumbH / 2}px)`,
              willChange: "transform",
            }}
          >
            {dotPos.beyond !== 0 && (
              <svg width="10" height="6" viewBox="0 0 10 6" data-cue-dot="" className="block">
                <path d={dotPos.beyond > 0 ? "M 1.5 5 L 5 1.5 L 8.5 5" : "M 1.5 1 L 5 4.5 L 8.5 1"} fill="none"
                  stroke={hollow ? color : HALO} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        )}
        {G && (
          <div className="absolute right-0 min-w-0" style={{ left: G.svgW + 6, top: sideTop }}>
            {/* A text value (resonance) starts level with the middle of the
                pitch number beside it and wraps downwards. */}
            {typeof side === "string"
              ? <div className={`text-[length:var(--cue-res)] leading-snug font-medium break-words hyphens-auto ${sideClass}`}
                  style={{ paddingTop: Math.max(0, Math.round((G.numFs - G.resFs * 1.375) / 2)) }} data-cue-value="">{side}</div>
              : side}
          </div>
        )}
      </div>
    </div>
  );
});

export function CueStrip({
  direction = null,
  voiced,
  holding,
  // The pitch display's voiced flags (the voice gate's mask): both columns
  // and the caption read these (cueRowStates; the resonance cue since
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
  const [assets, setAssets] = useState(null);
  // What the 4 Hz tick saw: the resonance worker's latest state, each cue's
  // trail and (once a second) the screen-reader summaries. Render reads only
  // this, never the refs.
  const [view, setView] = useState({ snap: null, trails: { pitch: [], resonance: [] }, everVoiced: false, sr: {} });
  const latest = useRef(null);
  useEffect(() => { latest.current = { pitchVoiced, pitchHolding, pitchLevel, resonanceStatus, direction }; });

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

  // One 4 Hz tick: sample each cue's value into its trail while live; the
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
  // The big number IS the thumb: the 1.5 s level the target judges.
  const levelStatus = pitchLevel != null ? pitchStatus(pitchLevel, pitchTargetFor(direction)) : null;
  const rClamp = resonanceClamp(snap);
  const rValue = rowValue("resonance", inputs);
  const pitchWord = pState !== "idle" && pitchLevel != null ? pitchCueWord(pitchLevel, direction) : null;
  const pColor = dotColor("pitch", { pitchLevel, direction });
  const pHollow = dotHollow("pitch", { pitchLevel, direction });
  void pitch; // the moment-to-moment value lives in the trace above

  // Stable column props (the columns are memoised): bands / highlights /
  // info follow the direction and the reference assets only; the pitch
  // value block follows its own values.
  const pitchBands = useMemo(() => bandsFor("pitch"), []);
  const resonanceBands = useMemo(() => (vtlnRef ? bandsFor("resonance", vtlnRef) : null), [vtlnRef]);
  const pitchHighlight = useMemo(() => highlightFor("pitch", direction), [direction]);
  const resonanceHighlight = useMemo(() => (vtlnRef ? highlightFor("resonance", direction, vtlnRef) : null), [direction, vtlnRef]);
  const pitchInfo = useMemo(() => <><p>{PITCH_INFO}</p>{directionNote("pitch", direction) && <p>{directionNote("pitch", direction)}</p>}</>, [direction]);
  // Phone-quality audio: the reason the cue is paused comes first.
  const rNarrow = rState === "narrowband";
  const resonanceInfo = useMemo(() => <>{rNarrow && <p data-cue-narrowband-info="">{NARROWBAND_INFO}</p>}<p>{RESONANCE_INFO}</p>{directionNote("resonance", direction) && <p>{directionNote("resonance", direction)}</p>}</>, [direction, rNarrow]);
  // Beside the pitch meter: the number, the on / off-target word (a filled
  // dot on target, a hollow one off it — not colour alone; the line keeps
  // its height when empty) and the steadiness. Fixed widths and heights, so
  // the steadiness "i" never moves.
  const pitchSide = useMemo(() => (
    <div className="flex flex-col items-start gap-1" data-cue-value="">
      <span className={`text-[length:var(--cue-num)] leading-none font-light tracking-tight ${pitchLevel != null ? statusTextClass(levelStatus) : "text-neutral-400"}`} data-cue-f0="">
        {/* no voice: a short dash, not a bar the width of the number */}
        <Fixed widest={["000"]}>{pitchLevel != null ? Math.round(pitchLevel) : <span className="text-[0.6em] align-middle">—</span>}</Fixed>
        <span className="text-[11px] lg:text-xs tracking-normal text-neutral-400 ml-0.5">Hz</span>
      </span>
      <span className={`flex items-center gap-1 h-4 text-[length:var(--cue-sub)] leading-4 font-semibold whitespace-nowrap ${statusTextClass(levelStatus)}`}>
        {pitchWord && (
          <>
            <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full box-border shrink-0 forced-color-adjust-none"
              style={pHollow ? { border: `1.5px solid ${pColor}` } : { background: pColor }} />
            <span data-cue-word="">{pitchWord}</span>
          </>
        )}
      </span>
      <SteadinessReadout value={steadiness} held={steadinessHeld} variant="compact" />
    </div>
  ), [pitchLevel, levelStatus, pitchWord, pColor, pHollow, steadiness, steadinessHeld]);

  return (
    <div
      data-cue-strip=""
      className="w-full rounded-xl bg-neutral-900/60 border border-neutral-800 p-3 shortland:p-2 flex flex-col gap-2 shortland:flex-1 shortland:min-h-0"
    >
      <div className="relative grid grid-cols-2 gap-x-3.5 shortland:flex-1 shortland:min-h-0">
        <span aria-hidden="true" className="absolute left-1/2 top-0.5 bottom-0.5 w-px -translate-x-1/2 bg-neutral-800" />
        <CueColumn
          cue="pitch"
          title="Pitch"
          info={pitchInfo}
          side={pitchSide}
          state={pState}
          value={rowValue("pitch", inputs)}
          beyond={0}
          trail={view.trails.pitch}
          color={pColor}
          hollow={pHollow}
          bands={pitchBands}
          highlight={pitchHighlight}
          ends={ENDS.pitch}
          roomy={roomy}
          srText={view.sr.pitch}
        />
        <CueColumn
          cue="resonance"
          title="Resonance"
          titleNote="approx."
          info={resonanceInfo}
          side={resonanceHeader(rState, snap)}
          sideClass="text-neutral-200"
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
          roomy={roomy}
          srText={view.sr.resonance}
        />
      </div>
      {!shortLandscape && (
        <div className="flex items-start justify-between gap-2 h-4 text-[11px] lg:text-xs leading-4 text-neutral-400 whitespace-nowrap" data-cue-caption="">
          <span className="min-w-0 overflow-hidden text-ellipsis">
            {view.everVoiced || pitchVoiced ? "Bands: typical adult speakers" : "Start speaking to move the markers"}
          </span>
          <span className="shrink-0" data-cue-hnr="">
            <Fixed widest={["HNR -00 dB"]}>HNR {hnr !== null && hnr !== undefined ? `${Math.round(hnr)} dB` : "—"}</Fixed>
          </span>
        </div>
      )}
    </div>
  );
}
