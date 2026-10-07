// ResonanceMeter.jsx — Vertical thermometer for the ML perceived-gender
// score. Replaces the older ResonanceScoreTrace + ResonanceGauge pair.
// (A cue-strip redesign will replace this meter; until then it keeps its
// layout, with the no-regret fixes of 2026-10-07 below.)
//
// Layout:
//   - "Perceived voice" caption above the canvas (matches the styling of
//     the Vocal Weight title)
//   - main vertical bar fills from 0 (bottom, "Masculine") to the current
//     score (top, "Feminine") in ONE neutral colour; faint identical
//     bands mark the 0-30 and 70-100 ranges with the uncertain range in
//     between. No end of the scale is coloured as the goal — the user's
//     training direction doesn't change how this meter looks.
//   - horizontal indicator rides at the current score; opacity scales
//     with confidence so low-confidence predictions read dim
//   - thin history strip on the right shows the last ~10 scores fading
//     by age
//   - big score readout below the bar with a status line
//
// What it shows comes from perceivedVoiceView.js (pure, unit-tested,
// replayed by measurements/perceived-voice-gate-2026-10-07.md):
//   - a number only while the newest score is fresh (<= 1.2 s); the
//     worker only scores recent, voiced running speech, so a fresh score
//     is about the speech happening now. Stale scores are never held on
//     screen (the previous meter kept them up to 6 s whenever the DSP
//     gate was open — e.g. under noise above -50 dB);
//   - "updating…" while a voice onset is being collected (the first
//     score of an utterance waits until at most half its window predates
//     the onset);
//   - "needs running speech" on held vowels / sung notes (the worker's
//     held-phonation test), which the classifier reads near 50;
//   - nothing while no voice is heard.
//
// The middle 30-70 score band is the uncertain region: classifier
// confidence is by construction |score - 0.5| × 2, so "score in [30, 70]"
// and "confidence below ~0.4" describe the same windows.
//
// Scores arrive at ~6.7 Hz; the rAF loop tweens displayScore toward the
// latest sample with an exponential lerp so the indicator slides. Score
// and worker state are read from refs every frame, NOT React state (the
// shared ~5 fps setState throttle would drop most ML updates).

import { useRef, useEffect } from "react";
import { COLORS } from "../utils/constants";
import { perceivedVoiceView } from "./perceivedVoiceView";

// Score range thresholds (descriptive, not targets). Kept aligned with
// the visual band shading on the meter.
const SCORE_HIGH_FLOOR = 70;
const SCORE_LOW_CEILING = 30;

// How quickly the displayed score chases the latest sample, per rAF tick.
// 0.3 → ~95% of the way to the target after ~9 frames (~150 ms at 60 fps),
// settling comfortably inside the 200 ms inter-sample interval so the
// indicator is locked to the latest score before the next one arrives.
// Bigger = snappier, smaller = silkier but laggier.
const LERP_RATE = 0.3;

// History strip
const HISTORY_DOTS = 10;
const HISTORY_AGE_MS = 6000;

const STATUS_TEXT = {
  loading: "loading…",
  error: "unavailable",
  listening: "waiting for speech",
  updating: "updating…",
  sustained: "needs running speech",
};

