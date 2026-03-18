// VowelSpacePlot.jsx — F1/F2 vowel space canvas with target zones, comet dot + fading trail line
// X-axis: F2 (reversed — high on left, low on right)
// Y-axis: F1 (inverted — low on top, high on bottom)

import { useRef, useEffect } from "react";
import {
  VOWEL_TARGETS,
  F1_RANGE,
  F2_RANGE,
  FORMANT_TRAIL_SECONDS,
  COLORS,
} from "../utils/constants";

export function VowelSpacePlot({
  formantTrailRef,
  voiced,
  holding,
  formants,
  compact = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Smoothed position for interpolation
  const smoothPosRef = useRef({ x: null, y: null });

  // Canvas sizing
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

    const padding = { top: 30, right: 20, bottom: 20, left: 20 };

    function f2ToX(f2) {
      const dpr = window.devicePixelRatio || 1;
      const plotLeft = padding.left * dpr;
      const plotRight = canvas.width - padding.right * dpr;
      // Reversed: high F2 on left, low F2 on right
      const frac = (f2 - F2_RANGE.low) / (F2_RANGE.high - F2_RANGE.low);
      return plotLeft + (1 - frac) * (plotRight - plotLeft);
    }

    function f1ToY(f1) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = padding.top * dpr;
      const plotBottom = canvas.height - padding.bottom * dpr;
      // Inverted: low F1 on top, high F1 on bottom
      const frac = (f1 - F1_RANGE.low) / (F1_RANGE.high - F1_RANGE.low);
      return plotTop + frac * (plotBottom - plotTop);
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
      ctx.fillRect(0, 0, w, h);

      const plotLeft = padding.left * dpr;
      const plotRight = w - padding.right * dpr;
      const plotTop = padding.top * dpr;
      const plotBottom = h - padding.bottom * dpr;

      // Grid lines
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.font = `${10 * dpr}px system-ui`;

      // F2 grid (X axis, reversed)
      const f2GridValues = [500, 1000, 1500, 2000, 2500, 3000];
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const f2 of f2GridValues) {
        if (f2 < F2_RANGE.low || f2 > F2_RANGE.high) continue;
        const x = f2ToX(f2);
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.fillStyle = COLORS.gridLabel;
        ctx.fillText(`${f2}`, x, plotTop - 14 * dpr);
      }

      // F1 grid (Y axis)
      const f1GridValues = [200, 400, 600, 800, 1000];
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const f1 of f1GridValues) {
        if (f1 < F1_RANGE.low || f1 > F1_RANGE.high) continue;
        const y = f1ToY(f1);
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
      }

      // Axis labels
      ctx.fillStyle = COLORS.gridLabel;
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("F2 (Hz) →", (plotLeft + plotRight) / 2, 2 * dpr);
      ctx.save();
      ctx.translate(10 * dpr, (plotTop + plotBottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "middle";
      ctx.fillText("← F1 (Hz)", 0, 0);
      ctx.restore();

      // Vowel target zones
      for (const vt of VOWEL_TARGETS) {
        const x1 = f2ToX(vt.f2[1]); // high F2 → left
        const x2 = f2ToX(vt.f2[0]); // low F2 → right
        const y1 = f1ToY(vt.f1[0]); // low F1 → top
        const y2 = f1ToY(vt.f1[1]); // high F1 → bottom

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;

        // Draw ellipse
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = vt.color;
        ctx.fill();
        ctx.strokeStyle = vt.color.replace("0.15", "0.4");
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = `${12 * dpr}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(vt.label, cx, cy);
      }

      // --- Comet trail: fading line from trail history ---
      const trail = formantTrailRef.current;
      const now = Date.now();
      const trailMs = FORMANT_TRAIL_SECONDS * 1000;

      // Build valid trail points (recent, in-range, voiced)
      const trailPts = [];
      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i];
        if (!pt.voiced || pt.f1 === null || pt.f2 === null) continue;
        if (pt.f1 < F1_RANGE.low || pt.f1 > F1_RANGE.high) continue;
        if (pt.f2 < F2_RANGE.low || pt.f2 > F2_RANGE.high) continue;
        const age = now - pt.time;
        if (age > trailMs) continue;
        trailPts.push({ x: f2ToX(pt.f2), y: f1ToY(pt.f1), age });
      }

      // Draw trail as a fading line (oldest to newest)
      if (trailPts.length >= 2) {
        for (let i = 1; i < trailPts.length; i++) {
          const prev = trailPts[i - 1];
          const curr = trailPts[i];
          const opacity = Math.max(0.05, 1 - curr.age / trailMs) * 0.6;
          const width = (1 + 2 * (1 - curr.age / trailMs)) * dpr;

          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.strokeStyle = `rgba(167, 139, 250, ${opacity})`;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
      }

      // --- Current position: single large glowing comet dot ---
      const f1 = formants?.f1;
      const f2 = formants?.f2;
      const inRange =
        f1 !== null &&
        f2 !== null &&
        f1 >= F1_RANGE.low &&
        f1 <= F1_RANGE.high &&
        f2 >= F2_RANGE.low &&
        f2 <= F2_RANGE.high;

      // Compute target position
      let targetX = smoothPosRef.current.x;
      let targetY = smoothPosRef.current.y;
      if (inRange) {
        targetX = f2ToX(f2);
        targetY = f1ToY(f1);
      }

      // Interpolate smoothly toward target (lerp)
      const smooth = smoothPosRef.current;
      if (smooth.x === null || smooth.y === null) {
        // First valid position — snap
        if (targetX !== null && targetY !== null) {
          smooth.x = targetX;
          smooth.y = targetY;
        }
      } else if (targetX !== null && targetY !== null) {
        const lerpFactor = 0.18;
        smooth.x += (targetX - smooth.x) * lerpFactor;
        smooth.y += (targetY - smooth.y) * lerpFactor;
      }

      if (smooth.x !== null && smooth.y !== null) {
        const x = smooth.x;
        const y = smooth.y;
        // During silence: freeze and dim to 30%
        const isActive = voiced || holding;
        const dotOpacity = isActive ? 1 : 0.3;
        const dotRadius = 13 * dpr;

        // Outer glow
        const glowR = 28 * dpr;
        const grad = ctx.createRadialGradient(x, y, dotRadius * 0.3, x, y, glowR);
        grad.addColorStop(0, `rgba(192, 132, 252, ${0.45 * dotOpacity})`);
        grad.addColorStop(0.5, `rgba(167, 139, 250, ${0.15 * dotOpacity})`);
        grad.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Main dot
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        const dotGrad = ctx.createRadialGradient(x, y, 0, x, y, dotRadius);
        dotGrad.addColorStop(0, `rgba(220, 200, 255, ${dotOpacity})`);
        dotGrad.addColorStop(0.6, `rgba(192, 132, 252, ${0.9 * dotOpacity})`);
        dotGrad.addColorStop(1, `rgba(167, 139, 250, ${0.7 * dotOpacity})`);
        ctx.fillStyle = dotGrad;
        ctx.fill();

        // White highlight
        ctx.beginPath();
        ctx.arc(x - 3 * dpr, y - 3 * dpr, 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * dotOpacity})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [formantTrailRef, formants, holding, voiced]);

  const f1 = formants?.f1;
  const f2 = formants?.f2;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* F1/F2 readout (hidden in compact mode) */}
      {!compact && (
        <div className="mt-3 flex items-baseline justify-center gap-4">
          <span
            className={`text-sm tabular-nums transition-opacity duration-300 ${
              !voiced && !holding
                ? "text-neutral-600 opacity-40"
                : holding
                  ? "text-neutral-300 opacity-50"
                  : "text-neutral-300"
            }`}
          >
            F1:{" "}
            <span className="text-base font-light">
              {f1 !== null ? `${Math.round(f1)} Hz` : "—"}
            </span>
          </span>
          <span
            className={`text-sm tabular-nums transition-opacity duration-300 ${
              !voiced && !holding
                ? "text-neutral-600 opacity-40"
                : holding
                  ? "text-neutral-300 opacity-50"
                  : "text-neutral-300"
            }`}
          >
            F2:{" "}
            <span className="text-base font-light">
              {f2 !== null ? `${Math.round(f2)} Hz` : "—"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
