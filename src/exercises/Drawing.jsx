// Drawing.jsx — a lesson card's line drawing (src/exercises/drawings.js: pure path data,
// viewBox 0 0 160 120) with its caption. Drawn with currentColor and opacity only; in
// Windows high contrast every line takes the system text colour (forced-colors classes:
// SVG strokes keep their colour otherwise) and the dashed ghost GrayText; the moving part is
// also marked by shape (an arrow, a dashed ghost of the other position), never by colour
// alone. Shown at most 160 x 120 px, two side by side when a card has two.

import { DRAWINGS } from "./drawings.js";

const PART = {
  line: { className: "text-neutral-300 forced-colors:text-[CanvasText]", fill: "none", stroke: "currentColor" },
  accent: { className: "text-purple-300 forced-colors:text-[CanvasText]", fill: "none", stroke: "currentColor" },
  ghost: { className: "text-neutral-500 forced-colors:text-[GrayText]", fill: "none", stroke: "currentColor", strokeDasharray: "4 3" },
  accentFill: { className: "text-purple-300 forced-colors:text-[CanvasText]", fill: "currentColor", fillOpacity: 0.18, stroke: "none" },
};

export function Drawing({ id, caption, alt }) {
  const d = DRAWINGS[id];
  if (!d) return null;
  return (
    <figure className="min-w-0 flex-1" style={{ maxWidth: 160 }} data-drawing={id}>
      <svg viewBox={d.viewBox} role="img" aria-label={alt} className="block w-full">
        {d.parts.map((p, i) => {
          const { className, ...attrs } = PART[p.kind] ?? PART.line;
          return (
            <path
              key={i} d={p.d} className={className} {...attrs}
              strokeWidth={attrs.stroke === "none" ? undefined : 2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <figcaption className="mt-1 text-xs leading-snug text-neutral-300">{caption}</figcaption>
    </figure>
  );
}

/** A card's drawings, side by side (before its text: they show the position the steps ask for). */
export function Drawings({ items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 flex gap-3" data-drawings="">
      {items.map((x) => <Drawing key={x.id} {...x} />)}
    </div>
  );
}
