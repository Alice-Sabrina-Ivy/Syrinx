// ResonanceMeter.jsx — Vertical thermometer for the ML perceived-gender
// score. Replaces the older ResonanceScoreTrace + ResonanceGauge pair.
//
// Layout:
//   - main vertical bar fills from 0 (bottom) to current score (top) with a
//     warm→cool gradient, target band shaded faint blue at 70-100, male band
//     faint orange at 0-30
//   - glowing horizontal indicator rides at the current score; opacity scales
//     with confidence so "uncertain" reads dim
//   - thin history strip on the right shows the last ~10 inferences fading
//     by age
//   - big score readout below the bar, color-coded
//
// The score arrives at 4 Hz; the rAF loop tweens displayScore toward the
// latest sample with an exponential lerp so the indicator slides smoothly.

import { useRef, useEffect } from "react";
import { COLORS } from "../utils/constants";

const SCORE_TARGET = 70;
const SCORE_MALE_CEILING = 30;
const LOW_CONFIDENCE = 0.3;

// How quickly the displayed score chases the latest sample, per rAF tick.
// 0.18 → ~95% of the way to the target after 16 frames (~270 ms at 60 fps),
// matching the 250 ms inter-sample interval. Bigger = snappier, smaller =
// silkier but laggier.
const LERP_RATE = 0.18;

// History strip
const HISTORY_DOTS = 10;
const HISTORY_AGE_MS = 6000;

