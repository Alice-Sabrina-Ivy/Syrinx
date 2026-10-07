// PitchTrace.jsx — Scrolling canvas pitch trace (last 15 seconds)
// With a target (the user's training direction): band drawn, and the line
// coloured by the pitch LEVEL at each point (utils/pitchLevel.js: median
// of the last 1.5 s) — green on target, red off target, neutral past the
// band in the direction of travel. The bands are ranges of average
// speaking pitch, so intonation peaks and dips don't flip the colour.
// With no target ("Just exploring" / not chosen yet): no band, neutral
// line. Gaps during silence.

import { useRef, useEffect } from "react";
import { hzToNote } from "../utils/pitchUtils";
import { SteadinessReadout } from "./SteadinessReadout";
import {
  PITCH_DISPLAY_RANGE,
  PITCH_TRACE_SECONDS,
  COLORS,
  statusColor,
  statusTextClass,
} from "../utils/constants";
import { pitchStatus, bandForDisplay } from "../utils/trainingDirection";
import { pitchLevelAt } from "../utils/pitchLevel";

export function PitchTrace({
  pitchTraceRef,
  voiced,
  holding,
  pitch,
  pitchLevel = null,
  target = null,
  steadiness = null,
  steadinessHeld = false,
  compact = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Read by the rAF loop each frame, so a direction change mid-session
  // repaints the band and colours on the next frame without tearing the
  // loop down. Synced post-render (refs must not be written during render).
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; }, [target]);

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
    let lastTargetAttr = null;
    // Pitch level per trace point, computed once — when the point is first
    // drawn, from the points before it — so a point's colour never changes
    // as it scrolls. Points are objects the hook appends and trims.
    const levels = new WeakMap();
    const levelAt = (data, i) => {
      const pt = data[i];
      let lv = levels.get(pt);
      if (lv === undefined) {
        lv = pitchLevelAt(data, pt.time, undefined, i);
        levels.set(pt, lv);
      }
      return lv;
    };

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
      // DPR-change guard: dragging the window between monitors changes
      // devicePixelRatio WITHOUT firing ResizeObserver (CSS size
      // unchanged), leaving the backing store sized for the old dpr
      // while the layout math below uses the new one — clipped plots
      // and oversized labels until a real resize. Re-sync per frame.
      {
        const c = containerRef.current;
        if (c) {
          const rect = c.getBoundingClientRect();
          const bw = Math.round(rect.width * dpr), bh = Math.round(rect.height * dpr);
          if (bw > 0 && bh > 0 && (canvas.width !== bw || canvas.height !== bh)) {
            canvas.width = bw;
            canvas.height = bh;
          }
        }
      }
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
      const now = Math.round(performance.timeOrigin + performance.now());
      for (let sec = 0; sec <= PITCH_TRACE_SECONDS; sec += 5) {
        const x = timeToX(now - sec * 1000, now);
        if (x < plotLeft - 5 * dpr) continue;
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(sec === 0 ? "now" : `-${sec}s`, x, plotBottom + 4 * dpr);
      }

      // Target band (none without a training-direction target)
      const target = targetRef.current;
      const band = bandForDisplay(target, PITCH_DISPLAY_RANGE);
      const colorFor = (data, i) => statusColor(pitchStatus(levelAt(data, i), target));
      // The drawn target, mirrored to the DOM for assistive tech / checks
      // (written only when it changes).
      const targetAttr = band ? `${band.low}-${band.high}` : "none";
      if (targetAttr !== lastTargetAttr) {
        lastTargetAttr = targetAttr;
        canvas.dataset.target = targetAttr;
        canvas.setAttribute("aria-label", band
          ? `Pitch trace, target ${band.low} to ${band.high} Hz`
          : "Pitch trace, no target range");
      }
      if (band) {
        const bandTop = hzToY(band.high);
        const bandBottom = hzToY(band.low);
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
      }

      // Pitch trace line
      const data = pitchTraceRef.current;
      if (data.length < 2) {
        animId = requestAnimationFrame(draw);
        return;
      }

      ctx.lineWidth = 2.5 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Clip the trace + glow dot to the plot rectangle so a pitch
      // outside the display range can never paint over the axis labels
      // or below the chart. The pitch worker only posts values inside
      // PITCH_DISPLAY_RANGE (detector floor = display floor; decodes
      // above the display ceiling post as unvoiced, 2026-10-03), so this
      // shouldn't fire, but the clip is a structural guarantee against
      // the under-chart artifact recurring if the ranges ever drift
      // apart again (2026-06-10).
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
      ctx.clip();

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
        const color = colorFor(data, i);

        if (!inSegment) {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.moveTo(x, y);
          inSegment = true;
        } else {
          // Check if color needs to change
          const prevPt = data[i - 1];
          const prevColor =
            prevPt?.voiced && prevPt.pitch !== null ? colorFor(data, i - 1) : null;

          if (color !== prevColor) {
            // Finish old segment, start new with different color
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      if (inSegment) ctx.stroke();

      // Current position glow dot (backward scan avoids array copy + reverse)
      let lastVoiced = null, lastVoicedIdx = -1;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].voiced && data[i].pitch !== null) { lastVoiced = data[i]; lastVoicedIdx = i; break; }
      }
      if (lastVoiced && now - lastVoiced.time < 500) {
        const x = timeToX(lastVoiced.time, now);
        const y = hzToY(lastVoiced.pitch);
        const color = colorFor(data, lastVoicedIdx);

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

      ctx.restore(); // end plot-rect clip


      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [pitchTraceRef]);

  // Readout: the number is this moment's pitch; its colour judges the
  // pitch level, like the trace (null target = neutral).
  const noteInfo = pitch ? hzToNote(pitch) : null;
  const levelStatus = pitch !== null ? pitchStatus(pitchLevel, target) : null;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} role="img" aria-label="Pitch trace" className="absolute inset-0 w-full h-full" />
      </div>

      {/* Hz + Note + steadiness readout (hidden in compact mode) */}
      {!compact && (
        <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
          <span
            className={`text-3xl font-light tabular-nums transition-opacity duration-300 ${
              !voiced && !holding
                ? "text-neutral-600 opacity-40"
                : holding
                  ? "text-white opacity-50"
                  : statusTextClass(levelStatus)
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
          <SteadinessReadout value={steadiness} held={steadinessHeld} variant="inline" />
        </div>
      )}
    </div>
  );
}
