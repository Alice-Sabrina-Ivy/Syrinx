// VowelSpaceScatter.jsx — 2D scatter of F1 (y) vs F2 (x) with reference vowel clouds.
// Phonetics-convention axes: both inverted so /i/ sits top-left and /a/ bottom-center.
// Reference data: Hillenbrand et al. 1995 adult male/female formant means.

import { useRef, useEffect } from "react";

// Hillenbrand 1995 adult means for General American English.
// Format: { ipa, label, f1, f2 }
const MALE_VOWELS = [
  { ipa: "i",  word: "beet",   f1: 342, f2: 2322 },
  { ipa: "ɪ", word: "bit",    f1: 427, f2: 2034 },
  { ipa: "ɛ", word: "bet",    f1: 580, f2: 1799 },
  { ipa: "æ", word: "bat",    f1: 588, f2: 1952 },
  { ipa: "ɑ", word: "bot",    f1: 768, f2: 1333 },
  { ipa: "ɔ", word: "bought", f1: 652, f2: 997  },
  { ipa: "o",  word: "boat",   f1: 497, f2: 910  },
  { ipa: "ʊ", word: "book",   f1: 469, f2: 1122 },
  { ipa: "u",  word: "boot",   f1: 378, f2: 997  },
  { ipa: "ʌ", word: "but",    f1: 623, f2: 1200 },
];

const FEMALE_VOWELS = [
  { ipa: "i",  word: "beet",   f1: 437, f2: 2761 },
  { ipa: "ɪ", word: "bit",    f1: 483, f2: 2365 },
  { ipa: "ɛ", word: "bet",    f1: 731, f2: 2058 },
  { ipa: "æ", word: "bat",    f1: 669, f2: 2349 },
  { ipa: "ɑ", word: "bot",    f1: 936, f2: 1551 },
  { ipa: "ɔ", word: "bought", f1: 781, f2: 1136 },
  { ipa: "o",  word: "boat",   f1: 555, f2: 1035 },
  { ipa: "ʊ", word: "book",   f1: 519, f2: 1225 },
  { ipa: "u",  word: "boot",   f1: 459, f2: 1105 },
  { ipa: "ʌ", word: "but",    f1: 753, f2: 1426 },
];

// Axis ranges cover both clouds with a bit of headroom.
const F2_RANGE = { low: 700, high: 3000 };   // x-axis (inverted)
const F1_RANGE = { low: 250, high: 1050 };   // y-axis (inverted)

const TRAIL_SECONDS = 3.5; // how long recent points persist