export function ResonanceMeter({
  genderTraceRef,
  voiced,
  holding,
  genderScore,
  genderConfidence,
  modelStatus,
  modelProgress,
  modelError,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Animation state — kept in refs so the rAF loop doesn't re-render React.
  const displayScoreRef = useRef(null);
  const displayConfRef = useRef(0);

  // Resize handling
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

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const pad = { left: 16, right: 16, top: 26, bottom: 60 };
    const HISTORY_COL_WIDTH = 18; // px (logical)

    function scoreToY(score, plotTop, plotBottom) {
      const frac = Math.max(0, Math.min(1, score / 100));
      return plotBottom - frac * (plotBottom - plotTop);
    }

    function gradientColor(score) {
      // 0 → red/orange, 50 → yellow, 100 → blue/green target
      if (score <= 50) {
        const t = score / 50;
        const r = 239;
        const g = Math.round(68 + (200 - 68) * t);
        const b = Math.round(68 * (1 - t));
        return `rgb(${r}, ${g}, ${b})`;
      }
      const t = (score - 50) / 50;
      const r = Math.round(239 - (239 - 96) * t);
      const g = Math.round(200 + (165 - 200) * t);
      const b = Math.round(0 + 250 * t);
      return `rgb(${r}, ${g}, ${b})`;
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;

      const plotTop = pad.top * dpr;
      const plotBottom = h - pad.bottom * dpr;
      const plotLeft = pad.left * dpr;
      const plotRight = w - pad.right * dpr;
      const plotHeight = plotBottom - plotTop;

      // Reserve a thin column on the right for the history strip
      const historyColW = HISTORY_COL_WIDTH * dpr;
      const barRight = plotRight - historyColW - 8 * dpr;
      const barLeft = plotLeft + 8 * dpr;
      const barWidth = barRight - barLeft;
      const barCx = (barLeft + barRight) / 2;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
      ctx.fillRect(0, 0, w, h);

      // Top "Brighter" / bottom "Darker" labels (will sit just above and
      // below the plot region inside the padding area).
      ctx.fillStyle = COLORS.gridLabel;
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      ctx.fillText("Brighter", barCx, plotTop - 8 * dpr);
      ctx.textBaseline = "top";
      ctx.fillText("Darker", barCx, plotBottom + 6 * dpr);

      // Bar background
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fillRect(barLeft, plotTop, barWidth, plotHeight);

      // Male band 0-30
      const maleTop = scoreToY(SCORE_MALE_CEILING, plotTop, plotBottom);
      const maleBottom = scoreToY(0, plotTop, plotBottom);
      ctx.fillStyle = COLORS.resMaleBand;
      ctx.fillRect(barLeft, maleTop, barWidth, maleBottom - maleTop);
      ctx.strokeStyle = COLORS.resMaleBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(barLeft, maleTop);
      ctx.lineTo(barRight, maleTop);
      ctx.stroke();

      // Target band 70-100
      const tgtTop = scoreToY(100, plotTop, plotBottom);
      const tgtBottom = scoreToY(SCORE_TARGET, plotTop, plotBottom);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(barLeft, tgtTop, barWidth, tgtBottom - tgtTop);
      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.beginPath();
      ctx.moveTo(barLeft, tgtBottom);
      ctx.lineTo(barRight, tgtBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tween animation for the displayed score
      const target = genderScore;
      if (target == null) {
        displayScoreRef.current = null;
      } else if (displayScoreRef.current == null) {
        displayScoreRef.current = target;
      } else {
        displayScoreRef.current += (target - displayScoreRef.current) * LERP_RATE;
      }
      const displayConf = genderConfidence == null ? 0 : genderConfidence;
      displayConfRef.current += (displayConf - displayConfRef.current) * LERP_RATE;

      const dispScore = displayScoreRef.current;

      if (dispScore !== null && modelStatus === "ready") {
        // Filled portion: gradient orange→blue, top edge at the displayed score
        const fillTop = scoreToY(dispScore, plotTop, plotBottom);
        const grad = ctx.createLinearGradient(0, plotBottom, 0, plotTop);
        grad.addColorStop(0, "rgba(239, 68, 68, 0.65)");
        grad.addColorStop(0.5, "rgba(234, 179, 8, 0.65)");
        grad.addColorStop(1, "rgba(96, 165, 250, 0.65)");
        ctx.fillStyle = grad;
        ctx.fillRect(barLeft, fillTop, barWidth, plotBottom - fillTop);

        // Glowing indicator at the top of the fill.
        const indicatorColor = gradientColor(dispScore);
        const conf = Math.max(0, Math.min(1, displayConfRef.current));
        const glowAlpha = 0.4 + 0.6 * conf;

        ctx.save();
        ctx.globalAlpha = glowAlpha;
        // Halo
        const halo = ctx.createRadialGradient(barCx, fillTop, 2 * dpr, barCx, fillTop, 24 * dpr);
        halo.addColorStop(0, indicatorColor);
        halo.addColorStop(1, "transparent");
        ctx.fillStyle = halo;
        ctx.fillRect(barLeft - 14 * dpr, fillTop - 24 * dpr, barWidth + 28 * dpr, 48 * dpr);

        // Crisp horizontal line
        ctx.strokeStyle = indicatorColor;
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(barLeft - 4 * dpr, fillTop);
        ctx.lineTo(barRight + 4 * dpr, fillTop);
        ctx.stroke();
        ctx.restore();
      }

      // Bar outline
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(barLeft + 0.5, plotTop + 0.5, barWidth - 1, plotHeight - 1);

      // History strip — last HISTORY_DOTS recent inferences
      const data = genderTraceRef?.current ?? [];
      const now = Math.round(performance.timeOrigin + performance.now());
      const colCx = barRight + 8 * dpr + historyColW / 2;

      // Collect up to HISTORY_DOTS most recent points within HISTORY_AGE_MS
      const recent = [];
      for (let i = data.length - 1; i >= 0 && recent.length < HISTORY_DOTS; i--) {
        const pt = data[i];
        if (now - pt.time > HISTORY_AGE_MS) break;
        recent.push(pt);
      }
      // recent[0] is newest, recent[recent.length-1] is oldest
      for (let i = 0; i < recent.length; i++) {
        const pt = recent[i];
        const y = scoreToY(pt.score, plotTop, plotBottom);
        const ageFrac = (now - pt.time) / HISTORY_AGE_MS;
        const alpha = Math.max(0, 1 - ageFrac);
        ctx.fillStyle = gradientColor(pt.score);
        ctx.globalAlpha = 0.2 + 0.6 * alpha;
        ctx.beginPath();
        ctx.arc(colCx, y, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Number readout below the bar
      const inTarget = dispScore != null && dispScore >= SCORE_TARGET;
      const lowConf = displayConfRef.current < LOW_CONFIDENCE;
      const idle = !voiced && !holding;
      const readoutColor =
        modelStatus === "loading" || modelStatus === "error" || dispScore == null
          ? "rgba(180, 180, 180, 0.5)"
          : idle
            ? "rgba(120, 120, 120, 0.5)"
            : holding
              ? "rgba(220, 220, 220, 0.5)"
              : lowConf
                ? "rgba(220, 220, 220, 0.7)"
                : inTarget
                  ? COLORS.resInTarget
                  : COLORS.resOutOfTarget;

      ctx.fillStyle = readoutColor;
      ctx.font = `300 ${30 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const readoutText = dispScore == null ? "—" : String(Math.round(dispScore));
      const readoutY = plotBottom + 38 * dpr;
      ctx.fillText(readoutText, barCx, readoutY);

      // Subtitle below readout
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      const subtitle =
        modelStatus === "loading" ? "loading…" :
        modelStatus === "error" ? "unavailable" :
        dispScore == null ? "warming up" :
        lowConf ? "uncertain" :
        inTarget ? "in target" : "below target";
      ctx.fillText(subtitle, barCx, readoutY + 14 * dpr);

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [genderTraceRef, genderScore, genderConfidence, modelStatus, voiced, holding]);

  // Overlays for loading and error states (HTML, sits above the canvas)
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

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {overlay}
      </div>
    </div>
  );
}
