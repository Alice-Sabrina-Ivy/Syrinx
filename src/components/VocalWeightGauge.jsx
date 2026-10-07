// VocalWeightGauge.jsx — Horizontal bar gauge for the per-user-
// baseline-normalized CPP-based vocal-weight correlate.
//
// Direction: "Lighter" (left) ← → "Heavier" (right). Per Aaen et al.
// 2025 + literature review, higher CPP = lighter voice. The baseline
// tracker maps gauge position [0, 1] to ±BASELINE_SIGMA·σ (±3σ since
// 2026-06-10) around the user's first-30-s mean, with position 1.0 =
// lighter end (high CPP) and 0.0 = heavier end (low CPP). The gauge
// component flips that internally to keep the visual "Lighter" label
// on the LEFT.
//
// Calibration is fully automatic — no user-facing controls. The
// gauge enters one of three visual states on its own:
//   - Calibrating (first 30 s of voiced speech): no marker, replaced
//     with progress text "Calibrating: X %".
//   - Ready, voiced: marker at gauge position with σ-distance
//     readout below ("+1.2σ lighter" etc.).
//   - Ready, holding (silence < 5 s): marker at last-known position,
//     dimmed.
//
// Target zone follows the training direction (utils/trainingDirection.js
// weightTargetFor): the lighter side (σ ≥ +0.5) for "More feminine", the
// heavier side (σ ≤ −0.5) for "More masculine", none for "Androgynous" /
// "Just exploring" (the gauge is relative to the user's own baseline, so
// it has no population "in between"). Same look on either side; a reading
// short of the zone is neutral (purple), never red. The zone is drawn once
// the baseline locks. The CPP reading also moves with pitch — a raised
// voice reads lighter, a lowered one heavier (CLAUDE.md "Register
// confound"; measurements/vocal-weight-floor-and-register-2026-10-03.md) —
// so whenever the direction has a zone the dashboard shows
// WeightPitchNote next to the gauge, and the info explainer says the
// same. (Removed in the 2026-10-07 review for that confound; restored by
// user decision the same day with the note —
// measurements/training-direction-targets-2026-10-07.md.)
//
// Each session calibrates from scratch (no cross-session persistence,
// no buttons, no target voice). Mic/room/voice differ between
// sessions; a 30-s re-calibration each time is cheaper than UX
// complexity. Earlier iterations explored hybrid self+target with
// persistence (Stage C, 2026-05-12 morning) and were replaced with
// this simpler zero-interaction model in the same-day course
// correction.

import { useEffect, useId, useRef, useState } from "react";
import {
  WEIGHT_PITCH_NOTE,
  weightStatus,
  weightZoneForDisplay,
} from "../utils/trainingDirection";

const EXPLAINER_BASE =
  "An estimate of vocal weight (how heavy or light your voice sounds) " +
  "from its cepstral peak prominence, CPP. It is relative to your own " +
  "voice: the first 30 s of speaking in each session set the centre, and " +
  "σ says how far you are from it. Pitch moves this reading too: raising " +
  "your pitch reads lighter and lowering it reads heavier even when the " +
  "weight itself hasn't changed, so compare readings at a similar pitch.";

function explainerFor(target) {
  if (target?.side === "lighter") {
    return `${EXPLAINER_BASE} Target for More feminine: the lighter side, at least ` +
      `${target.sigma} σ lighter than your centre (the highlighted zone, shown once calibrated).`;
  }
  if (target?.side === "heavier") {
    return `${EXPLAINER_BASE} Target for More masculine: the heavier side, at least ` +
      `${target.sigma} σ heavier than your centre (the highlighted zone, shown once calibrated).`;
  }
  return `${EXPLAINER_BASE} No target zone for this goal (More feminine marks the ` +
    "lighter side, More masculine the heavier side).";
}

// The pitch-confound note, shown next to the gauge whenever the training
// direction has a weight zone (CombinedDashboard renders it under the
// stats row, centred under the gauge, so the narrow gauge column and the
// F0 / HNR columns keep their alignment).
export function WeightPitchNote({ target = null }) {
  if (target == null) return null;
  return (
    <p data-weight-note className="mt-1.5 text-[10px] sm:text-[11px] leading-snug text-neutral-500 text-center text-balance">
      {WEIGHT_PITCH_NOTE}
    </p>
  );
}

