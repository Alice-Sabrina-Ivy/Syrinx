// ResonanceMeter.jsx — Vertical thermometer for the ML perceived-gender
// score. Replaces the older ResonanceScoreTrace + ResonanceGauge pair.
//
// Layout:
//   - "Perceived voice" caption above the canvas (matches the styling of
//     SpectralTiltGauge's "Vocal Weight" title)
//   - main vertical bar fills from 0 (bottom, "Masculine") to current
//     score (top, "Feminine") with a warm→cool gradient; faint blue
//     band marks the feminine range at 70-100, faint orange band marks
//     the masculine range at 0-30, with a neutral uncertain band in
//     between (30-70)
//   - glowing horizontal indicator rides at the current score; opacity scales
//     with confidence so low-confidence predictions read dim
//   - thin history strip on the right shows the last ~10 inferences fading
//     by age
//   - big score readout below the bar with a three-way subtitle
//     ("in feminine range" / "in uncertain range" / "in masculine range")
//
// The middle 30-70 score band is treated as the uncertain region rather
// than a separate confidence threshold: classifier confidence is by
// construction |score - 0.5| × 2, so "score in [30, 70]" and "confidence
// below ~0.4" describe the same windows.
//
// The score arrives at ~6.7 Hz; the rAF loop tweens displayScore toward
// the latest sample with an exponential lerp so the indicator slides
// smoothly.
//
// Animation source: we read the most recent entry from `genderTraceRef`
// every frame, NOT React state. The ML worker pushes to that ref
// unconditionally, while the corresponding `genderScore` React state
// goes through a 200 ms throttle that's shared with the high-rate DSP
// path — DSP saturates the gate, so most ML state updates get dropped.
// Reading the ref directly bypasses that staleness.
//
// Voicedness gating: the meter blanks fully (bar, indicator, score
// number, history dots) when the DSP voicedness gate has determined no
// voice is present. Mirrors the pitch UI behaviour established in
// commit 8287b84 — without this, broadband ambient noise (AC, fans)
// that exceeds the ML worker's peak-amplitude VAD but isn't actually
// voiced was rendering as a confident perceived-voice score. The gate
// is the AND of intensity and SwiftF0 confidence in useAudioPipeline
// (post-Stage 4 cutover, 2026-05-06; previously OR + pYIN voicedness).
// We read the live gate state from `dspGateRef` each rAF tick rather
// than `voiced`/`holding` props — props go through a ~5 fps throttled
// setState and would lag the live gate noticeably. Holding state (the
// 5 s silence-hold after recent voice) keeps the meter at the last
// value so a brief breath doesn't blank.

import { useRef, useEffect } from "react";
import { COLORS } from "../utils/constants";

// Score range thresholds. Feminine ≥ 70, Masculine ≤ 30, Uncertain in
// between. Kept aligned with the visual band shading on the meter.
const SCORE_FEMININE_FLOOR = 70;
const SCORE_MASCULINE_CEILING = 30;

// How quickly the displayed score chases the latest sample, per rAF tick.
// 0.3 → ~95% of the way to the target after ~9 frames (~150 ms at 60 fps),
// settling comfortably inside the 200 ms inter-sample interval so the
// indicator is locked to the latest score before the next one arrives.
// Bigger = snappier, smaller = silkier but laggier.
const LERP_RATE = 0.3;

// History strip
const HISTORY_DOTS = 10;
const HISTORY_AGE_MS = 6000;

