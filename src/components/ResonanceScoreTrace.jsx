// ResonanceScoreTrace.jsx — 15-second scrolling trace of vowel-normalized
// resonance score (0-100). Replaces the older raw-F2 trace.
//
// For each voiced frame, the score picks the nearest Hillenbrand reference
// anchor (male or female) and returns 100·d_male / (d_male + d_female), then
// gates out frames where the nearest anchor is > GATE_DISTANCE_HZ away.
// Rendered scores are rolling-median-smoothed over 3 points (~150 ms) to
// absorb single-sample noise from vowel transitions.

import { useRef, useEffect } from "react";
import { RESONANCE_TRACE_SECONDS, COLORS } from "../utils/constants";
import {
  vowelResonanceScore,
  RESONANCE_SCORE_TARGET,
  RESONANCE_MALE_CEILING,
} from "../utils/resonanceScore";

// Window (# of points) for rolling-median smoothing of scores.
const SCORE_SMOOTH_WINDOW = 3;

// Color tokens for the male-range band. Inlined here since nothing else
// consumes them.
const MALE_BAND_FILL = "rgba(251, 146, 60, 0.06)";
const MALE_BAND_BORDER = "rgba(251, 146, 60, 0.25)";

function medianOf(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function ResonanceScoreTrace({ formantTrailRef, voiced, holding, formants, compact = false }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const displayLow = 0;
    const displayHigh = 100;
    const target = RESONANCE_SCORE_TARGET;
    const maleCeiling = RESONANCE_MALE_CEILING;

    const pad = { left: 40, right: 28, top: 8, bottom: 24 };

    function scoreToY(score) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = pad.top * dpr;
      const plotBottom = canvas.height - pad.bottom * dpr;
      const frac = (score - displayLow) / (displayHigh - displayLow);
      return plotBottom - frac * (plotBottom - plotTop);
    }

    function timeToX(t, now) {
      const dpr = window.devicePixelRatio || 1;
      const plotLeft = pad.left * dpr;
      const plotRight = canvas.width - pad.right * dpr;
      const age = now - t;
      const frac = 1 - age / (RESONANCE_TRACE_SECONDS * 1000);
      return plotLeft + frac * (plotRight - plotLeft);
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;

      const plotLeft = pad.left * dpr;
      const plotRight = w - pad.right * dpr;
      const plotBottom = h - pad.bottom * dpr;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
      ctx.fillRect(0, 0, w, h);

      // Y-axis grid + labels
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = `${11 * dpr}px system-ui`;
      for (const score of [0, 25, 50, 75, 100]) {
        const y = scoreToY(score);
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(`${score}`, plotLeft - 6 * dpr, y);
      }

      // X-axis time labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const now = Math.round(performance.timeOrigin + performance.now());
      for (let sec = 0; sec <= RESONANCE_TRACE_SECONDS; sec += 5) {
        const x = timeToX(now - sec * 1000, now);
        if (x < plotLeft - 5 * dpr) continue;
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(sec === 0 ? "now" : `-${sec}s`, x, plotBottom + 4 * dpr);
      }

      // Male-range band (0 to maleCeiling)
      const maleTop = scoreToY(maleCeiling);
      const maleBottom = scoreToY(0);
      ctx.fillStyle = MALE_BAND_FILL;
      ctx.fillRect(plotLeft, maleTop, plotRight - plotLeft, maleBottom - maleTop);
      ctx.strokeStyle = MALE_BAND_BORDER;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, maleTop);
      ctx.lineTo(plotRight, maleTop);
      ctx.stroke();

      // Target band (>= target)
      const bandTop = scoreToY(100);
      const bandBottom = scoreToY(target);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);
      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.beginPath();
      ctx.moveTo(plotLeft, bandBottom);
      ctx.lineTo(plotRight, bandBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Compute + smooth per-point scores, then render the trace.
      const data = formantTrailRef.current;
      if (data.length < 2) {
        animId = requestAnimationFrame(draw);
        return;
      }

      // Pass 1: raw scores
      const raw = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        raw[i] = pt.voiced && pt.f1 != null && pt.f2 != null
          ? vowelResonanceScore(pt.f1, pt.f2)
          : null;
      }

      // Pass 2: rolling median smoothing across nearby non-null scores.
      // Uses neighbors i-1 .. i+1 (window of 3 → ~150 ms at formant rate).
      const half = Math.floor(SCORE_SMOOTH_WINDOW / 2);
      const smoothed = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        if (!raw[i]) { smoothed[i] = null; continue; }
        const vals = [];
        for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
          if (raw[j]) vals.push(raw[j].score);
        }
        const med = medianOf(vals);
        smoothed[i] = med !== null ? { score: med, vowel: raw[i].vowel } : null;
      }

      // Pass 3: draw the line, splitting on null-score gaps, large time gaps,
      // and target/non-target color transitions.
      ctx.lineWidth = 2.5 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const GAP_MS = 150;
      let inSegment = false;
      let prevTime = 0;
      let prevInTarget = null;

      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        const x = timeToX(pt.time, now);
        if (x < plotLeft) { prevTime = pt.time; continue; }

        const scored = smoothed[i];
        if (!scored || (inSegment && pt.time - prevTime > GAP_MS)) {
          if (inSegment) {
            ctx.stroke();
            inSegment = false;
          }
          prevTime = pt.time;
          if (!scored) continue;
        }

        const y = scoreToY(scored.score);
        const inTarget = scored.score >= target;

        if (!inSegment) {
          ctx.beginPath();
          ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
          ctx.moveTo(x, y);
          inSegment = true;
        } else if (inTarget !== prevInTarget) {
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        prevInTarget = inTarget;
        prevTime = pt.time;
      }
      if (inSegment) ctx.stroke();

      // Current position glow dot — use the smoothed score so the dot
      // aligns with the line.
      let lastScored = null;
      for (let i = data.length - 1; i >= 0; i--) {
        if (smoothed[i]) { lastScored = { pt: data[i], ...smoothed[i] }; break; }
      }
      if (lastScored && now - lastScored.pt.time < 500) {
        const x = timeToX(lastScored.pt.time, now);
        const y = scoreToY(lastScored.score);
        const inTarget = lastScored.score >= target;
        const color = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;

        ctx.beginPath();
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, 10 * dpr, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(x, y, 2 * dpr, x, y, 10 * dpr);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [formantTrailRef]);

  const live = formants?.f1 != null && formants?.f2 != null
    ? vowelResonanceScore(formants.f1, formants.f2)
    : null;
  const inTarget = live && live.score >= RESONANCE_SCORE_TARGET;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {!compact && (
        <div className="mt-3 flex items-baseline justify-center gap-3">
          <span
            className={`text-3xl font-light tabular-nums transition-opacity duration-300 ${
              !voiced && !holding
                ? "text-neutral-600 opacity-40"
                : holding
                  ? "text-white opacity-50"
                  : inTarget
                    ? "text-blue-400"
                    : "text-orange-400"
            }`}
          >
            {live ? Math.round(live.score) : "—"}
          </span>
          <span className="text-sm text-neutral-500">
            resonance{live ? ` · ${live.vowel.label}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
