// cue-meter-geometry-test.js — src/components/cueMeterGeometry.js: the cue
// strip's twin-column meters (CueStrip.jsx) — the value axis inside the
// track, and the band labels beside it (stacked, never touching, inside the
// track's height, clear of the target outline; the full "typical …" words at
// every phone and desktop meter height, single words only on the shortest
// meters). Over every reachable meter height (100 px — the short-desktop and
// short-landscape floor — to 300 px), every direction, both cues and the four
// width tiers. Added in the 2026-10-26 review (nothing tested the labels).
//
//   node tests/audio/cue-meter-geometry-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bandLabels, meterGeometry, OVERHANG, stackLabels } from "../../src/components/cueMeterGeometry.js";
import { bandsFor, cueResonanceRef, highlightFor } from "../../src/components/cueStripModel.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SPK = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const CUE_BANDS = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/cue-bands.json"), "utf8"));
const vtlnRef = cueResonanceRef(SPK, CUE_BANDS);

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

const DIRECTIONS = ["feminine", "masculine", "androgynous", "exploring"];
// one width per tier (< 156, 156-179, >= 180) plus the roomy desktop tier
const TIERS = [{ w: 140, roomy: false }, { w: 160, roomy: false }, { w: 190, roomy: false }, { w: 200, roomy: true }];
const HEIGHTS = [];
for (let h = 100; h <= 300; h += 2) HEIGHTS.push(h);

let cases = 0;
const bad = { overlap: [], outside: [], short: [], outline: [], target: [], axis: [] };
for (const cue of ["pitch", "resonance"]) {
  const bands = cue === "pitch" ? bandsFor("pitch") : bandsFor("resonance", vtlnRef);
  for (const direction of DIRECTIONS) {
    const highlight = cue === "pitch" ? highlightFor("pitch", direction) : highlightFor("resonance", direction, vtlnRef);
    for (const { w, roomy } of TIERS) {
      for (const h of HEIGHTS) {
        cases++;
        const G = meterGeometry(w, h, roomy);
        const id = `${cue} ${direction} w${w}${roomy ? " roomy" : ""} h${h}`;
        // the value axis runs bottom (0) to top (1), inside the track
        if (!(G.y(0) > G.y(1) && G.y(1) >= G.trackTop && G.y(0) <= G.trackBot)) bad.axis.push(id);
        // the labels end left of the target outline (trackX - 6) and the thumb's overhang
        if (!(G.labelW < G.trackX - Math.max(6, OVERHANG))) bad.outline.push(id);
        const labels = bandLabels(G, bands, highlight);
        const s = [...labels].sort((a, b) => a.top - b.top);
        for (let i = 1; i < s.length; i++) {
          if (s[i].top < s[i - 1].top + s[i - 1].lines.length * G.lh + 2) { bad.overlap.push(id); break; }
        }
        if (s.some((l) => l.top < G.trackTop - 0.5 || l.top + l.lines.length * G.lh > G.trackBot + 0.5)) bad.outside.push(id);
        // the full words wherever a phone or desktop meter can be (>= 150 px)
        const full = labels.filter((l) => l.key !== "target").every((l) => l.lines.some((ln) => ln.t === "typical"));
        if (h >= 150 && !full) bad.short.push(id);
        // the target word: once with a target, never without; merged into the band label it coincides with
        // (feminine / masculine pitch), on its own otherwise (androgynous, and resonance's between-bands outline)
        const targets = labels.flatMap((l) => l.lines.filter((ln) => ln.t === "target").map(() => l.key));
        const wantMerged = cue === "pitch" && (direction === "feminine" || direction === "masculine");
        const okTarget = !highlight ? targets.length === 0
          : targets.length === 1 && (wantMerged ? targets[0] === (direction === "feminine" ? "women" : "men") : true);
        if (!okTarget) bad.target.push(`${id}: ${targets.join(",")}`);
      }
    }
  }
}
const show = (a) => `${a.length}: ${a.slice(0, 4).join(" | ")}`;
check(`meter axis: 0 at the bottom, 1 at the top, inside the track (${cases} cases)`, bad.axis.length === 0, show(bad.axis));
check("band labels never touch (>= 2 px apart) at any meter height 100-300 px, every direction, both cues, every tier", bad.overlap.length === 0, show(bad.overlap));
check("band labels stay within the track's height", bad.outside.length === 0, show(bad.outside));
check("band labels end left of the target outline and the thumb's overhang", bad.outline.length === 0, show(bad.outline));
check("full labels (\"typical women\" / \"typical men\") on every meter >= 150 px tall", bad.short.length === 0, show(bad.short));
check("one \"target\" word with a target (merged into its band's label for feminine / masculine pitch), none for exploring", bad.target.length === 0, show(bad.target));

// stackLabels itself: two labels wanting the same place are pushed apart; ones that cannot fit report it
{
  const two = stackLabels([{ key: "a", cy: 50, lines: [{ t: "x" }] }, { key: "b", cy: 50, lines: [{ t: "y" }] }], 0, 100, 12);
  check("stackLabels: two labels at the same centre are pushed apart and fit", two.fits && two.items[1].top >= two.items[0].top + 12 + 2, JSON.stringify(two));
  const tight = stackLabels([{ key: "a", cy: 5, lines: [{ t: "x" }, { t: "y" }] }, { key: "b", cy: 6, lines: [{ t: "z" }, { t: "w" }] }], 0, 30, 12);
  check("stackLabels: labels taller than the space report that they do not fit", !tight.fits, JSON.stringify(tight));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