export function ResonanceMeter({
  genderTraceRef,
  dspGateRef,
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

      // Top "Feminine" / bottom "Masculine" labels (will sit just above
      // and below the plot region inside the padding area).
      ctx.fillStyle = COLORS.gridLabel;
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      ctx.fillText("Feminine", barCx, plotTop - 8 * dpr);
      ctx.textBaseline = "top";
      ctx.fillText("Masculine", barCx, plotBottom + 6 * dpr);

      // Bar background
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fillRect(barLeft, plotTop, barWidth, plotHeight);

      // Masculine range band 0-30
      const mascTop = scoreToY(SCORE_MASCULINE_CEILING, plotTop, plotBottom);
      const mascBottom = scoreToY(0, plotTop, plotBottom);
      ctx.fillStyle = COLORS.resMaleBand;
      ctx.fillRect(barLeft, mascTop, barWidth, mascBottom - mascTop);
      ctx.strokeStyle = COLORS.resMaleBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(barLeft, mascTop);
      ctx.lineTo(barRight, mascTop);
      ctx.stroke();

      // Feminine range band 70-100
      const femTop = scoreToY(100, plotTop, plotBottom);
      const femBottom = scoreToY(SCORE_FEMININE_FLOOR, plotTop, plotBottom);
      ctx.fillStyle = COLORS.resTargetBand;
      ctx.fillRect(barLeft, femTop, barWidth, femBottom - femTop);
      ctx.strokeStyle = COLORS.resTargetBandBorder;
      ctx.beginPath();
      ctx.moveTo(barLeft, femBottom);
      ctx.lineTo(barRight, femBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Read the latest score/confidence directly from the trace ref so
      // we're not at the mercy of the throttledSetState gate (see header
      // comment for why this matters).
      // Voicedness gating: when the DSP-side gate has determined no voice
      // is present (idle = !voiced && !holding), drive targetScore to
      // null so the bar/indicator/score-number all blank — same model
      // the pitch UI uses (commit 8287b84). Holding state (the 5 s
      // silence-hold after recent voice) keeps showing the last value;
      // a brief breath shouldn't blank the meter, only sustained silence
      // should. Without this gate, broadband ambient noise (AC, fans)
      // that exceeds the ML worker's peak-VAD threshold but isn't actually
      // voiced renders as a confident-looking score.
      const gate = dspGateRef?.current ?? { voiced: false, holding: false };
      const voiced = gate.voiced;
      const holding = gate.holding;
      const idle = !voiced && !holding;
      const data = genderTraceRef?.current ?? [];
      const latest = data.length > 0 ? data[data.length - 1] : null;
      const targetScore = idle ? null : (latest?.score ?? null);
      const targetConf = idle ? 0 : (latest?.confidence ?? 0);

      // Tween animation for the displayed score
      if (targetScore == null) {
        displayScoreRef.current = null;
      } else if (displayScoreRef.current == null) {
        displayScoreRef.current = targetScore;
      } else {
        displayScoreRef.current += (targetScore - displayScoreRef.current) * LERP_RATE;
      }
      displayConfRef.current += (targetConf - displayConfRef.current) * LERP_RATE;

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
      const now = Math.round(performance.timeOrigin + performance.now());
      const colCx = barRight + 8 * dpr + historyColW / 2;

      // Collect up to HISTORY_DOTS most recent points within HISTORY_AGE_MS,
      // skipping any whose `voiced` tag is false. The tag (added by
      // useAudioPipeline at emission time) records the DSP gate's state
      // when the ML score arrived. Without this filter, the strip's 6 s
      // retention overlaps the 5 s silence-hold and produces a 1 s window
      // of stale colored dots after the bar/indicator have blanked —
      // exactly the ambient-noise scenario this gate is supposed to fix.
      // Entries without the field (older sessions, HMR transitions) default
      // to voiced=true for backward compatibility.
      const recent = [];
      for (let i = data.length - 1; i >= 0 && recent.length < HISTORY_DOTS; i--) {
        const pt = data[i];
        if (now - pt.time > HISTORY_AGE_MS) break;
        if (pt.voiced === false) continue;
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

      // Three-way classification by score range. The middle band is the
      // uncertain region (see file header for why this collapses with
      // low classifier confidence).
      const inFeminineRange = dispScore != null && dispScore >= SCORE_FEMININE_FLOOR;
      const inMasculineRange = dispScore != null && dispScore <= SCORE_MASCULINE_CEILING;
      const inUncertainRange = dispScore != null && !inFeminineRange && !inMasculineRange;
      // `idle` is computed earlier in this draw() — the voicedness gate
      // for the bar/indicator. Reused here to dim the readout when no
      // voice is present.
      const readoutColor =
        modelStatus === "loading" || modelStatus === "error" || dispScore == null
          ? "rgba(180, 180, 180, 0.5)"
          : idle
            ? "rgba(120, 120, 120, 0.5)"
            : holding
              ? "rgba(220, 220, 220, 0.5)"
              : inUncertainRange
                ? "rgba(220, 220, 220, 0.7)"
                : inFeminineRange
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
        inFeminineRange ? "in feminine range" :
        inMasculineRange ? "in masculine range" :
        "in uncertain range";
      ctx.fillText(subtitle, barCx, readoutY + 14 * dpr);

      // First-score hint, drawn on canvas so it reflects the ref (which
      // is always current) rather than stale React state. The window
      // is 0.75 s so the first inference lands ~1 s after the user
      // starts speaking; "briefly" reads more naturally than a precise
      // duration that would need updating whenever the window changes.
      if (modelStatus === "ready" && data.length === 0) {
        ctx.fillStyle = "rgba(180, 180, 180, 0.65)";
        ctx.font = `${11 * dpr}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Speak briefly to see your first score",
          (plotLeft + plotRight) / 2,
          (plotTop + plotBottom) / 2,
        );
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
    // voiced/holding deliberately omitted: read from dspGateRef inside draw()
    // so the rAF loop doesn't get torn down + recreated on every gate flip
    // (which can happen multiple times per second under normal speech).
  }, [genderTraceRef, dspGateRef, modelStatus]);

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
  }
  // The first-score hint is drawn on the canvas itself (see the rAF
  // loop) so it can react to genderTraceRef updates without needing a
  // React re-render.

  return (
    <div className="flex flex-col h-full">
      <div className="text-[11px] sm:text-xs text-neutral-400 font-medium text-center mb-1.5">
        Perceived voice
      </div>
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