export function ResonanceMeter({
  genderTraceRef,
  genderStateRef,
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
    let lastLabel = null;

    const pad = { left: 16, right: 16, top: 26, bottom: 60 };
    const HISTORY_COL_WIDTH = 18; // px (logical)

    function scoreToY(score, plotTop, plotBottom) {
      const frac = Math.max(0, Math.min(1, score / 100));
      return plotBottom - frac * (plotBottom - plotTop);
    }

    // One of the two outer ranges: faint fill + dashed edge line.
    function drawBand(fromScore, toScore, edgeScore, barLeft, barRight, plotTop, plotBottom, dpr) {
      const top = scoreToY(toScore, plotTop, plotBottom);
      const bottom = scoreToY(fromScore, plotTop, plotBottom);
      ctx.fillStyle = COLORS.meterBand;
      ctx.fillRect(barLeft, top, barRight - barLeft, bottom - top);
      const edge = scoreToY(edgeScore, plotTop, plotBottom);
      ctx.strokeStyle = COLORS.meterBandBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(barLeft, edge);
      ctx.lineTo(barRight, edge);
      ctx.stroke();
      ctx.setLineDash([]);
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

      // Top "Feminine" / bottom "Masculine" end labels (just above and
      // below the plot region inside the padding area).
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

      // The two outer ranges, drawn identically.
      drawBand(0, SCORE_LOW_CEILING, SCORE_LOW_CEILING, barLeft, barRight, plotTop, plotBottom, dpr);
      drawBand(SCORE_HIGH_FLOOR, 100, SCORE_HIGH_FLOOR, barLeft, barRight, plotTop, plotBottom, dpr);

      // What to show right now (number / updating / needs running speech /
      // nothing) — see perceivedVoiceView.js.
      const data = genderTraceRef?.current ?? [];
      // Entry `time` and the state's `ts` are worker epoch ms
      // (performance.timeOrigin + now()) — compare on the same clock.
      const now = Math.round(performance.timeOrigin + performance.now());
      const newest = data.length > 0 ? data[data.length - 1] : null;
      const view = perceivedVoiceView({
        now,
        modelStatus,
        dspGate: dspGateRef?.current ?? { voiced: false, holding: false },
        newest,
        voiceState: genderStateRef?.current ?? null,
      });
      const targetScore = view.score;
      const targetConf = targetScore === null ? 0 : (newest?.confidence ?? 0);

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
      const showNumber = dispScore != null && modelStatus === "ready";

      if (showNumber) {
        const fillTop = scoreToY(dispScore, plotTop, plotBottom);
        ctx.save();
        if (view.dim) ctx.globalAlpha = 0.55;
        ctx.fillStyle = COLORS.meterFill;
        ctx.fillRect(barLeft, fillTop, barWidth, plotBottom - fillTop);

        // Indicator at the top of the fill.
        const conf = Math.max(0, Math.min(1, displayConfRef.current));
        ctx.globalAlpha *= 0.4 + 0.6 * conf;
        const halo = ctx.createRadialGradient(barCx, fillTop, 2 * dpr, barCx, fillTop, 24 * dpr);
        halo.addColorStop(0, COLORS.meterIndicator);
        halo.addColorStop(1, "transparent");
        ctx.fillStyle = halo;
        ctx.fillRect(barLeft - 14 * dpr, fillTop - 24 * dpr, barWidth + 28 * dpr, 48 * dpr);

        ctx.strokeStyle = COLORS.meterIndicator;
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

      // History strip — last HISTORY_DOTS scores within HISTORY_AGE_MS,
      // skipping any whose `voiced` tag (the DSP gate's state when the
      // score arrived, set by useAudioPipeline) is false; entries without
      // the field count as voiced. Hidden while no voice is heard, so old
      // dots never stand in for a current reading.
      const colCx = barRight + 8 * dpr + historyColW / 2;
      if (view.status !== "listening") {
        const recent = [];
        for (let i = data.length - 1; i >= 0 && recent.length < HISTORY_DOTS; i--) {
          const pt = data[i];
          if (now - pt.time > HISTORY_AGE_MS) break;
          if (pt.voiced === false) continue;
          recent.push(pt);
        }
        ctx.fillStyle = COLORS.meterIndicator;
        for (let i = 0; i < recent.length; i++) {
          const pt = recent[i];
          const y = scoreToY(pt.score, plotTop, plotBottom);
          const ageFrac = (now - pt.time) / HISTORY_AGE_MS;
          ctx.globalAlpha = 0.15 + 0.5 * Math.max(0, 1 - ageFrac);
          ctx.beginPath();
          ctx.arc(colCx, y, 2.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Readout: the number in one neutral colour for every reading
      // (dimmed when it describes a moment ago), or a dash.
      ctx.fillStyle = !showNumber
        ? "rgba(180, 180, 180, 0.5)"
        : view.dim
          ? "rgba(220, 220, 220, 0.5)"
          : "rgba(235, 235, 235, 0.9)";
      ctx.font = `300 ${30 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const readoutY = plotBottom + 38 * dpr;
      ctx.fillText(showNumber ? String(Math.round(dispScore)) : "—", barCx, readoutY);

      // Status line below the readout.
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      const subtitle = showNumber
        ? dispScore >= SCORE_HIGH_FLOOR ? "in feminine range"
          : dispScore <= SCORE_LOW_CEILING ? "in masculine range"
            : "in uncertain range"
        : STATUS_TEXT[view.status] ?? "";
      ctx.fillText(subtitle, barCx, readoutY + 14 * dpr);

      // Text equivalent for assistive tech (and the browser checks):
      // written to the DOM only when it changes.
      const label = showNumber ? `${Math.round(dispScore)}, ${subtitle}` : subtitle;
      if (label !== lastLabel) {
        lastLabel = label;
        canvas.setAttribute("aria-label", `Perceived voice: ${label}`);
        canvas.dataset.status = showNumber ? "score" : view.status;
        canvas.dataset.score = showNumber ? String(Math.round(dispScore)) : "";
      }

      // Centre-of-bar notes, drawn on canvas so they track the refs.
      const midY = (plotTop + plotBottom) / 2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (view.status === "sustained") {
        ctx.fillStyle = "rgba(225, 225, 225, 0.9)";
        ctx.font = `${12 * dpr}px system-ui`;
        ctx.fillText("Needs running speech", barCx, midY - 9 * dpr);
        ctx.fillStyle = "rgba(180, 180, 180, 0.7)";
        ctx.font = `${10 * dpr}px system-ui`;
        ctx.fillText("held notes aren’t scored", barCx, midY + 8 * dpr);
      } else if (modelStatus === "ready" && data.length === 0 && view.status !== "updating") {
        // First-score hint. The first score lands ~0.5 s into speech.
        ctx.fillStyle = "rgba(180, 180, 180, 0.65)";
        ctx.font = `${11 * dpr}px system-ui`;
        ctx.fillText("Speak a sentence to see a reading", barCx, midY);
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
    // The DSP gate and worker state are read from refs inside draw() so
    // the rAF loop isn't torn down + recreated on every change (which can
    // happen several times per second under normal speech).
  }, [genderTraceRef, genderStateRef, dspGateRef, modelStatus]);

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
        <canvas ref={canvasRef} role="img" aria-label="Perceived voice" className="absolute inset-0 w-full h-full" />
        {overlay}
      </div>
    </div>
  );
}