// Build a convex hull for a set of points so we can draw the vowel cloud outline.
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function VowelSpaceScatter({ formantTrailRef, formants, voiced, holding }) {
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

    const pad = { left: 52, right: 16, top: 16, bottom: 34 };

    function f2ToX(f2) {
      const dpr = window.devicePixelRatio || 1;
      const plotLeft = pad.left * dpr;
      const plotRight = canvas.width - pad.right * dpr;
      // Inverted: high F2 on the left
      const frac = (F2_RANGE.high - f2) / (F2_RANGE.high - F2_RANGE.low);
      return plotLeft + frac * (plotRight - plotLeft);
    }

    function f1ToY(f1) {
      const dpr = window.devicePixelRatio || 1;
      const plotTop = pad.top * dpr;
      const plotBottom = canvas.height - pad.bottom * dpr;
      // Inverted: low F1 on top
      const frac = (f1 - F1_RANGE.low) / (F1_RANGE.high - F1_RANGE.low);
      return plotTop + frac * (plotBottom - plotTop);
    }

    function drawCloud(vowels, fillStyle, strokeStyle, labelColor, dpr) {
      const screenPts = vowels.map((v) => ({ x: f2ToX(v.f2), y: f1ToY(v.f1), v }));
      const hull = convexHull(screenPts);

      // Filled polygon
      ctx.beginPath();
      hull.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vowel markers + IPA labels
      ctx.font = `600 ${12 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const p of screenPts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = strokeStyle;
        ctx.fill();
        ctx.fillStyle = labelColor;
        ctx.fillText(p.v.ipa, p.x + 10 * dpr, p.y);
      }
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

      // Grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";

      // Vertical grid lines (F2) — label along bottom
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let hz = 1000; hz <= 3000; hz += 500) {
        const x = f2ToX(hz);
        if (x < plotLeft || x > plotRight) continue;
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.fillText(`${hz}`, x, plotBottom + 4 * dpr);
      }

      // Horizontal grid lines (F1) — label along left
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let hz = 300; hz <= 1000; hz += 200) {
        const y = f1ToY(hz);
        if (y < plotTop || y > plotBottom) continue;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.fillText(`${hz}`, plotLeft - 6 * dpr, y);
      }

      // Axis titles
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.font = `${11 * dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("F2 (Hz) → tongue frontness", (plotLeft + plotRight) / 2, h - 4 * dpr);
      // F1 axis title, rotated
      ctx.save();
      ctx.translate(12 * dpr, (plotTop + plotBottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("F1 (Hz) → tongue height", 0, 0);
      ctx.restore();

      // Male vowel cloud (warm amber)
      drawCloud(
        MALE_VOWELS,
        "rgba(251, 146, 60, 0.07)",
        "rgba(251, 146, 60, 0.55)",
        "rgba(251, 146, 60, 0.75)",
        dpr,
      );

      // Female vowel cloud (cool blue)
      drawCloud(
        FEMALE_VOWELS,
        "rgba(96, 165, 250, 0.10)",
        "rgba(96, 165, 250, 0.70)",
        "rgba(147, 197, 253, 0.90)",
        dpr,
      );

      // Legend
      ctx.font = `${10 * dpr}px system-ui`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const legendY = plotTop + 8 * dpr;
      let legendX = plotRight - 150 * dpr;
      ctx.fillStyle = "rgba(251, 146, 60, 0.85)";
      ctx.beginPath();
      ctx.arc(legendX, legendY, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.fillText("male ref.", legendX + 8 * dpr, legendY);
      legendX = plotRight - 70 * dpr;
      ctx.fillStyle = "rgba(96, 165, 250, 0.9)";
      ctx.beginPath();
      ctx.arc(legendX, legendY, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.fillText("female ref.", legendX + 8 * dpr, legendY);

      // Live trail from formantTrailRef — fade by age
      const data = formantTrailRef?.current || [];
      const now = Math.round(performance.timeOrigin + performance.now());
      const windowMs = TRAIL_SECONDS * 1000;

      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        if (!pt.voiced || pt.f1 == null || pt.f2 == null) continue;
        const age = now - pt.time;
        if (age > windowMs) continue;
        if (pt.f1 < F1_RANGE.low || pt.f1 > F1_RANGE.high) continue;
        if (pt.f2 < F2_RANGE.low || pt.f2 > F2_RANGE.high) continue;
        const alpha = 1 - age / windowMs;
        const x = f2ToX(pt.f2);
        const y = f1ToY(pt.f1);
        ctx.beginPath();
        ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232, 121, 249, ${0.15 + alpha * 0.45})`;
        ctx.fill();
      }

      // Current position: glowing dot
      const f1 = formants?.f1;
      const f2 = formants?.f2;
      const showLive = (voiced || holding) && f1 != null && f2 != null &&
        f1 >= F1_RANGE.low && f1 <= F1_RANGE.high &&
        f2 >= F2_RANGE.low && f2 <= F2_RANGE.high;
      if (showLive) {
        const x = f2ToX(f2);
        const y = f1ToY(f1);
        const coreColor = holding ? "rgba(232, 121, 249, 0.55)" : "rgba(232, 121, 249, 1)";
        const glowColor = holding ? "rgba(232, 121, 249, 0.35)" : "rgba(232, 121, 249, 0.85)";
        const grad = ctx.createRadialGradient(x, y, 2 * dpr, x, y, 14 * dpr);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, 14 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 5.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = coreColor;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, [formantTrailRef, formants, voiced, holding]);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-neutral-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="mt-2 text-center text-[11px] text-neutral-500 leading-relaxed">
        Your vowel position in real time. Bright dot = now; fading dots = last few seconds.
        Pull your articulation toward the <span className="text-blue-300">blue cloud</span> and
        away from the <span className="text-orange-300">amber cloud</span>.
      </div>
    </div>
  );
}
