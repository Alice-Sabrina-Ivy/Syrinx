// PitchTrace.jsx — Scrolling canvas pitch trace (last 15 seconds)
// Green line when in target range, red when outside. Gaps during silence.

import { useRef, useEffect } from "react";
import { hzToNote } from "../utils/pitchUtils";
import {
  DEFAULT_PITCH_TARGET,
  PITCH_DISPLAY_RANGE,
  PITCH_TRACE_SECONDS,
  COLORS,
} from "../utils/constants";

export function PitchTrace({ pitchTraceRef, voiced, holding, pitch, compact = false }) {
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

    const targetLow = DEFAULT_PITCH_TARGET.low;
    const targetHigh = DEFAULT_PITCH_TARGET.high;
    const displayLow = PITCH_DISPLAY_RANGE.low;
    const displayHigh = PITCH_DISPLAY_RANGE.high;

    // Padding: enough room for Y-axis labels on left and "now" on right
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
      const frac = 1 - age / (PITCH_TRACE_SECONDS * 1000);
      return plotLeft + frac * (plotRight - plotLeft);
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;

      const plotLeft = pad.left * dpr;
      const plotRight = w - pad.right * dpr;
      const plotTop = pad.top * dpr;
      const plotBottom = h - pad.bottom * dpr;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
      ctx.fillRect(0, 0, w, h);

      // Grid lines + labels
      const gridHz = [100, 150, 200, 250, 300, 350, 400];
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
      const now = Date.now();
      for (let sec = 0; sec <= PITCH_TRACE_SECONDS; sec += 5) {
        const x = timeToX(now - sec * 1000, now);
        if (x < plotLeft - 5 * dpr) continue;
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(sec === 0 ? "now" : `-${sec}s`, x, plotBottom + 4 * dpr);
      }

      // Target band
      const bandTop = hzToY(targetHigh);
      const bandBottom = hzToY(targetLow);
      ctx.fillStyle = COLORS.targetBand;
      ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);

      // Target band borders
      ctx.strokeStyle = COLORS.targetBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, bandTop);
      ctx.lineTo(plotRight, bandTop);
      ctx.moveTo(plotLeft, bandBottom);
      ctx.lineTo(plotRight, bandBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pitch trace line
      const data = pitchTraceRef.current;
      if (data.length < 2) {
        animId = requestAnimationFrame(draw);
        return;
      }

      ctx.lineWidth = 2.5 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      let inSegment = false;
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        const x = timeToX(pt.time, now);

        if (x < plotLeft) continue;

        if (!pt.voiced || pt.pitch === null) {
          // Gap — end current segment
          if (inSegment) {
            ctx.stroke();
            inSegment = false;
          }
          continue;
        }

        const y = hzToY(pt.pitch);
        const inTarget = pt.pitch >= targetLow && pt.pitch <= targetHigh;

        if (!inSegment) {
          ctx.beginPath();
          ctx.strokeStyle = inTarget ? COLORS.inTarget : COLORS.outOfTarget;
          ctx.moveTo(x, y);
          inSegment = true;
        } else {
          // Check if color needs to change
          const prevPt = data[i - 1];
          const prevInTarget =
            prevPt?.voiced &&
            prevPt.pitch !== null &&
            prevPt.pitch >= targetLow &&
            prevPt.pitch <= targetHigh;

          if (inTarget !== prevInTarget) {
            // Finish old segment, start new with different color
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = inTarget ? COLORS.inTarget : COLORS.outOfTarget;
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      if (inSegment) ctx.stroke();

      // Current position glow dot
      const lastVoiced = [...data].reverse().find((p) => p.voiced && p.pitch !== null);
      if (lastVoiced && now - lastVoiced.time < 500) {
        const x = timeToX(lastVoiced.time, now);
        const y = hzToY(lastVoiced.pitch);
        const inTarget =
          lastVoiced.pitch >= targetLow && lastVoiced.pitch <= targetHigh;
        const color = inTarget ? COLORS.inTarget : COLORS.outOfTarget;

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
  }, [pitchTraceRef]);

  // Readout
  const noteInfo = pitch ? hzToNote(pitch) : null;
  const inTarget =
    pitch !== null &&
    pitch >= DEFAULT_PITCH_TARGET.low &&
    pitch <= DEFAULT_PITCH_TARGET.high;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Hz + Note readout (hidden in compact mode) */}
      {!compact && (
        <div className="mt-3 flex items-baseline justify-center gap-3">
          <span
            className={`text-3xl font-light tabular-nums transition-opacity duration-300 ${
              !voiced && !holding
                ? "text-neutral-600 opacity-40"
                : holding
                  ? "text-white opacity-50"
                  : inTarget
                    ? "text-green-400"
                    : "text-red-400"
            }`}
          >
            {pitch !== null ? `${Math.round(pitch)} Hz` : "— Hz"}
          </span>
          {noteInfo && (
            <span
              className={`text-lg font-medium transition-opacity duration-300 ${
                holding ? "text-purple-400 opacity-50" : "text-purple-400"
              }`}
            >
              {noteInfo.name}
              <span className="text-xs text-neutral-500 ml-1">
                {noteInfo.cents >= 0 ? "+" : ""}
                {noteInfo.cents}¢
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