export function VocalWeightGauge({
  vocalWeight,
  voiced,
  holding,
  target = null,                  // weightTargetFor(direction): { side, sigma } | null
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tipId = useId();

  // Close the explainer on an outside tap or Escape.
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

  const cpp = vocalWeight?.cpp ?? null;
  const positionFromHook = vocalWeight?.position ?? null;
  const sigmaDelta = vocalWeight?.sigmaDelta ?? null;
  const progress = vocalWeight?.baselineProgress ?? 0;
  const ready = vocalWeight?.baselineReady ?? false;

  // Flip position so visual LEFT (Lighter) = high gauge value.
  // The baseline tracker's gaugePosition returns 1.0 for high CPP
  // (lighter); we want that to render at the LEFT of the bar to
  // match the "Lighter ← → Heavier" label arrangement.
  const visualPct = positionFromHook !== null ? (1 - positionFromHook) * 100 : null;

  // Zone geometry and the in-target test both come from
  // trainingDirection.js, derived from the same BASELINE_SIGMA the
  // baseline's gaugePosition uses, so the drawn zone always agrees with
  // the marker colour.
  const zone = ready ? weightZoneForDisplay(target) : null;
  const inTarget = ready && weightStatus(sigmaDelta, target) === "in";
  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;
  const explainer = explainerFor(target);

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      data-weight-zone={target?.side ?? "none"}
      data-weight-ready={ready ? "1" : "0"}
    >
      <div style={{ opacity }}>
        {/* Labels */}
        <div data-weight-labels className="flex justify-between items-baseline mb-1.5 whitespace-nowrap">
          <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
            Lighter
          </span>
          <span className="text-[11px] sm:text-xs text-neutral-400 font-medium px-1 inline-flex items-center">
            Vocal Weight
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={tipId}
              aria-label="What does the vocal weight gauge show?"
              title={explainer}
              className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-600 text-[9px] leading-none font-normal text-neutral-500 hover:text-neutral-300 hover:border-neutral-400 transition-colors cursor-pointer"
            >
              i
            </button>
          </span>
          <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
            Heavier
          </span>
        </div>

        {/* Gauge track */}
        <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
          {/* Target zone highlight (only after baseline locks) */}
          {zone && (
            <div
              data-weight-zone-band
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${zone.left}%`,
                width: `${zone.width}%`,
                background:
                  "linear-gradient(90deg, rgba(74,222,128,0.08), rgba(74,222,128,0.15), rgba(74,222,128,0.08))",
                borderTop: "1px solid rgba(74,222,128,0.25)",
                borderBottom: "1px solid rgba(74,222,128,0.25)",
              }}
            />
          )}

          {/* Marker (only when baseline is ready and we have a position) */}
          {ready && visualPct !== null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
              style={{ left: `${visualPct}%` }}
            >
              <div
                className={`w-3.5 h-3.5 -ml-[7px] rounded-full border-2 ${
                  inTarget
                    ? "bg-green-400 border-green-300 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                    : "bg-purple-400 border-purple-300 shadow-[0_0_6px_rgba(192,132,252,0.4)]"
                }`}
              />
            </div>
          )}

          {/* Calibrating: progress overlay */}
          {!ready && (
            <div
              className="absolute top-0 left-0 h-full bg-amber-500/20"
              style={{ width: `${progress * 100}%` }}
            />
          )}
        </div>

        {/* Readout — three modes:
            1. Pre-warmup (no CPP yet): "Calibrating: listening for voice…"
            2. Calibrating (have CPP, baseline not ready): progress text
            3. Ready (baseline locked): σ-distance readout */}
        <div className="mt-1 text-center min-h-[16px]">
          {!ready ? (
            <span className="text-xs tabular-nums text-amber-400">
              {cpp === null
                ? "Calibrating: listening for voice…"
                : `Calibrating: ${Math.round(progress * 100)} %`}
            </span>
          ) : sigmaDelta !== null ? (
            <span
              className={`text-xs tabular-nums ${
                inTarget ? "text-green-400" : "text-neutral-400"
              }`}
            >
              {sigmaDelta >= 0 ? "+" : ""}
              {sigmaDelta.toFixed(1)} σ
              <span className="text-neutral-500 ml-1">
                ({sigmaDelta > 0 ? "lighter" : sigmaDelta < 0 ? "heavier" : "at baseline"})
              </span>
            </span>
          ) : (
            <span className="text-xs tabular-nums text-neutral-500">—</span>
          )}
        </div>
      </div>

      {/* Explainer: centred over the gauge column, outside the dimmed
          wrapper so it stays readable between phrases. */}
      {open && (
        <div
          id={tipId}
          role="note"
          className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-left text-xs leading-relaxed text-neutral-300 shadow-lg normal-case tracking-normal"
        >
          {explainer}
        </div>
      )}
    </div>
  );
}
