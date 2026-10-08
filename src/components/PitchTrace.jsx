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
import { DIAG_ENABLED, noteTraceDraw } from "../diag/diag";

// Redraw at least this often while mounted, even without new data (ms).
const FALLBACK_MS = 100;

export function PitchTrace({
  pitchTraceRef,
  subscribeTrace = null,
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
  // Redraw request of the drawing effect (a direction change repaints at
  // once even if no data is arriving).
  const redrawRef = useRef(null);
  useEffect(() => { targetRef.current = target; redrawRef.current?.(); }, [target]);

  // Sizing + drawing in one effect (main-thread pass 2026-10-08,
  // measurements/main-thread-cpu-2026-10-08.md). The backing store follows
  // the container (ResizeObserver) and the device pixel ratio (a matchMedia
  // resolution query: dragging the window between monitors changes
  // devicePixelRatio WITHOUT firing ResizeObserver) — no layout read per
  // frame. What does not move with time (background, grid, labels, target
  // band) is drawn once into an offscreen canvas and copied each frame; the
  // plot geometry is computed once per size, not per point (canvas.width /
  // devicePixelRatio are DOM reads). With `subscribeTrace` (the hook's
  // append notification) it draws only when a point arrives — the trace
  // scrolls at the 25 ms data cadence (<= ~1.2 CSS px per step) instead of
  // asking for every display frame (an idle rAF loop alone costs the main
  // thread ~25 ms/s at 150 Hz); a 100 ms fallback keeps it scrolling if data
  // stops while it is mounted. Without it (no notifier), a rAF loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;
    const ctx = canvas.getContext("2d");
    let animId;
    let lastTargetAttr = null;
    // Diag only: paint latency + redraw cadence (noteTraceDraw).
    let diagLastNow = null, diagLastPointTime = -Infinity;
    const diagNote = (now, data, plotCssW) => {
      let newest = null;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].voiced && data[i].pitch !== null) { newest = data[i].time; break; }
      }
      const fresh = newest !== null && newest > diagLastPointTime ? newest : null;
      if (fresh !== null) diagLastPointTime = fresh;
      const step = diagLastNow === null ? null : ((now - diagLastNow) * plotCssW) / (PITCH_TRACE_SECONDS * 1000);
      diagLastNow = now;
      noteTraceDraw(performance.timeOrigin + performance.now(), fresh, step);
    };
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
    const traceMs = PITCH_TRACE_SECONDS * 1000;

    // Padding: enough room for Y-axis labels on left and "now" on right
    const pad = { left: 48, right: 28, top: 8, bottom: 24 };

    // Geometry of the current backing store; null = measure on next draw.
    let geo = null;
    // Static layer (background, grid, labels, band), keyed by size + band.
    const staticCanvas = document.createElement("canvas");
    const sctx = staticCanvas.getContext("2d");
    let staticKey = null;

    function measure() {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const bw = Math.round(rect.width * dpr), bh = Math.round(rect.height * dpr);
      if (bw > 0 && bh > 0 && (canvas.width !== bw || canvas.height !== bh)) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const w = canvas.width, h = canvas.height;
      geo = {
        dpr, w, h,
        plotLeft: pad.left * dpr,
        plotRight: w - pad.right * dpr,
        plotTop: pad.top * dpr,
        plotBottom: h - pad.bottom * dpr,
      };
    }

    // The same arithmetic as the per-call helpers these replaced, so every
    // coordinate (and pixel) is unchanged.
    function hzToY(hz) {
      const frac = (hz - displayLow) / (displayHigh - displayLow);
      return geo.plotBottom - frac * (geo.plotBottom - geo.plotTop);
    }
    function timeToX(t, now) {
      const age = now - t;
      const frac = 1 - age / traceMs;
      return geo.plotLeft + frac * (geo.plotRight - geo.plotLeft);
    }

    function drawStatic(band) {
      const { dpr, w, h, plotLeft, plotRight, plotBottom } = geo;
      staticCanvas.width = w;
      staticCanvas.height = h;
      const c = sctx;
      c.clearRect(0, 0, w, h);

      // Background
      c.fillStyle = "rgba(10, 10, 10, 0.95)";
      c.fillRect(0, 0, w, h);

      // Grid lines + labels
      const gridHz = [100, 150, 200, 250, 300, 350, 400];
      c.textAlign = "right";
      c.textBaseline = "middle";
      c.font = `${11 * dpr}px system-ui`;

      for (const hz of gridHz) {
        if (hz < displayLow || hz > displayHigh) continue;
        const y = hzToY(hz);
        c.strokeStyle = COLORS.grid;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(plotLeft, y);
        c.lineTo(plotRight, y);
        c.stroke();

        c.fillStyle = COLORS.gridLabel;
        c.fillText(`${hz}`, plotLeft - 6 * dpr, y);
      }

      // Time labels (their x does not depend on the clock)
      c.textAlign = "center";
      c.textBaseline = "top";
      for (let sec = 0; sec <= PITCH_TRACE_SECONDS; sec += 5) {
        const x = timeToX(-sec * 1000, 0);
        if (x < plotLeft - 5 * dpr) continue;
        c.fillStyle = COLORS.gridLabel;
        c.fillText(sec === 0 ? "now" : `-${sec}s`, x, plotBottom + 4 * dpr);
      }

      if (band) {
        const bandTop = hzToY(band.high);
        const bandBottom = hzToY(band.low);
        c.fillStyle = COLORS.targetBand;
        c.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);

        // Target band borders
        c.strokeStyle = COLORS.targetBandBorder;
        c.lineWidth = 1;
        c.setLineDash([4 * dpr, 4 * dpr]);
        c.beginPath();
        c.moveTo(plotLeft, bandTop);
        c.lineTo(plotRight, bandTop);
        c.moveTo(plotLeft, bandBottom);
        c.lineTo(plotRight, bandBottom);
        c.stroke();
        c.setLineDash([]);
      }
    }

    function draw() {
      if (!geo) measure();
      const { dpr, w, h, plotLeft, plotRight, plotTop, plotBottom } = geo;
      const now = Math.round(performance.timeOrigin + performance.now());

      // Target band (none without a training-direction target)
      const target = targetRef.current;
      const band = bandForDisplay(target, PITCH_DISPLAY_RANGE);
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
      const key = `${w}x${h}@${dpr}:${targetAttr}`;
      if (key !== staticKey) {
        staticKey = key;
        drawStatic(band);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(staticCanvas, 0, 0);

      // Pitch trace line
      const data = pitchTraceRef.current;
      if (data.length < 2) {
        if (DIAG_ENABLED) diagNote(now, data, (plotRight - plotLeft) / dpr);
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

      // The previous drawn point's colour is carried along (a gap ends the
      // segment, so it is only compared within a segment).
      let inSegment = false;
      let prevColor = null;
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
        const color = statusColor(pitchStatus(levelAt(data, i), target));

        if (!inSegment) {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.moveTo(x, y);
          inSegment = true;
        } else if (color !== prevColor) {
          // Finish old segment, start new with different color
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        prevColor = color;
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
        const color = statusColor(pitchStatus(levelAt(data, lastVoicedIdx), target));

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
      if (DIAG_ENABLED) diagNote(now, data, (plotRight - plotLeft) / dpr);
    }

    let pending = false;
    let lastDrawAt = -Infinity;
    function frame() {
      pending = false;
      draw();
      lastDrawAt = performance.now();
    }
    // At most one frame per burst of requests.
    function schedule() {
      if (pending) return;
      pending = true;
      animId = requestAnimationFrame(frame);
    }
    function loop() {
      draw();
      animId = requestAnimationFrame(loop);
    }
    redrawRef.current = subscribeTrace ? schedule : null;
    const unsubscribe = subscribeTrace ? subscribeTrace(schedule) : null;
    const fallback = subscribeTrace
      ? setInterval(() => { if (performance.now() - lastDrawAt >= FALLBACK_MS) schedule(); }, FALLBACK_MS)
      : null;

    // Size (container) and DPR (monitor switch, zoom) changes: re-measure
    // on the next draw.
    const invalidate = () => { geo = null; if (subscribeTrace) schedule(); };
    const observer = new ResizeObserver(invalidate);
    observer.observe(container);
    let mq = null;
    function onDpr() { invalidate(); watchDpr(); }
    function watchDpr() {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      mq?.addEventListener("change", onDpr);
    }
    watchDpr();

    if (subscribeTrace) schedule();
    else loop();
    return () => {
      cancelAnimationFrame(animId);
      unsubscribe?.();
      if (fallback !== null) clearInterval(fallback);
      redrawRef.current = null;
      observer.disconnect();
      mq?.removeEventListener("change", onDpr);
    };
  }, [pitchTraceRef, subscribeTrace]);

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
