// CueStrip.jsx — the Dashboard's three graded cues (Design A "cue strip",
// 2026-10-07): Pitch, Resonance · approx. and Vocal weight, each on one
// neutral axis (typically-men end on the left) with soft bands for typical
// adult speakers, a dot for the current value and a ~2 s trail so movement
// is visible. Answers "how do I come across" and "what to change" at a
// glance; replaces the Perceived-voice bar, the F2 readout and the stats row.
//
// Geometry, the direction highlight, colours, the trail and the row states
// are pure (cueStripModel.js, unit-tested). This file only lays them out:
// one inline SVG per row in pixel units (the strip measures its width), the
// dot and trail moved with a 200 ms CSS transform transition, re-rendered by
// one 250 ms tick (4 Hz; no canvas, no rAF). Rows expose data-cue /
// data-state / data-target-low|high for the smoke test.
//
// Only the pitch dot is coloured on / off target (the F0 readout's rule);
// resonance and weight show the direction as an outline only — resonance's
// absolute position is approximate across microphones and rooms
// (measurements/resonance-cue-production-path-2026-10-07.md §8), and the
// weight reading moves with pitch (WEIGHT_PITCH_NOTE).

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SteadinessReadout } from "./SteadinessReadout";
import {
  axisPos,
  bandsFor,
  createTrail,
  dotColor,
  dotOpacity,
  highlightFor,
  pitchRowState,
  resonanceClamp,
  resonanceHeader,
  resonanceRowState,
  rowValue,
  ticks,
  trailOpacity,
  weightHeader,
  weightRowState,
  TRAIL_EVERY_MS,
} from "./cueStripModel";
import { pitchStatus, pitchTargetFor, weightTargetFor, WEIGHT_PITCH_NOTE } from "../utils/trainingDirection";
import { COLORS, statusTextClass } from "../utils/constants";

// Row geometry (px). Compact: phones and short landscape; roomy: desktop.
// The end words ("lower" / "higher" …) sit on the axis row, the axis runs
// between them, so the band rows above / below are free for the band labels.
const COMPACT = { h: 33, menY: 3, bandH: 5, ax: 16, womenY: 24, fs: 10, r: 5, tr: 2.5 };
const ROOMY = { h: 46, menY: 7, bandH: 7, ax: 23, womenY: 32, fs: 10, r: 5.5, tr: 2.75 };
const PAD = 8; // px between an end word and the axis (room for a pinned dot + chevron)

