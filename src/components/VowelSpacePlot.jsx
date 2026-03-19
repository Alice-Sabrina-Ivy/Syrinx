// VowelSpacePlot.jsx — F1/F2 vowel space canvas with target zones
// Single glowing comet dot that slides smoothly, with a fading polyline trail.
// X-axis: F2 (reversed — high on left, low on right)
// Y-axis: F1 (inverted — low on top, high on bottom)

import { useRef, useEffect } from "react";
import {
  VOWEL_TARGETS,
  F1_RANGE,
  F2_RANGE,
  COLORS,
} from "../utils/constants";

// Trail: store last ~40 screen positions (drawn as fading polyline)
const TRAIL_LENGTH = 40;

export function VowelSpacePlot({
  formantTrailRef,
  voiced,
  holding,
  formants,
  compact = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // Smoothed screen position (lerp target)
  const posRef = useRef({ x: null, y: null });
  // Trail of past screen positions for the polyline
  const trailRef = useRef([]);

  // "Latest ref" pattern: store props in refs so the rAF loop can read
  // current values without restarting the useEffect on every render.
  const formantRef = useRef(formants);
  const voicedRef = useRef(voiced);
  const holdingRef = useRef(holding);
  formantRef.current = formants;
  voicedRef.current = voiced;
  holdingRef.current = holding;

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
    let frameCount = 0;

    const padding = { top: 30, right: 20, bottom: 20, left: 20 };

    function f2ToX(f2) {
      const dpr = window.devicePixelRatio || 1;
      const plotLeft = padding.left * dpr;
      const plotRight = canvas.width - padding.right * dpr;
      const frac = (f2 - F2_RANGE.low) / (F2_RANGE.high - F2_RANGE.low);
      return plotLeft + (1 - frac) * (plotRight - plotLeft);
    }

    function f1ToY(f1) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = padding.top * dpr;
      const plotBottom = canvas.height - padding.bottom * dpr;
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

      // --- Grid lines ---
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
      ctx.fillText("F2 (Hz) \u2192", (plotLeft + plotRight) / 2, 2 * dpr);
      ctx.save();
      ctx.translate(10 * dpr, (plotTop + plotBottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "middle";
      ctx.fillText("\u2190 F1 (Hz)", 0, 0);
      ctx.restore();

      // --- Vowel target zones ---
      for (const vt of VOWEL_TARGETS) {
        const x1 = f2ToX(vt.f2[1]);
        const x2 = f2ToX(vt.f2[0]);
        const y1 = f1ToY(vt.f1[0]);
        const y2 = f1ToY(vt.f1[1]);

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;

        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = vt.color;
        ctx.fill();
        ctx.strokeStyle = vt.color.replace("0.15", "0.4");
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = `${12 * dpr}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(vt.label, cx, cy);
      }

      // --- Comet dot + trail ---
      const curFormants = formantRef.current;
      const curVoiced = voicedRef.current;
      const curHolding = holdingRef.current;
      const f1 = curFormants?.f1;
      const f2 = curFormants?.f2;
      const hasTarget =
        f1 != null &&
        f2 != null &&
        f1 >= F1_RANGE.low &&
        f1 <= F1_RANGE.high &&
        f2 >= F2_RANGE.low &&
        f2 <= F2_RANGE.high;
      const isActive = curVoiced || curHolding;

      const pos = posRef.current;
      const trail = trailRef.current;

      if (hasTarget && isActive) {
        const targetX = f2ToX(f2);
        const targetY = f1ToY(f1);

        if (pos.x === null || pos.y === null) {
          // First valid position — snap immediately
          pos.x = targetX;
          pos.y = targetY;
        } else {
          // Smooth interpolation toward target
          pos.x += (targetX - pos.x) * 0.2;
          pos.y += (targetY - pos.y) * 0.2;
        }

        // Push current position to trail every other frame (~30fps trail update)
        frameCount++;
        if (frameCount % 2 === 0) {
          trail.push({ x: pos.x, y: pos.y });
          if (trail.length > TRAIL_LENGTH) trail.shift();
        }
      }
      // During silence: don't update pos (freeze), don't push to trail

      // Draw trail as fading polyline
      if (trail.length >= 2) {
        for (let i = 1; i < trail.length; i++) {
          const opacity = (i / trail.length) * (isActive ? 0.6 : 0.15);
          const width = (0.5 + 2.5 * (i / trail.length)) * dpr;

          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = `rgba(167, 139, 250, ${opacity})`;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.stroke();
        }
      }

      // Draw the single comet dot
      if (pos.x !== null && pos.y !== null) {
        const dotOpacity = isActive ? 1.0 : 0.3;
        const dotRadius = 12 * dpr;

        // Outer glow
        const glowR = 26 * dpr;
        const glow = ctx.createRadialGradient(pos.x, pos.y, dotRadius * 0.3, pos.x, pos.y, glowR);
        glow.addColorStop(0, `rgba(192, 132, 252, ${0.4 * dotOpacity})`);
        glow.addColorStop(0.5, `rgba(167, 139, 250, ${0.12 * dotOpacity})`);
        glow.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Main filled dot
        const dotGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, dotRadius);
        dotGrad.addColorStop(0, `rgba(230, 210, 255, ${dotOpacity})`);
        dotGrad.addColorStop(0.5, `rgba(192, 132, 252, ${0.9 * dotOpacity})`);
        dotGrad.addColorStop(1, `rgba(147, 100, 220, ${0.7 * dotOpacity})`);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = dotGrad;
        ctx.fill();

        // Small highlight for 3D effect
        ctx.beginPath();
        ctx.arc(pos.x - 3 * dpr, pos.y - 3 * dpr, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * dotOpacity})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Reads formants/voiced/holding from refs — no deps needed

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
              {f1 != null ? `${Math.round(f1)} Hz` : "\u2014"}
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
              {f2 != null ? `${Math.round(f2)} Hz` : "\u2014"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
