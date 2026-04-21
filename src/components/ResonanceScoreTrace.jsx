// ResonanceScoreTrace.jsx — 15-second scrolling trace of vowel-normalized
// resonance score (0-100). Replaces the older raw-F2 trace.
//
// For each voiced frame, the score projects the current (F1,F2) onto the
// male→female line of the nearest reference vowel, producing a vowel-invariant
// "how feminine is this resonance" scalar. See utils/resonanceScore.js.

import { useRef, useEffect } from "react";
import { RESONANCE_TRACE_SECONDS, COLORS } from "../utils/constants";
import { vowelResonanceScore, RESONANCE_SCORE_TARGET } from "../utils/resonanceScore";

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

      // Y-axis grid + labels (0, 25, 50, 75, 100)
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

      // Target band (score >= target)
      const bandTop = scoreToY(100);
      const bandBottom = scoreToY(target);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);

      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, bandBottom);
      ctx.lineTo(plotRight, bandBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Score trace — compute per-point score from formant history, draw
      // blue segments above target and orange segments below.
      const data = formantTrailRef.current;
      if (data.length < 2) {
        animId = requestAnimationFrame(draw);
        return;
      }

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

        const scored = pt.voiced && pt.f1 != null && pt.f2 != null
          ? vowelResonanceScore(pt.f1, pt.f2)
          : null;

        // Break on unvoiced, missing data, or time gap (silence)
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

      // Current position glow dot
      let lastScored = null;
      for (let i = data.length - 1; i >= 0; i--) {
        const pt = data[i];
        if (pt.voiced && pt.f1 != null && pt.f2 != null) {
          const s = vowelResonanceScore(pt.f1, pt.f2);
          if (s) { lastScored = { pt, ...s }; break; }
        }
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

  // Readout: current score + detected vowel
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
