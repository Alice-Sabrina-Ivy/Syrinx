// cueMeterGeometry.js — the cue strip's meter geometry (CueStrip.jsx's twin
// columns): track, thumb and number sizes from the meter's measured box, and
// the band labels beside the track, stacked so they never touch. Pure (a
// canvas measures text where there is one, else an estimate), so the label
// layout is unit-tested (tests/audio/cue-meter-geometry-test.js; moved out of
// CueStrip.jsx in the 2026-10-26 review: nothing tested it).

export const OVERHANG = 7; // px the thumb reaches past the track on each side (the target outline: 6)

// Text width of the SVG labels: measured with a canvas in the page's font
// (an estimate where no canvas is available).
let measureCtx = null;
export function textWidth(s, fs, weight = 400) {
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${weight} ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return measureCtx.measureText(s).width;
  } catch {
    return s.length * fs * 0.56;
  }
}

// ---- one meter's geometry, from its measured box (px). Four width tiers:
// desktop (roomy), >= 180 px (448-wide phones), >= 156 px (402), narrower
// (360). The value along the meter follows
// axisPos() (cueStripModel.js): fraction 0 at the bottom, 1 at the top.
// The label column is sized for the full words at every tier ("typical" is
// narrower than "women", so the full labels cost no width; 2026-10-26 review:
// at 360 px the labels dropped "typical" for nothing).
const LABEL_WORDS = ["typical", "women", "men"];
export function meterGeometry(w, h, roomy) {
  const tier = roomy ? 3 : w >= 180 ? 2 : w >= 156 ? 1 : 0;
  const fs = [10, 11, 11, 12][tier];
  const trackW = [24, 28, 32, 36][tier];
  const labelW = Math.ceil(Math.max(textWidth("target", fs, 600), ...LABEL_WORDS.map((t) => textWidth(t, fs))));
  const trackX = labelW + 5 + OVERHANG;
  const endH = fs + 7; // the end word above / below the track
  const trackTop = endH;
  const trackBot = Math.max(trackTop + 40, h - endH);
  // The axis stops short of the pill's rounded caps, so a thumb pinned at an
  // end stays inside the track's outline.
  const inset = Math.max(9, trackW / 2 - 3);
  const axisTop = trackTop + inset, axisBot = trackBot - inset;
  return {
    tier, fs, lh: fs + 2, labelW, trackW, trackX, trackCx: trackX + trackW / 2,
    svgW: trackX + trackW + OVERHANG, trackTop, trackBot,
    y: (f) => axisBot - f * (axisBot - axisTop),
    thumbW: trackW + 2 * OVERHANG, thumbH: roomy ? 16 : 14, streakW: Math.round(trackW / 2),
    numFs: [22, 26, 30, 34][tier], subFs: [11, 12, 12, 13][tier], resFs: [12, 13, 14, 15][tier],
  };
}

// Band labels beside the track (left of it, right-aligned), centred on their
// band and pushed apart where they would touch; the target's label merges
// with the band it coincides with ("target / typical / women"), else sits
// on its own. Falls back to single-word labels when the full ones do not
// fit the track's height. -> [{ key, top, lines: [{ t, strong }] }]
export function stackLabels(items, top, bottom, lh) {
  const s = items.map((it) => ({ ...it, h: it.lines.length * lh })).sort((a, b) => a.cy - b.cy);
  let y = top;
  for (const it of s) { it.top = Math.max(it.cy - it.h / 2, y); y = it.top + it.h + 3; }
  let limit = bottom;
  for (let i = s.length - 1; i >= 0; i--) { if (s[i].top + s[i].h > limit) s[i].top = limit - s[i].h; limit = s[i].top - 3; }
  const fits = s.every((it, i) => it.top >= top - 0.5 && (i === 0 || it.top >= s[i - 1].top + s[i - 1].h + 2));
  return { items: s, fits };
}
export function bandLabels(G, bands, highlight) {
  const mid = (b) => G.y((b.x0 + b.x1) / 2);
  const same = (b) => !!highlight && !!b && Math.abs(b.x0 - highlight.x0) < 0.005 && Math.abs(b.x1 - highlight.x1) < 0.005;
  const build = (short) => {
    const items = [];
    let merged = false;
    for (const who of ["women", "men"]) {
      const b = bands?.[who];
      if (!b) continue;
      const tgt = same(b);
      merged ||= tgt;
      items.push({ key: who, cy: mid(b), lines: [...(tgt ? [{ t: "target", strong: true }] : []), ...(short ? [who] : ["typical", who]).map((t) => ({ t }))] });
    }
    if (highlight && !merged) items.push({ key: "target", cy: mid(highlight), lines: [{ t: "target", strong: true }] });
    return stackLabels(items, G.trackTop, G.trackBot, G.lh);
  };
  const full = build(false);
  return full?.fits ? full.items : build(true).items;
}