// reference.json (the resonance lab's, one source of truth): fetched once.
let refPromise = null;
function loadReference() {
  if (!refPromise) {
    refPromise = fetch(`${import.meta.env.BASE_URL}resonance-lab/reference.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
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

// Text width estimate for 10 px labels (tabular-free sans): used only to
// decide which side of a band its label goes.
const textW = (s, fs = 10) => s.length * fs * 0.56;

const PITCH_INFO =
  "Your speaking pitch over the last ~1.5 s — the level the target colour judges (the trace above shows " +
  "each moment). Bands: typical adult men's (85–155 Hz) and women's (165–255 Hz) average speaking pitch. " +
  "The trail shows the last ~2 s.";
const RESONANCE_INFO =
  "Spectral warp: how stretched your voice's spectrum is compared with an average voice. Bands come from " +
  "20 men and 20 women reading audiobooks on good microphones. Your microphone, room and distance shift the " +
  "whole scale, so trust how the dot moves more than where it sits. Uses about your last 5 s of running " +
  "speech; held vowels and single words don't count. The ring marks where you started this session.";
const WEIGHT_INFO =
  "An estimate of vocal weight (how heavy or light your voice sounds) from its cepstral peak prominence, " +
  "CPP. It is relative to your own voice: the first 30 s of speaking in each session set your start, and σ " +
  "says how far you are from it. Pitch moves this reading too: raising your pitch reads lighter and lowering " +
  "it reads heavier even when the weight itself hasn't changed, so compare readings at a similar pitch.";

function directionNote(cue, direction) {
  if (!direction || direction === "exploring") return null;
  if (cue === "pitch") {
    const t = pitchTargetFor(direction);
    return t ? `Your target (highlighted): ${t.low}–${t.high} Hz.` : null;
  }
  if (cue === "resonance") {
    return direction === "androgynous"
      ? "Highlighted: the gap between the two bands — an outline only, never judged, since the scale shifts with your setup."
      : `Highlighted: the typical ${direction === "feminine" ? "women's" : "men's"} band — an outline only, never judged, since the scale shifts with your setup.`;
  }
  const w = weightTargetFor(direction);
  return w ? `Highlighted: at least ${w.sigma} σ ${w.side} than your start (shown once calibrated). ${WEIGHT_PITCH_NOTE}` : "No weight zone for this goal.";
}

// Small "i" toggle with a popover inside the row (the row is `relative`).
function InfoToggle({ label, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tipId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <span ref={wrapRef} className="inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={label}
        className="relative ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-600 text-[9px] leading-none text-neutral-500 hover:text-neutral-300 hover:border-neutral-400 transition-colors cursor-pointer before:absolute before:-inset-2 before:content-['']"
      >
        i
      </button>
      {open && (
        <div
          id={tipId}
          role="note"
          className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-xs leading-relaxed font-normal normal-case tracking-normal text-neutral-300 shadow-lg space-y-1.5"
        >
          {children}
        </div>
      )}
    </span>
  );
}

// Places a band label beside its band, outside it, without running into the
// end words of the bottom row. -> { x, anchor, text } | null
function placeLabel(band, text, W, { left, right, preferLeft, endsLeftW = 0, endsRightW = 0 }) {
  if (!band) return null;
  const a = left(band.x0), b = right(band.x1);
  for (const t of [text, text.replace("typical ", "")]) {
    const w = textW(t);
    const tryLeft = () => (a - 4 - w >= endsLeftW ? { x: a - 4, anchor: "end", text: t } : null);
    const tryRight = () => (b + 4 + w <= W - endsRightW ? { x: b + 4, anchor: "start", text: t } : null);
    const p = preferLeft ? tryLeft() ?? tryRight() : tryRight() ?? tryLeft();
    if (p) return p;
  }
  return null;
}

function CueRow({ cue, title, info, headerRight, headerClass, state, value, beyond, trail, color, bands, highlight, startX, ends, progress, g, W, faint }) {
  const endW = [textW(ends[0]), textW(ends[1])];
  const axL = endW[0] + PAD, axR = Math.max(axL + 1, W - endW[1] - PAD);
  const X = (f) => axL + f * (axR - axL);
  const showDot = dotOpacity(state);
  const ax = g.ax;
  // Labels on the OUTER side of their band (men's left, women's right), on
  // the band rows — they may run above / below an end word (other row);
  // the inner side only when the outer side would leave the card.
  const keep = { left: X, right: X };
  const menLabel = bands ? placeLabel(bands.men, "typical men", W, { ...keep, preferLeft: true }) : null;
  const womenLabel = bands ? placeLabel(bands.women, "typical women", W, { ...keep, preferLeft: false }) : null;
  const bandFill = faint ? "fill-neutral-500/15" : "fill-neutral-500/25";
  const gradId = `cue-fade-${cue}`;
  return (
    <div
      className="relative"
      data-cue={cue}
      data-state={state}
      data-dot={showDot !== null && value !== null ? "1" : "0"}
      data-trail={trail.length}
      data-value={value === null || value === undefined ? "" : String(Math.round(value * 1000) / 1000)}
      {...(highlight ? { "data-target-low": String(Math.round(highlight.low * 1000) / 1000), "data-target-high": String(Math.round(highlight.high * 1000) / 1000) } : {})}
    >
      <div className="flex items-center justify-between gap-2 h-4 lg:h-[18px] text-[11px] leading-none whitespace-nowrap">
        <span className="inline-flex items-center text-neutral-400 font-medium min-w-0">
          <span className="min-w-0 overflow-hidden text-ellipsis" data-cue-title="">{title}</span>
          <InfoToggle label={`About the ${cue} cue`}>{info}</InfoToggle>
        </span>
        <span className={`min-w-0 overflow-hidden text-ellipsis tabular-nums ${headerClass}`} data-cue-value="">{headerRight}</span>
      </div>
      {W > 0 && (
        <svg width={W} height={g.h} className="block overflow-visible" aria-hidden="true">
          {faint && (
            <defs>
              <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="white" stopOpacity="0" />
                <stop offset="0.18" stopColor="white" stopOpacity="1" />
                <stop offset="0.82" stopColor="white" stopOpacity="1" />
                <stop offset="1" stopColor="white" stopOpacity="0" />
              </linearGradient>
              <mask id={`${gradId}-m`} maskContentUnits="objectBoundingBox">
                <rect x="0" y="0" width="1" height="1" fill={`url(#${gradId})`} />
              </mask>
            </defs>
          )}
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
            <g key={i}>
              <rect x={X(b.x0)} y={y} width={Math.max(1, X(b.x1) - X(b.x0))} height={g.bandH} rx="2" className={bandFill}
                mask={faint ? `url(#${gradId}-m)` : undefined} />
              <line x1={X(b.xm)} x2={X(b.xm)} y1={y} y2={y + g.bandH} className={faint ? "stroke-neutral-400/45" : "stroke-neutral-400/70"} strokeWidth="1" />
            </g>
          ))}
          {menLabel && <text x={menLabel.x} y={g.menY + g.bandH / 2 + 3.5} textAnchor={menLabel.anchor} fontSize={g.fs} className="fill-neutral-500">{menLabel.text}</text>}
          {womenLabel && <text x={womenLabel.x} y={g.womenY + g.bandH / 2 + 3.5} textAnchor={womenLabel.anchor} fontSize={g.fs} className="fill-neutral-500">{womenLabel.text}</text>}
          <line x1={X(0)} x2={X(1)} y1={ax} y2={ax} className="stroke-neutral-700" strokeWidth="1" />
          {ticks(cue).map((t) => (
            <line key={t.v} x1={X(t.x)} x2={X(t.x)} y1={ax - 2} y2={ax + 2} className="stroke-neutral-600" strokeWidth="1" />
          ))}
          {cue === "weight" && (
            <text x={X(0.5)} y={ax - 6} textAnchor="middle" fontSize={g.fs} className="fill-neutral-500">your start</text>
          )}
          {progress !== null && progress !== undefined && (
            <rect x={X(0)} y={ax - 2} width={Math.max(0, (X(1) - X(0)) * progress)} height={4} rx="2" className="fill-amber-500/45" data-cue-progress="" />
          )}
          <text x={0} y={ax + 3.5} textAnchor="start" fontSize={g.fs} className="fill-neutral-500">{ends[0]}</text>
          <text x={W} y={ax + 3.5} textAnchor="end" fontSize={g.fs} className="fill-neutral-500">{ends[1]}</text>
          {startX !== null && startX !== undefined && (
            <circle cx={0} cy={ax} r={g.r} fill="none" className="stroke-neutral-300/70" strokeWidth="1.25"
              style={{ transform: `translateX(${X(startX)}px)` }} data-cue-start="" />
          )}
          {trail.map((v, i) => {
            const p = axisPos(cue, v);
            return p ? (
              <circle key={i} cx={0} cy={ax} r={g.tr} fill={color} opacity={trailOpacity(i, trail.length)}
                style={{ transform: `translateX(${X(p.x)}px)` }} />
            ) : null;
          })}
          {showDot !== null && value !== null && value !== undefined && (() => {
            const p = axisPos(cue, value, { clamp: beyond });
            if (!p) return null;
            const x = X(p.x);
            return (
              <g data-cue-dot="">
                <circle cx={0} cy={ax} r={g.r} fill={color} opacity={showDot}
                  style={{ transform: `translateX(${x}px)`, transition: "transform 200ms ease-out" }} />
                {p.beyond !== 0 && (
                  <path d={p.beyond > 0 ? `M ${x + g.r + 2} ${ax - 4} l 4 4 l -4 4` : `M ${x - g.r - 2} ${ax - 4} l -4 4 l 4 4`}
                    fill="none" stroke={color} strokeWidth="1.5" opacity={showDot} />
                )}
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}

export function CueStrip({
  direction = null,
  voiced,
  holding,
  pitch,
  pitchLevel,
  steadiness,
  steadinessHeld,
  hnr,
  vocalWeight,
  resonanceRef,
  resonanceStatus,
  shortLandscape = false,
}) {
  const roomy = useMedia("(min-width: 1024px) and (min-height: 600px)");
  const g = roomy ? ROOMY : COMPACT;
  const wrapRef = useRef(null);
  const [W, setW] = useState(0);
  const [reference, setReference] = useState(null);
  // What the 4 Hz tick saw: the resonance worker's latest state and each
  // row's trail (render reads only this, never the refs).
  const [view, setView] = useState({ snap: null, trails: { pitch: [], resonance: [], weight: [] }, everVoiced: false });
  const latest = useRef(null);
  useEffect(() => { latest.current = { voiced, holding, pitchLevel, vocalWeight, resonanceStatus }; });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setW(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadReference().then((r) => { if (alive) setReference(r); });
    return () => { alive = false; };
  }, []);

  // One 4 Hz tick: sample each row's value into its trail while live.
  useEffect(() => {
    const t = { pitch: createTrail(), resonance: createTrail(), weight: createTrail() };
    let ever = false;
    const id = setInterval(() => {
      const p = latest.current;
      if (!p) return;
      const snap = resonanceRef?.current ?? null;
      if (p.voiced) ever = true;
      const inputs = { ...p, snap, workerStatus: p.resonanceStatus };
      setView({
        snap,
        everVoiced: ever,
        trails: {
          pitch: t.pitch.tick(pitchRowState(inputs), rowValue("pitch", inputs)),
          resonance: t.resonance.tick(reference ? resonanceRowState(inputs) : "starting", rowValue("resonance", inputs)),
          weight: t.weight.tick(weightRowState(inputs), rowValue("weight", inputs)),
        },
      });
    }, TRAIL_EVERY_MS);
    return () => clearInterval(id);
  }, [resonanceRef, reference]);

  const vtlnRef = reference?.vtln ?? null;
  const snap = view.snap;
  const inputs = { voiced, holding, pitchLevel, vocalWeight, snap, workerStatus: resonanceStatus };
  const pState = pitchRowState(inputs);
  const rState = vtlnRef ? resonanceRowState(inputs) : "starting";
  const wState = weightRowState(inputs);
  const levelStatus = pitch !== null ? pitchStatus(pitchLevel, pitchTargetFor(direction)) : null;
  const rClamp = resonanceClamp(snap);
  const rValue = rowValue("resonance", inputs);
  const weightZone = weightTargetFor(direction);

  return (
    <div
      ref={wrapRef}
      data-cue-strip=""
      className="w-full rounded-xl bg-neutral-900/60 border border-neutral-800 p-2 flex flex-col gap-1 lg:gap-1.5"
    >
      <CueRow
        cue="pitch"
        title="Pitch"
        info={<><p>{PITCH_INFO}</p>{directionNote("pitch", direction) && <p>{directionNote("pitch", direction)}</p>}</>}
        headerRight={
          <span className="inline-flex items-baseline gap-2">
            <span className={`text-sm font-light ${pitch !== null ? statusTextClass(levelStatus) : "text-neutral-600"}`} data-cue-f0="">
              {pitch !== null ? Math.round(pitch) : "—"}
              <span className="text-[10px] text-neutral-500 ml-0.5">Hz</span>
            </span>
            <SteadinessReadout value={steadiness} held={steadinessHeld} variant="compact" />
          </span>
        }
        headerClass=""
        state={pState}
        value={rowValue("pitch", inputs)}
        beyond={0}
        trail={view.trails.pitch}
        color={dotColor("pitch", { pitchLevel, direction })}
        bands={bandsFor("pitch")}
        highlight={highlightFor("pitch", direction)}
        ends={["lower", "higher"]}
        g={g}
        W={W - 16}
      />
      <CueRow
        cue="resonance"
        title="Resonance · approx."
        info={<><p>{RESONANCE_INFO}</p>{directionNote("resonance", direction) && <p>{directionNote("resonance", direction)}</p>}</>}
        headerRight={resonanceHeader(rState, snap)}
        headerClass="text-neutral-500"
        state={rState}
        value={rValue}
        beyond={rClamp}
        trail={view.trails.resonance}
        color={COLORS.neutralTrace}
        bands={vtlnRef ? bandsFor("resonance", vtlnRef) : null}
        highlight={vtlnRef ? highlightFor("resonance", direction, vtlnRef) : null}
        startX={snap?.startU != null ? axisPos("resonance", snap.startU)?.x : null}
        ends={["darker", "brighter"]}
        faint
        g={g}
        W={W - 16}
      />
      <CueRow
        cue="weight"
        title="Vocal weight"
        info={<><p>{WEIGHT_INFO}</p><p>{directionNote("weight", direction)}</p></>}
        headerRight={weightHeader(wState, vocalWeight)}
        headerClass={wState === "calibrating" ? "text-amber-400" : "text-neutral-500"}
        state={wState}
        value={rowValue("weight", inputs)}
        beyond={0}
        trail={view.trails.weight}
        color={COLORS.neutralTrace}
        bands={null}
        highlight={vocalWeight?.baselineReady ? highlightFor("weight", direction) : null}
        progress={wState === "calibrating" ? (vocalWeight?.baselineProgress ?? 0) : null}
        ends={["heavier", "lighter"]}
        g={g}
        W={W - 16}
      />
      {!shortLandscape && (
        <div className="flex items-start justify-between gap-2 text-[10px] leading-[14px] text-neutral-500" data-cue-caption="">
          <span className="min-w-0">
            {view.everVoiced || voiced ? "Dots follow your recent speech · bands: typical adult speakers" : "Start speaking — the dots follow your recent speech"}
          </span>
          <span className="tabular-nums shrink-0" data-cue-hnr="">HNR {hnr !== null && hnr !== undefined ? `${Math.round(hnr)} dB` : "—"}</span>
        </div>
      )}
      {!shortLandscape && weightZone && (
        <p data-weight-note="" className="text-[10px] leading-snug text-neutral-500">{WEIGHT_PITCH_NOTE}</p>
      )}
    </div>
  );
}
