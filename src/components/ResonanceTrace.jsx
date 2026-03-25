// ResonanceTrace.jsx — Scrolling canvas F2 resonance trace (last 15 seconds)
// Blue line when in target range, orange when outside. Gaps during silence.

import { useRef, useEffect } from "react";
import {
  DEFAULT_F2_TARGET,
  F2_DISPLAY_RANGE,
  RESONANCE_TRACE_SECONDS,
  COLORS,
} from "../utils/constants";

export function ResonanceTrace({ formantTrailRef, voiced, holding, formants, compact = false }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Handle canvas sizing with ResizeObserver
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

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const targetLow = DEFAULT_F2_TARGET.low;
    const targetHigh = DEFAULT_F2_TARGET.high;
    const displayLow = F2_DISPLAY_RANGE.low;
    const displayHigh = F2_DISPLAY_RANGE.high;

    const pad = { left: 48, right: 28, top: 8, bottom: 24 };

    function hzToY(hz) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = pad.top * dpr;
      const plotBottom = canvas.height - pad.bottom * dpr;
      const frac = (hz - displayLow) / (displayHigh - displayLow);
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

      // Grid lines + labels
      const gridHz = [1000, 1500, 2000, 2500, 3000];
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = `${11 * dpr}px system-ui`;

      for (const hz of gridHz) {
        if (hz < displayLow || hz > displayHigh) continue;
        const y = hzToY(hz);
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();

        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(`${hz}`, plotLeft - 6 * dpr, y);
      }

      // Time labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const now = Math.round(performance.timeOrigin + performance.now());
      for (let sec = 0; sec <= RESONANCE_TRACE_SECONDS; sec += 5) {
        const x = timeToX(now - sec * 1000, now);
        if (x < plotLeft - 5 * dpr) continue;
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(sec === 0 ? "now" : `-${sec}s`, x, plotBottom + 4 * dpr);
      }

      // Target band
      const bandTop = hzToY(targetHigh);
      const bandBottom = hzToY(targetLow);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);

      // Target band borders
      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, bandTop);
      ctx.lineTo(plotRight, bandTop);
      ctx.moveTo(plotLeft, bandBottom);
      ctx.lineTo(plotRight, bandBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // F2 trace line
      const data = formantTrailRef.current;
      if (data.length < 2) {
        animId = requestAnimationFrame(draw);
        return;
      }

      ctx.lineWidth = 2.5 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Gap threshold: if two consecutive formant points are more than
      // 150ms apart, silence occurred between them — break the line.
      const GAP_MS = 150;

      let inSegment = false;
      let prevTime = 0;
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        const x = timeToX(pt.time, now);

        if (x < plotLeft) { prevTime = pt.time; continue; }

        // Break on unvoiced, missing data, or time gap (silence)
        if (!pt.voiced || pt.f2 === null || pt.f2 === undefined ||
            (inSegment && pt.time - prevTime > GAP_MS)) {
          if (inSegment) {
            ctx.stroke();
            inSegment = false;
          }
          prevTime = pt.time;
          if (!pt.voiced || pt.f2 === null || pt.f2 === undefined) continue;
          // Time-gap with valid data: start a new segment at this point
        }

        const y = hzToY(pt.f2);
        const inTarget = pt.f2 >= targetLow && pt.f2 <= targetHigh;

        if (!inSegment) {
          ctx.beginPath();
          ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
          ctx.moveTo(x, y);
          inSegment = true;
        } else {
          const prevPt = data[i - 1];
          const prevInTarget =
            prevPt?.voiced &&
            prevPt.f2 !== null && prevPt.f2 !== undefined &&
            prevPt.f2 >= targetLow &&
            prevPt.f2 <= targetHigh;

          if (inTarget !== prevInTarget) {
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        prevTime = pt.time;
      }
      if (inSegment) ctx.stroke();

      // Current position glow dot
      let lastVoiced = null;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].voiced && data[i].f2 !== null && data[i].f2 !== undefined) { lastVoiced = data[i]; break; }
      }
      if (lastVoiced && now - lastVoiced.time < 500) {
        const x = timeToX(lastVoiced.time, now);
        const y = hzToY(lastVoiced.f2);
        const inTarget =
          lastVoiced.f2 >= targetLow && lastVoiced.f2 <= targetHigh;
        const color = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;

        ctx.beginPath();
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Glow
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

  // Readout
  const f2 = formants?.f2;
  const inTarget =
    f2 !== null && f2 !== undefined &&
    f2 >= DEFAULT_F2_TARGET.low &&
    f2 <= DEFAULT_F2_TARGET.high;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Hz readout (hidden in compact mode) */}
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
            {f2 !== null && f2 !== undefined ? `${Math.round(f2)} Hz` : "\u2014 Hz"}
          </span>
          <span className="text-sm text-neutral-500">F2</span>
        </div>
      )}
    </div>
  );
}
