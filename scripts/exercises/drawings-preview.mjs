// drawings-preview.mjs — renders the guided exercises' line drawings (src/exercises/drawings.js)
// to PNG for review: every drawing and the contrast pairs side by side, on the app's card
// background, at 1x (160 × 120, the size the card shows) and 3x, plus a forced-colors look
// (line and ghost black on white, accent strong blue) to check that the moving part still
// reads by shape when colour is gone.
//
//   node scripts/exercises/drawings-preview.mjs [--chrome=<path to chrome>] [--out=<dir>]
//
// Output: build/exercises-drawings/ (gitignored). Process hygiene (CLAUDE.md hard rule 2):
// Chrome is launched by puppeteer with its own temporary profile and closed with
// browser.close(), which ends only the process it started.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { DRAWINGS } from "../../src/exercises/drawings.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, dflt) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const CHROME = arg("chrome", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome");
const OUT = path.resolve(arg("out", path.join(REPO, "build/exercises-drawings")));

const PAIRS = [["boxUp", "boxDown"], ["bright", "dark"], ["straw", "lipBuzz"]];

// the app's rendering rules, one per kind
const THEMES = {
  app: { bg: "#171717", line: "#d4d4d4", accent: "#d8b4fe", ghost: "#737373" },
  forced: { bg: "#ffffff", line: "#000000", accent: "#0037da", ghost: "#000000" },
};

function svg(id, theme) {
  const t = THEMES[theme];
  const { viewBox, parts } = DRAWINGS[id];
  const body = parts.map(({ kind, d }) => {
    if (kind === "accentFill") {
      // forced colours drop the faint fill (system colours have no tint)
      return theme === "forced" ? "" : `<path d="${d}" fill="${t.accent}" fill-opacity="0.18" stroke="none"/>`;
    }
    const color = t[kind];
    const dash = kind === "ghost" ? ' stroke-dasharray="4 3"' : "";
    return `<path d="${d}" fill="none" stroke="${color}"${dash}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="160" height="120" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="display:block" data-id="${id}">` +
    `<style>path{vector-effect:non-scaling-stroke}</style>${body}</svg>`;
}

function page(ids, theme) {
  const t = THEMES[theme];
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${t.bg}">` +
    `<div id="shot" style="display:inline-flex;gap:16px;background:${t.bg};padding:${ids.length > 1 ? 8 : 0}px">` +
    ids.map((id) => svg(id, theme)).join("") + `</div></body>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage();
  const jobs = [
    ...Object.keys(DRAWINGS).map((id) => [id, [id]]),
    ...PAIRS.map((ids) => [`pair-${ids.join("-")}`, ids]),
  ];
  let n = 0;
  for (const [name, ids] of jobs) {
    for (const theme of Object.keys(THEMES)) {
      for (const scale of [1, 3]) {
        await p.setViewport({ width: 800, height: 400, deviceScaleFactor: scale });
        await p.setContent(page(ids, theme));
        const el = await p.$("#shot");
        const file = path.join(OUT, `${name}${theme === "forced" ? "-forced" : ""}@${scale}x.png`);
        await el.screenshot({ path: file });
        n++;
      }
    }
  }
  console.log(`wrote ${n} PNGs to ${path.relative(REPO, OUT) || OUT}`);
} finally {
  await browser.close();
}
