// ResonanceScoreTrace.jsx — 15-second scrolling trace of the ML perceived-
// gender score (0-100). Backed by a Transformers.js Wav2Vec2 classifier in a
// dedicated worker; see src/ml/gender-worker.js.
//
// Each genderTraceRef entry is { time, score, confidence }. Scores arrive at
// ~1.3 Hz (the model integrates over 2-sec windows), so the trace is sparser
// than the old formant-derived one and we connect points with simple lines.

import { useRef, useEffect } from "react";
import { RESONANCE_TRACE_SECONDS, COLORS } from "../utils/constants";

const SCORE_TARGET = 70;        // ≥ this = "perceived feminine"
const SCORE_MALE_CEILING = 30;  // ≤ this = "perceived male"

const MALE_BAND_FILL = "rgba(251, 146, 60, 0.06)";
const MALE_BAND_BORDER = "rgba(251, 146, 60, 0.25)";

export function ResonanceScoreTrace({
  genderTraceRef,
  voiced,
  holding,
  genderScore,
  genderConfidence,
  modelStatus,
  modelProgress,
  modelError,
  compact = false,
}) {
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

    const pad = { left: 40, right: 28, top: 8, bottom: 24 };

    function scoreToY(score) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = pad.top * dpr;
      const plotBottom = canvas.height - pad.bottom * dpr;
      const frac = score / 100;
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
      for (const v of [0, 25, 50, 75, 100]) {
        const y = scoreToY(v);
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(`${v}`, plotLeft - 6 * dpr, y);
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

      // Male-range band (0 to SCORE_MALE_CEILING)
      const maleTop = scoreToY(SCORE_MALE_CEILING);
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

      // Target band (>= SCORE_TARGET)
      const tgtTop = scoreToY(100);
      const tgtBottom = scoreToY(SCORE_TARGET);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(plotLeft, tgtTop, plotRight - plotLeft, tgtBottom - tgtTop);
      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.beginPath();
      ctx.moveTo(plotLeft, tgtBottom);
      ctx.lineTo(plotRight, tgtBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      const data = genderTraceRef?.current ?? [];

      // Render trace: connect points, switch color at the SCORE_TARGET line.
      if (data.length >= 2 && modelStatus === "ready") {
        ctx.lineWidth = 2.5 * dpr;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        let inSegment = false;
        let prevInTarget = null;

        for (let i = 0; i < data.length; i++) {
          const pt = data[i];
          const x = timeToX(pt.time, now);
          if (x < plotLeft) continue;

          const y = scoreToY(pt.score);
          const inTarget = pt.score >= SCORE_TARGET;

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
        }
        if (inSegment) ctx.stroke();
      }

      // Latest position glow dot
      const last = data[data.length - 1];
      if (last && now - last.time < 3000 && modelStatus === "ready") {
        const x = timeToX(last.time, now);
        const y = scoreToY(last.score);
        const inTarget = last.score >= SCORE_TARGET;
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
  }, [genderTraceRef, modelStatus]);

  // Overlay text for the various model states
  let overlay = null;
  if (modelStatus === "loading") {
    const pct = modelProgress?.total
      ? Math.round((modelProgress.loaded / modelProgress.total) * 100)
      : null;
    overlay = (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
        <div className="text-sm text-neutral-300">Loading voice-perception model…</div>
        {pct !== null && (
          <div className="mt-2 text-xs text-neutral-500 tabular-nums">
            {pct}%{modelProgress?.file ? ` · ${modelProgress.file.split("/").pop()}` : ""}
          </div>
        )}
      </div>
    );
  } else if (modelStatus === "error") {
    overlay = (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 pointer-events-none px-4 text-center">
        <div className="text-sm text-red-400">Model failed to load</div>
        {modelError && (
          <div className="mt-1 text-xs text-neutral-500 max-w-md">{modelError}</div>
        )}
      </div>
    );
  } else if (modelStatus === "ready" && genderScore == null) {
    overlay = (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-xs text-neutral-500">Speak for ~2 sec to see your first score</div>
      </div>
    );
  }

  const inTarget = genderScore != null && genderScore >= SCORE_TARGET;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {overlay}
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
            {genderScore != null ? Math.round(genderScore) : "—"}
          </span>
          <span className="text-sm text-neutral-500">
            resonance{genderConfidence != null ? ` · ${Math.round(genderConfidence * 100)}% conf` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
