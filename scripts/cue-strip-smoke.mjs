// cue-strip-smoke.mjs — headless check of the Dashboard cue strip and the
// experimental "Likely heard as" panel against the BUILT app (dist/, served
// by `vite preview`), with Chrome's fake mic playing public / synthetic WAVs
// (scripts/cue-strip-smoke-wavs.mjs -> build/cue-strip-smoke/).
//
//   npm run build && node scripts/cue-strip-smoke-wavs.mjs --r1=<jobs> &&
//   node scripts/cue-strip-smoke.mjs --viewport=phone|p402|p360|landscape|desktop [--out=<dir>] [--pitch-only=man,woman]
//        [--pitch-only-late=man,woman [--panelOnAt=120]]
//
// Per viewport, one fresh profile (Chrome relaunched on it per WAV, since the
// fake-capture file is a launch flag):
//   1 speech-woman  first visit: the welcome sheet's direction question (masculine),
//                   "Start — allow the microphone" starts listening. LAYOUT (the hard requirement):
//                   at scrollTop 0 the pitch trace and the whole cue strip —
//                   both meter columns — are inside the viewport, no horizontal
//                   page scroll, no clipped strip header (horizontally or
//                   vertically — descenders). TWIN COLUMNS (the owner's pick,
//                   2026-10-25): pitch left, resonance right, tops level, each
//                   meter >= 150 px tall (>= 100 px in short landscape, where
//                   the meters share the height beside the trace); each reads
//                   upwards ("higher" / "brighter" above the track, "lower" /
//                   "darker" below, the typical women's band above the men's);
//                   every strip and heard-as panel button's hit area >= 44 x 44
//                   px, hit-tested (elementFromPoint over every point of its
//                   ::before box; 2026-10-26: the sum of the insets missed the
//                   meter box covering the "i" buttons' lower rows and the
//                   ::before being placed from the padding box). While live, a
//                   thumb sits inside the target outline exactly when its value
//                   is inside the target range (both columns). DESKTOP ALSO
//                   (2026-10-26 review): at laptop sizes 1366 x 657, 1280 x 690
//                   and 1280 x 720 (the heard-as panel in its row layout) the
//                   right-hand column has no inner scroll and the caveat's More
//                   is above the dock; at 1280 x 460 (lg and short landscape at
//                   once) both meters are >= 100 px tall.
//                   INFO POPOVERS: each row's "i" and the steadiness "i" open a
//                   popover whose text wraps inside it (scrollWidth <=
//                   clientWidth) and that is on top at its centre and inside
//                   the viewport. Pitch live <= 3 s; resonance warming ->
//                   settling -> live (live <= 12 s); the pitch trail reaches 8
//                   dots, resonance's 3 (one per 2 s).
//                   TWO ROWS (2026-10-11 user decision, the clarity study
//                   failed — measurements/clarity-cue-2026-10-08.md): exactly
//                   the pitch and resonance rows, no clarity / weight row, no
//                   clarity caveat line, no strip text and no direction option
//                   says weight / lighter / heavier / clarity / breathier.
//                   Settings: masculine / feminine / androgynous / exploring —
//                   each cue's highlight range per the spec table, the same
//                   fill / stroke in every direction, none for exploring.
//                   The first-screen layout is re-checked with the panel on.
//                   Heard-as:
//                   off at first visit (no gender worker); turned on in the
//                   panel -> the worker starts, Settings' switch agrees, three
//                   ranges appear with no "%" in the panel; reload -> still on;
//                   switched off in Settings -> the panel agrees, the worker is
//                   gone. The panel is ONE man <-> woman DOME (owner's choice
//                   2026-10-25: the split bar of user decision 2026-10-20 bent
//                   into a semicircle of ten tenth-segments; no bracket rows,
//                   no ring axis): the deep tenths from the left foot = the
//                   low end of "would say man", the light tenths from the
//                   right foot = the low end of "would say woman", striped
//                   between (the range line's one-side "About N in 10
//                   listeners would say …", drawn inside the dome's hollow,
//                   is the best guess s, data-split-guess, to the nearest
//                   tenth, 2026-10-21), no best-guess mark (review
//                   2026-10-20), a deep / striped / light key beside "would
//                   say man" / "could go either way" / "would say woman", the
//                   range line and (unless "could go either way") the unsure
//                   line, key row and dome inside the panel, the sentence
//                   inside the dome's hollow, screen-reader label = the bar's own description and
//                   the sentence announced once (2026-10-21: the label repeated
//                   it); contrast: text >= 4.5:1, both shades >=
//                   3:1 against the panel and each other, no green / red /
//                   amber / pink / blue hue in the dome (both shades 244-270°,
//                   on the violet side of 240° blue).
//   2 speech-man    (heard-as back on) pitch / resonance live, resonance reads
//                   lower than the woman's; the dome is shown and the man's
//                   best guess (data-split-guess; not drawn) is above the
//                   woman's (more of the dome would say man, which fills
//                   from the left foot). The
//                   panel's "More" list opens and carries the pitch-only
//                   late-switch-on line and false-alarm line (no "turn it on
//                   before you start talking" line; measurement note §8.9,
//                   wording of its "Decisions 2026-10-13", the late line as
//                   amended 2026-10-18: no "another tab", "on before you
//                   start talking … of talking"), wrapped inside the panel.
//   3 held          voice gate on (its default): with the detector running
//                   the pitch row is live on <= 10 % of 8 s of samples
//                   (FireRedVAD hears this synthetic vowel as no voice — the
//                   documented cost), and the resonance row, which follows
//                   the same gated flags since 2026-10-21, is idle ("—") on
//                   >= 80 %, "keep talking…" on <= 10 % and never draws a
//                   dot (a hold the detector hides reads as silence, not
//                   "needs running speech"); then the gate off and:
//                   resonance "sustained" for >= 60 % of the voiced hold after
//                   its first second; the panel says "sustained", never ranges.
//   4 noise / 5 silence  no dot on any row after the 5 s hold; the panel never
//                   shows ranges.
//   6 narrowband    speech-woman low-passed at 3.4 kHz (a phone link): the
//                   resonance row shows "Phone-quality audio — paused"
//                   (unclipped, at every viewport incl. p360) and
//                   never a dot or trail, before the notice too (the worker
//                   withholds the position until its detector has decided,
//                   2026-10-19); the info popover leads with the notice's
//                   explanation and fits; the pitch row still goes live.
//   (--pitch-only=man,woman) pitch-only-<who>  ~50 s natural, then pitch moved
//                   with the resonance kept (scripts/cue-strip-smoke-wavs.mjs
//                   --pitch-only): the pitch-only warning is never shown before
//                   the shift, appears within 25 s after it, inside the shown
//                   estimate in its own slot directly under the axis, with the
//                   shipped words, as the only note, mirrored in the
//                   always-mounted live region; on the first screen at
//                   scrollTop 0 (desktop; elsewhere whenever any line of the
//                   dome's sentence is — on phones the dome follows the twin
//                   columns below the first screen since 2026-10-25, its
//                   sentence below the dock; 2026-10-26: the rule asked for
//                   the whole dome, so a sentence line sliced by the dock with
//                   the warning below passed); kept on >= 80 % of shown
//                   estimates in the next 20 s.
//   (--pitch-only-late=man,woman) pitch-only-late-<who>  a §8.8 hcsL session
//                   (>= 170 s natural reading, then the pitch moved with the
//                   resonance kept; scripts/cue-strip-smoke-wavs.mjs
//                   --pitch-only-late) with the panel switched OFF before
//                   listening starts and turned on at --panelOnAt s (default
//                   120), after the cue's start window has closed (its start
//                   marker is shown): the pitch-only warning (KS-Q5, §8.9) is
//                   never shown before the shift and appears within 25 s after
//                   it. The panel is left on for the runs after it.
// Screenshots: <out>/<viewport>/.
//
// Process hygiene (CLAUDE.md hard rule 2, copied from voice-direction-smoke.mjs):
// Chrome is launched by puppeteer with a temporary --user-data-dir and closed
// via browser.close(), falling back to taskkill of ITS pid only; the preview
// server is this script's own child, killed only by its PID. Cleanup runs on
// exit / SIGINT / SIGTERM / uncaughtException.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PITCH_ONLY_TEXT } from "../src/ml/pitch-only-warning.js";
import { sayText, BAR_DESCRIPTION } from "../src/components/heardAsAxisModel.js";
import { NARROWBAND_NOTICE, NARROWBAND_INFO } from "../src/components/cueStripModel.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const WAVDIR = arg("wavs", path.join(repo, "build", "cue-strip-smoke"));
const WAV = Object.fromEntries(["speech-woman", "speech-man", "held", "noise", "silence", "narrowband"].map((k) => [k, path.join(WAVDIR, `${k}.wav`)]));
const VIEWPORT = arg("viewport", "phone");
const PITCH_ONLY = arg("pitch-only", "").split(",").filter(Boolean);
for (const who of PITCH_ONLY) WAV[`pitch-only-${who}`] = path.join(WAVDIR, `pitch-only-${who}.wav`);
const PITCH_ONLY_LATE = arg("pitch-only-late", "").split(",").filter(Boolean);
for (const who of PITCH_ONLY_LATE) WAV[`pitch-only-late-${who}`] = path.join(WAVDIR, `pitch-only-late-${who}.wav`);
const PANEL_ON_AT_S = Number(arg("panelOnAt", "120"));
const OUT = path.join(arg("out", path.join(repo, "build", "cue-strip-smoke")), VIEWPORT);
const PORT = Number(arg("port", "4191"));
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!CHROME || Object.values(WAV).some((w) => !existsSync(w))) { console.error("need Chrome and the WAVs (scripts/cue-strip-smoke-wavs.mjs)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p402: { width: 402, height: 750, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p360: { width: 360, height: 690, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { width: 890, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

let server = null;
let browser = null;
const profile = mkdtempSync(path.join(tmpdir(), "cue-strip-smoke-"));
function closeBrowserHard() {
  const bp = browser?.process?.()?.pid;
  if (bp) { try { execFileSync("taskkill", ["/pid", String(bp), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
}
function cleanup() {
  if (server?.pid) { try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } server = null; }
  closeBrowserHard();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${VIEWPORT}] ${name}${detail ? `  (${detail})` : ""}`);
};

async function startServer() {
  server = spawn(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/Syrinx/`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

async function launch(wav) {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
}

async function open() {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[VIEWPORT]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`http://localhost:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.bringToFront();
  return { page, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const clickButton = (page, texts, scope = "") => page.evaluate((ts, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const b = [...(root?.querySelectorAll("button") ?? [])].find((x) => ts.some((t) => x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, scope);
const pickDirection = (page, id, scope = "[role=dialog]") => page.evaluate(async (id, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  // The return-visit goal sheet shows last time's goal only until "Change goal".
  const more = root?.querySelector("[data-change-goal]");
  if (more) { more.click(); await new Promise((r) => setTimeout(r, 100)); }
  const input = root?.querySelector(`input[data-direction="${id}"]`);
  if (!input) return false;
  input.closest("label").click();
  return true;
}, id, scope);
const gw = (page) => page.workers().filter((w) => w.url().includes("gender-worker")).length;

// Everything the checks read, in one evaluate.
const state = (page) => page.evaluate(() => {
  const rows = {};
  for (const el of document.querySelectorAll("[data-cue]")) {
    const h = el.querySelector("[data-cue-highlight]");
    const cs = h ? getComputedStyle(h) : null;
    rows[el.dataset.cue] = {
      state: el.dataset.state, dot: el.dataset.dot === "1", trail: Number(el.dataset.trail), value: el.dataset.value === "" ? null : Number(el.dataset.value),
      low: el.dataset.targetLow ?? null, high: el.dataset.targetHigh ?? null,
      hl: h ? { fill: cs.fill, stroke: cs.stroke, strokeWidth: cs.strokeWidth, rx: h.getAttribute("rx") } : null,
      header: el.querySelector("[data-cue-value]")?.textContent ?? "",
      hollow: el.dataset.hollow === "1",
      word: el.querySelector("[data-cue-word]")?.textContent ?? null,
      title: el.querySelector("[data-cue-title]")?.textContent ?? "",
      sr: el.querySelector("[data-cue-sr]")?.textContent ?? "",
      // the thumb's resting centre (its inline transform, not the 200 ms
      // transition's current frame) and the target outline, in the meter's px
      thumbY: (() => {
        const mk = el.querySelector("[data-cue-dot-mark]");
        const m = mk?.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
        return m ? Number(m[2]) + mk.offsetHeight / 2 : null;
      })(),
      hlY: h ? [Number(h.getAttribute("y")), Number(h.getAttribute("y")) + Number(h.getAttribute("height"))] : null,
    };
  }
  const p = document.querySelector("[data-heard-as]");
  return {
    rows,
    heardAs: p ? { mode: p.dataset.heardAs, reason: p.dataset.reason ?? null, worker: p.dataset.modelWorker ?? null, text: p.innerText,
      axes: p.querySelectorAll("[data-heard-as-axis]").length, legacyRows: p.querySelectorAll("[data-share]").length,
      axis: (() => {
        const a = p.querySelector("[data-heard-as-axis]");
        if (!a) return null;
        const pr = p.getBoundingClientRect();
        // the key row: three items (would say man / could go either way / would say woman), one or two rows
        const ends = [...a.querySelectorAll("[data-axis-ends] > span")].map((e) => e.getBoundingClientRect());
        // the dome (data-split-bar, the SVG; viewBox 300 x 157, centre (150, 156), radii 144 / 118 —
        // src/components/heardAsDome.js): each kind's share = its tenth-segments / 10
        const bar = a.querySelector("[data-split-bar]")?.getBoundingClientRect();
        const parts = Object.fromEntries([...a.querySelectorAll("[data-split-part]")].map((e) => [e.dataset.splitPart, e.querySelectorAll("[data-tenth]").length / 10]));
        const tenths = [...a.querySelectorAll("[data-tenth]")].sort((x, y) => x.dataset.tenth - y.dataset.tenth).map((e) => e.dataset.tenthKind[0]).join("");
        // on screen, not just in the DOM (2026-10-26 review: beta compared the end words' rects; a CSS mirror or a
        // reordered key row passed the attribute checks): tenth 0 drawn left of tenth 9, and the "would say man" key
        // before "would say woman" in reading order (same row: to its left; stacked, in the row layout: above it)
        const cxOf = (e) => { const r = e?.getBoundingClientRect(); return r ? r.left + r.width / 2 : NaN; };
        const onScreenOrder = (() => {
          const km = a.querySelector("[data-axis-key=man]")?.getBoundingClientRect(), kw = a.querySelector("[data-axis-key=woman]")?.getBoundingClientRect();
          const keys = !!km && !!kw && (km.bottom <= kw.top + 0.5 || (Math.abs(km.top - kw.top) < 2 && km.right <= kw.left + 0.5));
          return cxOf(a.querySelector("[data-tenth='0']")) < cxOf(a.querySelector("[data-tenth='9']")) && keys;
        })();
        // the sentence inside the dome's hollow: every line's box within the inner radius (1 px slack), above the base
        const sentenceInDome = (() => {
          const lines = [...p.querySelectorAll("[data-heard-as-range] > span")].map((e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); });
          if (!bar || !lines.length) return false;
          const k = bar.width / 300, cx = bar.left + 150 * k, cy = bar.top + 156 * k, r = 118 * k;
          // the text's ink, not the line box: half the leading off the top (line-height 1.35)
          return lines.every((l) => {
            const inkTop = l.top + (l.height * 0.35) / 2.7;
            return l.bottom <= cy + 0.5 && Math.hypot(l.left - cx, inkTop - cy) <= r + 1 && Math.hypot(l.right - cx, inkTop - cy) <= r + 1;
          });
        })();
        // the three key items: inside the panel, and two on the same row never overlap
        const keysApart = ends.every((x, i) => ends.every((y, j) => i >= j || x.bottom <= y.top + 0.5 || y.bottom <= x.top + 0.5 || x.right <= y.left + 0.5 || y.right <= x.left + 0.5));
        return { wide: a.dataset.axisWide === "1", man: Number(a.dataset.splitMan), woman: Number(a.dataset.splitWoman), guess: Number(a.dataset.splitGuess),
          parts, tenths, onScreenOrder, domeW: bar ? Math.round(bar.width * 10) / 10 : null, domeH: bar ? Math.round(bar.height * 10) / 10 : null, sentenceInDome,
          dotShown: !!a.querySelector("[data-split-guess-mark]"), keys: [...a.querySelectorAll("[data-axis-ends] [data-axis-key]")].map((e) => e.dataset.axisKey).join(","),
          sr: a.querySelector("[role=img]")?.getAttribute("aria-label") ?? "",
          range: p.querySelector("[data-heard-as-range]")?.textContent ?? "", unsure: p.querySelector("[data-heard-as-unsure]")?.textContent ?? "",
          // how often a screen reader meets the sentence: aria-labels that contain it + the innermost elements whose
          // text is the whole sentence, outside aria-hidden (the dome draws it on two lines, one span each: their
          // parent is the innermost element with all of it)
          rangeAnnounced: (() => {
            const t = p.querySelector("[data-heard-as-range]")?.textContent ?? "";
            if (!t) return 0;
            const labels = [...p.querySelectorAll("[aria-label]")].filter((e) => e.getAttribute("aria-label").includes(t)).length;
            const texts = [...p.querySelectorAll("*")].filter((e) => e.textContent.trim() === t && ![...e.children].some((c) => c.textContent.trim() === t)
              && !e.closest('[aria-hidden="true"]')).length;
            return labels + texts;
          })(),
          fits: p.scrollWidth <= p.clientWidth + 1 && ends.length === 3 && ends.every((e) => e.left >= pr.left - 0.5 && e.right <= pr.right + 0.5)
            && keysApart && !!bar && bar.left >= pr.left - 0.5 && bar.right <= pr.right + 0.5 };
      })(),
      pitchOnly: (() => {
        const n = p.querySelector("[data-pitch-only]");
        return n ? { text: n.textContent.trim(), slot: n.dataset.heardAsNote ?? null, inShares: !!n.closest("[data-heard-as-shares]"),
          underAxis: n.previousElementSibling?.matches("[data-heard-as-axis]") ?? false,
          otherNotes: p.querySelectorAll("[data-heard-as-note]:not([data-pitch-only])").length } : null;
      })(),
      live: (() => { const l = p.querySelector("[data-heard-as-live]"); return l ? { role: l.getAttribute("role"), text: l.textContent.trim() } : null; })(),
      wide: p.querySelector("[data-heard-as-axis]")?.dataset.axisWide === "1" } : null,
    listening: document.body.innerText.includes("Mic off"),
    cueStart: !!document.querySelector('[data-cue="resonance"] [data-cue-start]'),
    stripText: document.querySelector("[data-cue-strip]")?.textContent ?? "",
    clarityNote: document.querySelector("[data-clarity-note]")?.textContent ?? null,
    cues: [...document.querySelectorAll("[data-cue]")].map((e) => e.dataset.cue),
    caption: !!document.querySelector("[data-cue-caption]"),
    weightNote: !!document.querySelector("[data-weight-note]"),
  };
});

// Layout: trace box + strip inside the viewport at scrollTop 0.
const layout = (page) => page.evaluate(() => {
  const sc = [...document.querySelectorAll("*")].filter((e) => e.scrollTop > 0);
  for (const e of sc) e.scrollTop = 0;
  window.scrollTo(0, 0);
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const trace = r("[data-pitch-trace-box]"), strip = r("[data-cue-strip]");
  const clipped = [...document.querySelectorAll("[data-cue-strip] [data-cue-title], [data-cue-strip] [data-cue-word], [data-cue-strip] [data-cue-value]")]
    // vertically only where the box clips vertically (overflow-x: clip leaves y visible)
    // only boxes that clip can cut text off: overflow-x: clip (titles, text
    // values) horizontally, and vertically only where overflow-y clips too
    .filter((e) => { const cs = getComputedStyle(e);
      return (cs.overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1) || (cs.overflowY !== "visible" && e.scrollHeight > e.clientHeight + 1); })
    .map((e) => e.textContent);
  // The twin columns: each column's meter box, its track and end words, and
  // the centres of its two bands (screen px).
  const cols = Object.fromEntries([...document.querySelectorAll("[data-cue-strip] [data-cue]")].map((c) => {
    const rb = (e) => (e ? e.getBoundingClientRect() : null);
    const mid = (e) => { const b = rb(e); return b ? (b.top + b.bottom) / 2 : null; };
    const m = rb(c.querySelector("[data-cue-meter]")), t = rb(c.querySelector("[data-cue-track]"));
    return [c.dataset.cue, { left: rb(c).left, right: rb(c).right, top: m?.top ?? null, meterH: m ? Math.round(m.height) : 0,
      trackTop: t?.top ?? null, trackBottom: t?.bottom ?? null,
      endTop: mid(c.querySelector('[data-cue-end="top"]')), endBottom: mid(c.querySelector('[data-cue-end="bottom"]')),
      men: mid(c.querySelector('[data-cue-band="men"] rect')), women: mid(c.querySelector('[data-cue-band="women"] rect')) }];
  }));
  return { vh: innerHeight, vw: innerWidth, trace, strip, cols, scrollW: document.documentElement.scrollWidth, clipped,
    scrollH: Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll("main, [data-dashboard]")].map((e) => e.scrollHeight)),
    panel: r("[data-heard-as]"), session: r("[data-practice-dock]") };
});
// In the first screen = above the practice dock pinned at the bottom.
const inView = (b, L) => b && b.top >= 0 && b.bottom <= (L.session ? L.session.top + 0.5 : L.vh) && b.left >= 0 && b.right <= L.vw;

// Hit areas, hit-tested: each strip / heard-as panel button scrolled into
// view, its ::before box (placed from the button's padding box, grown by the
// insets) sampled at every pixel centre with elementFromPoint; every point
// must land on the button. Scrolls back to the top afterwards.
const hitAreas = (page) => page.evaluate(() => {
  const out = [...document.querySelectorAll("[data-cue-strip] button, [data-heard-as] button")].map((b) => {
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b, "::before"), bs = getComputedStyle(b);
    const on = cs.content && cs.content !== "none" && cs.position === "absolute";
    const ins = (v) => (on ? -parseFloat(v) || 0 : 0), bw = (k) => parseFloat(bs[k]) || 0;
    const box = on
      ? { l: r.left + bw("borderLeftWidth") - ins(cs.left), r: r.right - bw("borderRightWidth") + ins(cs.right), t: r.top + bw("borderTopWidth") - ins(cs.top), b: r.bottom - bw("borderBottomWidth") + ins(cs.bottom) }
      : { l: r.left, r: r.right, t: r.top, b: r.bottom };
    let n = 0, hit = 0;
    const miss = new Set();
    for (let y = Math.ceil(box.t) + 0.5; y < box.b; y += 1) {
      for (let x = Math.ceil(box.l) + 0.5; x < box.r; x += 1) {
        n++;
        const e = document.elementFromPoint(x, y);
        if (e && (e === b || b.contains(e))) hit++;
        else miss.add(e ? `${e.tagName.toLowerCase()}${e.getAttributeNames().filter((a) => a.startsWith("data-")).map((a) => `[${a}]`).join("")}` : "outside");
      }
    }
    return { label: b.getAttribute("aria-label") ?? b.textContent.trim(), w: Math.round(box.r - box.l), h: Math.round(box.b - box.t), hit: n ? hit / n : 0, miss: [...miss].slice(0, 3) };
  });
  for (const e of document.querySelectorAll("*")) if (e.scrollTop > 0) e.scrollTop = 0;
  window.scrollTo(0, 0);
  return out;
});

// Desktop at laptop sizes: the right-hand column (data-cue-column) never
// scrolls inside, the caveat's More is above the practice dock, the meters'
// heights. (The panel keeps one height in every state, so whatever it shows
// now stands for all of them.)
const desktopColumn = (page) => page.evaluate(() => {
  for (const e of document.querySelectorAll("*")) if (e.scrollTop > 0) e.scrollTop = 0;
  const col = document.querySelector("[data-cue-column]");
  const more = [...document.querySelectorAll("[data-heard-as] button")].find((b) => /More|Less/.test(b.textContent));
  const dock = document.querySelector("[data-practice-dock]")?.getBoundingClientRect();
  const mr = more?.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, sh: col?.scrollHeight ?? null, ch: col?.clientHeight ?? null,
    meters: [...document.querySelectorAll("[data-cue-meter]")].map((m) => Math.round(m.getBoundingClientRect().height)),
    more: mr ? Math.round(mr.bottom) : null, dock: dock ? Math.round(dock.top) : null,
    // the panel's row layout: the dome at the left, 200 px wide (220 from 1180 px wide), its key beside it
    row: (() => {
      const dome = document.querySelector("[data-heard-as] [data-split-bar]")?.getBoundingClientRect();
      const key = document.querySelector("[data-heard-as] [data-axis-key=man]")?.getBoundingClientRect();
      return dome && key ? { domeW: Math.round(dome.width), keyRightOfDome: key.left >= dome.right } : null;
    })() };
});

// Opens one info toggle (by its aria-label), measures its popover, closes it.
const probePopover = (page, label) => page.evaluate(async (label) => {
  const btn = [...document.querySelectorAll("[data-cue-strip] button")].find((b) => b.getAttribute("aria-label") === label);
  if (!btn) return { found: false };
  btn.click();
  await new Promise((r) => setTimeout(r, 150));
  const id = btn.getAttribute("aria-controls");
  const pop = id ? document.getElementById(id) : null;
  let out = { found: true, open: !!pop };
  if (pop) {
    const b = pop.getBoundingClientRect();
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const hit = document.elementFromPoint(cx, cy);
    out = { ...out, wraps: pop.scrollWidth <= pop.clientWidth + 1, onTop: !!hit && pop.contains(hit),
      inViewport: b.top >= 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], sw: pop.scrollWidth, cw: pop.clientWidth };
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await new Promise((r) => setTimeout(r, 100));
  return out;
}, label);

let directionDialogText = "";
async function startFirstVisit(page, direction) {
  await page.waitForFunction(() => !!document.querySelector("[data-dialog=direction]"), { timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes("What are you trying to sound like?"), { timeout: 30000 });
  directionDialogText = await page.evaluate(() => document.querySelector("[role=dialog]")?.innerText ?? "");
  await pickDirection(page, direction);
  await clickButton(page, ["Start — allow the microphone", "Start practicing"], "[role=dialog]");
  return waitListening(page);
}
async function waitListening(page, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(() => document.body.innerText.includes("Mic off"))) return true;
    await sleep(250);
  }
  return false;
}
// Reload: the return-visit goal sheet; "Start practicing" confirms and starts listening.
async function continueAfterReload(page) {
  // the return sheet asks "Same goal as last time?" (the first-visit question's
  // words are only its radiogroup's aria-label there)
  await page.waitForSelector("[data-dialog=direction][data-variant=return] [data-start-listening]", { timeout: 30000 });
  await clickButton(page, ["Start — allow the microphone", "Start practicing"], "[role=dialog]");
  return waitListening(page);
}
async function openSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Settings & Data"]')?.click());
  await page.waitForSelector("[data-dialog=settings]", { timeout: 5000 });
}
async function closeSettings(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Close settings"]')?.click());
  await page.waitForFunction(() => !document.querySelector("[data-dialog=settings]"), { timeout: 5000 });
}
const settingsSwitch = (page) => page.evaluate(() => {
  const b = document.querySelector("[data-settings-heard-as] [role=switch]");
  return b ? b.getAttribute("aria-checked") : null;
});
// "Likely heard as" is on by default and has no turn-on button (user decision 2026-10-25): Settings' switch is
// its only control, and switched off the panel is not rendered at all (state().heardAs === null).
async function setHeardAs(page, on) {
  await openSettings(page);
  if ((await settingsSwitch(page)) !== String(on)) await page.evaluate(() => document.querySelector("[data-settings-heard-as] [role=switch]")?.click());
  await sleep(300);
  const ok = (await settingsSwitch(page)) === String(on);
  await closeSettings(page);
  return ok;
}
const heardAsOff = (s) => s.heardAs === null;
const turnOnButtons = (page) => page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /turn on/i.test(b.textContent)).length);

// Samples state every 250 ms for ms, calling fn(s, tSec) each time.
async function sample(page, ms, fn) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(page);
    if (fn(s, (Date.now() - t0) / 1000) === true) return true;
    await sleep(250);
  }
  return false;
}

// The heard-as dome (the split bar bent into ten tenth-segments, owner's
// choice 2026-10-25), whenever it is shown.
let womanGuess = null;
function axisChecks(who, s) {
  const a = s.heardAs?.axis;
  // The range line (2026-10-21): one side, the panel's best guess s (drawn
  // nowhere; data-split-guess, 3 decimals) to the nearest tenth — "About N in
  // 10 listeners would say …" / "Nearly all …", or "Could go either way"
  // (sayText, the panel's own words). ±0.0005 covers data-split-guess's
  // rounding at a tenth boundary.
  const wants = a ? new Set([-0.0005, 0, 0.0005].map((d) => sayText(a.guess + d, a.wide))) : new Set();
  const want = [...wants].join(" / ");
  check(`${who}: dome tenths match the data (deep = low end of man from the left foot, light = low end of woman from the right foot, striped between), no best-guess mark, a deep / striped / light key by "would say man" / "could go either way" / "would say woman"`,
    !!a && !a.dotShown && a.keys === "man,either,woman" && a.onScreenOrder && /^m*e*w*$/.test(a.tenths) && a.tenths.length === 10
    // the dome: 240-300 px centred; 200 px (220 on short desktops ≥ 1180 px wide) in the panel's row layout (short landscape, 2026-10-26)
    && a.domeW >= (VIEWPORT === "landscape" ? 195 : 240) && a.domeW <= 300.5 && Math.abs(a.domeW / a.domeH - 300 / 157) < 0.03
    && Math.abs((a.parts.man ?? 0) - a.man) < 0.02 && Math.abs((a.parts.woman ?? 0) - a.woman) < 0.02
    && Math.abs((a.parts.either ?? 0) - (1 - a.man - a.woman)) < 0.02
    && a.guess >= a.man - 1e-6 && a.guess <= 1 - a.woman + 1e-6, JSON.stringify(a));
  check(`${who}: the sentence is drawn inside the dome's hollow (every line within the inner radius, above the base)`, !!a && a.sentenceInDome, JSON.stringify(a));
  check(`${who}: dome words — range line = one side, the best guess to the nearest tenth ("could go either way" when wide) and unsure line (one tenth value; none when wide)`, !!a
    && wants.has(a.range) && !a.range.includes(" · ")
    && (a.wide ? /^Could go either way/.test(a.range) && a.unsure === ""
      : /^(About \d|Nearly all)( in 10)? listeners would say (man|woman)$|^Could go either way/.test(a.range) && /^(About \d+|Fewer than 1) in 10 might be unsure or say neither$/.test(a.unsure)), `${a?.range} | want ${want} | ${a?.unsure}`);
  check(`${who}: dome screen-reader label = the bar's own description, without the sentence; the sentence announced once (the visible line, not aria-hidden)`,
    !!a && a.sr === BAR_DESCRIPTION && !a.sr.includes(a.range) && a.rangeAnnounced === 1, `${a?.sr} | sentence announced ${a?.rangeAnnounced}x`);
  check(`${who}: dome and the three key items fit inside the panel, key items never overlap`, !!a && a.fits, JSON.stringify(a));
}

// WCAG contrast inside the heard-as panel (adapted from the review round 2
// probe): every text node >= 4.5:1 (incl. the sentence's two lines inside the
// dome and the three key items); the dome's two shades >= 3:1 against the
// panel background and against each other (1.4.11), all against the
// composited background and with every ancestor's opacity applied, and the
// dome's segments and stripes drawn in exactly those shades. And the
// user's colour rule (decision 2026-10-20): the dome is two shades of one
// colour — indigo, hue 244–270° (review 2026-10-20: the lower limit was 225°,
// which let blue, 240°, through) — never green / red / amber (the app's on /
// off target / experimental) or pink / blue.
async function contrastCheck(page, who) {
  const r = await page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => {
      if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hue = (c) => { const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d === 0) return null; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const bgOf = (el) => { const ch = []; for (let e = el; e; e = e.parentElement) ch.push(e); let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const e of ch.reverse()) { const c = rgba(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = over(c, bg); } return bg; };
    const opOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    const p = document.querySelector("[data-heard-as]");
    if (!p) return null;
    let minText = Infinity, worst = "";
    for (const el of p.querySelectorAll("h3, h3 span, p, li, button, [data-axis-ends] > span, [data-heard-as-range] span")) {
      if (el.closest(".sr-only")) continue;
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      if (!t) continue;
      const bg = bgOf(el), fg0 = rgba(getComputedStyle(el).color), fg = over({ ...fg0, a: fg0.a * opOf(el) }, bg);
      const q = ratio(fg, bg);
      if (q < minText) { minText = q; worst = t.slice(0, 40); }
    }
    // The two shades as tokens (they are drawn solid or, both, in the stripes).
    const bar = p.querySelector("[data-split-bar]");
    const panelBg = bar ? bgOf(bar.parentElement) : null;
    const tok = (n) => { const c = rgba(getComputedStyle(document.documentElement).getPropertyValue(n).trim()); return over({ ...c, a: c.a * (bar ? opOf(bar) : 1) }, panelBg ?? { r: 0, g: 0, b: 0, a: 1 }); };
    const man = tok("--color-heard-man"), woman = tok("--color-heard-woman");
    // The dome draws exactly these two shades: the solid groups' fills and the stripe pattern's two rects.
    const same = (x, y) => { const a = rgba(x), b = rgba(y); return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) <= 3; };
    const tokRaw = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const fills = [...p.querySelectorAll("[data-split-part='man'], [data-split-part='woman'], [data-split-bar] pattern rect")]
      .map((e) => ({ want: e.matches(".heard-seg-man, .heard-pat-man") ? "--color-heard-man" : "--color-heard-woman", fill: getComputedStyle(e).fill }));
    const drawn = fills.length >= 2 && fills.every((f) => same(f.fill, tokRaw(f.want)));
    return { minText, worst, drawn,
      man: panelBg ? ratio(man, panelBg) : null, woman: panelBg ? ratio(woman, panelBg) : null, manWoman: ratio(man, woman),
      hues: [hue(man), hue(woman)].map((h) => (h === null ? null : Math.round(h))) };
  });
  log(`  contrast (${who}): ${JSON.stringify(r)}`);
  check(`${who}: heard-as panel text >= 4.5:1; dome shades >= 3:1 against the panel and each other, and the dome draws exactly those two shades`,
    !!r && r.minText >= 4.5 && r.man >= 3 && r.woman >= 3 && r.manWoman >= 3 && r.drawn, JSON.stringify(r));
  check(`${who}: the dome is two shades of one colour (indigo, hue 244–270°), no green / red / amber / pink / blue`,
    !!r && r.hues.every((h) => h !== null && h >= 244 && h <= 270) && Math.abs(r.hues[0] - r.hues[1]) <= 15, JSON.stringify(r?.hues));
}

const SPEC_HL = {
  // cue -> direction -> [low, high] (rounded to 3 decimals as the attribute)
  pitch: { feminine: [165, 255], masculine: [85, 155], androgynous: [145, 175] },
  // feminine / masculine: the cue's readout bands (cue-bands.json);
  // androgynous: between the per-speaker bands (reference.json).
  resonance: { feminine: [0.574, 1.39], masculine: [-0.582, 0.48], androgynous: [0.288, 0.654] },
};
const WEIGHT_WORDS = /weight|lighter|heavier/i;
// The hidden clarity row's words (2026-10-11): none may reach the strip.
const CLARITY_WORDS = /clarity|breathier|clearer/i;

log("preview server");
await startServer();

// ============================================================ 1 speech-woman
log("speech-woman: first visit");
await launch(WAV["speech-woman"]);
let { page, errors } = await open();
check("listening starts from the direction question (masculine)", await startFirstVisit(page, "masculine"));
check("direction options: pitch targets only, no vocal-weight side", /Pitch target/.test(directionDialogText) && !WEIGHT_WORDS.test(directionDialogText),
  directionDialogText.replace(/\s+/g, " ").slice(0, 200));
await sleep(600);
{
  // the resonance bands come from cue-bands.json: wait for them, so "reads upwards" checks both columns
  await page.waitForSelector('[data-cue="resonance"] [data-cue-band="men"]', { timeout: 15000 }).catch(() => {});
  const L = await layout(page);
  await shot(page, "01-start");
  check("layout: pitch trace fully in the first screen", inView(L.trace, L), JSON.stringify(L.trace));
  check("layout: whole cue strip in the first screen", inView(L.strip, L), `${JSON.stringify(L.strip)} vh ${L.vh}`);
  check("layout: no horizontal page scroll", L.scrollW <= L.vw, `${L.scrollW} vs ${L.vw}`);
  check("layout: no clipped strip header text", L.clipped.length === 0, L.clipped.join(" | "));
  {
    const p = L.cols.pitch, r = L.cols.resonance, minH = VIEWPORT === "landscape" ? 100 : 150;
    check(`layout: twin columns side by side — pitch left, resonance right, tops level, each meter >= ${minH} px tall`,
      !!p && !!r && p.right <= r.left + 0.5 && Math.abs(p.top - r.top) < 1 && p.meterH >= minH && r.meterH >= minH, JSON.stringify(L.cols));
    const up = (c) => !!c && c.endTop < c.trackTop && c.endBottom > c.trackBottom && c.women !== null && c.men !== null && c.women < c.men;
    check("layout: both columns read upwards ('higher' / 'brighter' above the track, the typical women's band above the men's)",
      up(p) && up(r), JSON.stringify(L.cols));
    const hits = await hitAreas(page);
    check("touch targets: every strip and heard-as panel button's hit area >= 44 x 44 px, every point of it hit-tested on the button",
      hits.length >= 4 && hits.every((b) => b.w >= 44 && b.h >= 44 && b.hit === 1), JSON.stringify(hits));
  }
  if (VIEWPORT === "desktop") {
    // 1100 x 768 / 1024 x 628: the column at its 420 px floor, the 200 px dome (2026-10-26 review: 220 px there
    // overflowed the column by 14 px); 628 px is the lowest height whose meters (100 px floor) still fit
    for (const [w, h] of [[1366, 657], [1280, 690], [1280, 720], [1100, 768], [1024, 628]]) {
      await page.setViewport({ ...VIEWPORTS.desktop, width: w, height: h });
      await sleep(600);
      const d = await desktopColumn(page);
      await shot(page, `01c-desktop-${w}x${h}`);
      check(`desktop ${w} x ${h}: the right-hand column has no inner scroll, the heard-as panel in its row layout (dome ${w >= 1180 ? 220 : 200} px, key beside it), More above the dock, meters >= 100 px`,
        d.sh !== null && d.sh <= d.ch + 1 && d.more !== null && d.dock !== null && d.more <= d.dock && d.meters.length === 2 && d.meters.every((m) => m >= 100)
        && !!d.row && Math.abs(d.row.domeW - (w >= 1180 ? 220 : 200)) <= 1 && d.row.keyRightOfDome, JSON.stringify(d));
    }
    await page.setViewport({ ...VIEWPORTS.desktop, width: 1280, height: 460 });
    await sleep(600);
    {
      const d = await desktopColumn(page);
      await shot(page, "01c-desktop-1280x460");
      check("desktop 1280 x 460 (lg and short landscape at once): both meters drawn, >= 100 px tall (the column may scroll)",
        d.meters.length === 2 && d.meters.every((m) => m >= 100), JSON.stringify(d));
    }
    await page.setViewport(VIEWPORTS.desktop);
    await sleep(600);
  }
  log(`  first visit (panel on by default): trace ${L.trace?.top}-${L.trace?.bottom}, strip ${L.strip?.top}-${L.strip?.bottom}, panel ${L.panel?.top}-${L.panel?.bottom}, session ${L.session?.top}-${L.session?.bottom}, vh ${L.vh}, scrollH ${L.scrollH}`);
}
// Info popovers (the honest caveats live there): readable and visible.
{
  const s = await state(page);
  check("cue strip: exactly two rows, pitch and resonance (clarity hidden 2026-10-11)", s.cues.join() === "pitch,resonance", s.cues.join());
  check("cue strip: no weight / lighter / heavier text", !WEIGHT_WORDS.test(s.stripText), (s.stripText.match(WEIGHT_WORDS) ?? [""])[0]);
  check("cue strip: no clarity text, no clarity caveat line, no weight note", !CLARITY_WORDS.test(s.stripText) && s.clarityNote === null && !s.weightNote,
    (s.stripText.match(CLARITY_WORDS) ?? [""])[0]);
  check("no 'About the clarity cue' toggle", !(await page.evaluate(() => [...document.querySelectorAll("[data-cue-strip] button")].some((b) => b.getAttribute("aria-label") === "About the clarity cue"))));
}
for (const label of ["About the pitch cue", "About the resonance cue", "What does steadiness measure?"]) {
  const r = await probePopover(page, label);
  check(`info popover '${label}': opens, text wraps inside it, on top, inside the viewport`,
    r.found && r.open && r.wraps && r.onTop && r.inViewport, JSON.stringify(r));
  if (label === "About the resonance cue") {
    await page.evaluate((label) => [...document.querySelectorAll("[data-cue-strip] button")].find((b) => b.getAttribute("aria-label") === label)?.click(), label);
    await sleep(150);
    await shot(page, "01b-resonance-info");
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await sleep(100);
  }
}
{
  const s = await state(page);
  check("heard-as: on at first visit (on by default)", !heardAsOff(s), `${s.heardAs?.mode}/${s.heardAs?.reason}`);
  check("heard-as: no turn-on button anywhere", (await turnOnButtons(page)) === 0);
  for (let i = 0; i < 12 && gw(page) !== 1; i++) await sleep(250);
  check("heard-as on by default: the gender worker runs", gw(page) === 1, `${gw(page)} workers`);
}
// speech: states over time
{
  const seen = { pitch: new Set(), resonance: [] };
  const tLive = {};
  const maxTrail = { pitch: 0, resonance: 0 };
  let weightWordsLive = 0, clarityWordsLive = 0, extraRows = 0;
  let hollowBad = 0, hollowSeen = 0;
  const outline = { pitch: { n: 0, bad: 0, ex: null }, resonance: { n: 0, bad: 0, ex: null } };
  await sample(page, 75000, (s, t) => {
    for (const cue of ["pitch", "resonance"]) {
      const r = s.rows[cue];
      if (!r?.dot || r.thumbY === null || !r.hlY || r.value === null || r.low === null) continue;
      const lo = Number(r.low), hi = Number(r.high), tol = cue === "pitch" ? 0.01 : 0.002;
      if (Math.min(Math.abs(r.value - lo), Math.abs(r.value - hi)) < tol) continue; // data-value is rounded
      const inRange = r.value >= lo && r.value <= hi, inBox = r.thumbY >= r.hlY[0] - 0.01 && r.thumbY <= r.hlY[1] + 0.01;
      outline[cue].n++;
      if (inRange !== inBox) { outline[cue].bad++; outline[cue].ex ??= { value: r.value, lo, hi, thumbY: r.thumbY, hlY: r.hlY }; }
    }
    const pr = s.rows.pitch;
    if (pr?.dot) { if (pr.hollow) hollowSeen++; if (pr.hollow !== /higher|lower/.test(pr.word ?? "")) hollowBad++; }
    if (WEIGHT_WORDS.test(s.stripText)) weightWordsLive++;
    if (CLARITY_WORDS.test(s.stripText)) clarityWordsLive++;
    if (s.cues.join() !== "pitch,resonance") extraRows++;
    for (const cue of ["pitch", "resonance"]) {
      const r = s.rows[cue];
      if (!r) continue;
      if (r.state === "live" && tLive[cue] === undefined) tLive[cue] = t;
      maxTrail[cue] = Math.max(maxTrail[cue], r.trail);
      if (cue === "resonance") { if (seen.resonance[seen.resonance.length - 1] !== r.state) seen.resonance.push(r.state); }
      else seen[cue].add(r.state);
    }
    return tLive.pitch !== undefined && tLive.resonance !== undefined
      && maxTrail.pitch >= 8 && maxTrail.resonance >= 3;
  });
  check("pitch dot live within 3 s", tLive.pitch !== undefined && tLive.pitch <= 3, `${tLive.pitch?.toFixed(1)} s`);
  const rs = seen.resonance.join(">");
  check("resonance warming -> settling -> live", /warming.*settling.*live/.test(rs), rs);
  check("resonance live within 12 s", tLive.resonance !== undefined && tLive.resonance <= 12, `${tLive.resonance?.toFixed(1)} s`);
  check("trail reaches 8 dots on pitch, 3 on resonance (one per 2 s of live speech)", maxTrail.pitch >= 8 && maxTrail.resonance >= 3, JSON.stringify(maxTrail));
  check("while live: two rows only, never clarity / weight words in the strip", extraRows === 0 && clarityWordsLive === 0 && weightWordsLive === 0,
    `extra rows ${extraRows}x, clarity words ${clarityWordsLive}x, weight words ${weightWordsLive}x`);
  check("pitch off target: hollow dot exactly when the row says higher / lower (not colour alone)", hollowBad === 0, `${hollowBad} mismatches, ${hollowSeen} hollow samples`);
  check("both columns: the thumb sits inside the target outline exactly when its value is inside the target range",
    outline.pitch.n > 0 && outline.resonance.n > 0 && outline.pitch.bad === 0 && outline.resonance.bad === 0, JSON.stringify(outline));
  await shot(page, "02-woman-live-masculine");
}
// directions via Settings
{
  const styles = {};
  for (const dir of ["masculine", "feminine", "androgynous", "exploring"]) {
    await openSettings(page);
    await pickDirection(page, dir, "[data-dialog=settings]");
    await closeSettings(page);
    await sleep(600);
    const s = await state(page);
    check(`${dir}: two rows, no clarity caveat / weight note, no weight or clarity words in the strip`,
      s.cues.join() === "pitch,resonance" && s.clarityNote === null && !s.weightNote && !WEIGHT_WORDS.test(s.stripText) && !CLARITY_WORDS.test(s.stripText),
      `${s.cues.join()} / ${s.clarityNote}`);
    for (const cue of ["pitch", "resonance"]) {
      const r = s.rows[cue];
      const want = dir === "exploring" ? null : SPEC_HL[cue][dir];
      if (want === null) {
        check(`${dir}: ${cue} has no highlight`, r.low === null && r.hl === null, `${r.low}–${r.high}`);
      } else {
        check(`${dir}: ${cue} highlight ${want[0]}–${want[1]}`, r.low !== null && Math.abs(Number(r.low) - want[0]) < 2e-3 && Math.abs(Number(r.high) - want[1]) < 2e-3, `${r.low}–${r.high}`);
        (styles[cue] ??= []).push(JSON.stringify(r.hl));
      }
    }
    await shot(page, `03-direction-${dir}`);
  }
  for (const cue of ["pitch", "resonance"]) {
    const u = new Set(styles[cue] ?? []);
    check(`${cue}: the highlight's computed fill / stroke are identical in every direction`, u.size === 1, [...u].join(" ≠ "));
  }
  // back to masculine for the rest
  await openSettings(page); await pickDirection(page, "masculine", "[data-dialog=settings]"); await closeSettings(page);
}
// heard-as on (by default; nothing to press)
{
  let s = await state(page);
  check("heard-as: still on, the gender worker runs", !heardAsOff(s) && gw(page) === 1, `${s.heardAs?.mode}/${s.heardAs?.reason}, ${gw(page)} workers`);
  await openSettings(page);
  check("Settings' switch agrees (on)", (await settingsSwitch(page)) === "true");
  await closeSettings(page);
  const shown = await sample(page, 120000, (st) => st.heardAs?.mode === "shown");
  s = await state(page);
  check("heard-as: one man <-> woman dome appears on speech (no bracket rows)", shown && s.heardAs.axes === 1 && s.heardAs.legacyRows === 0, `${s.heardAs?.mode}/${s.heardAs?.reason}`);
  axisChecks("woman", s);
  await contrastCheck(page, "woman");
  womanGuess = s.heardAs?.axis?.guess ?? null;
  check("heard-as: no '%' in the panel while it shows ranges", shown && !s.heardAs.text.includes("%"));
  check("heard-as: no verdict word", shown && !/likely (a )?(man|woman)|likely heard as a/i.test(s.heardAs.text.replace("Likely heard as", "")));
  await shot(page, "04-heard-as-woman");
  log(`  axis: ${JSON.stringify(s.heardAs?.axis)}`);
  // First-screen layout with the panel ON (the two-row strip must still fit).
  const L = await layout(page);
  check("layout (panel on): pitch trace and whole cue strip in the first screen, no horizontal scroll, no clipped header",
    inView(L.trace, L) && inView(L.strip, L) && L.scrollW <= L.vw && L.clipped.length === 0,
    `trace ${JSON.stringify(L.trace)} strip ${JSON.stringify(L.strip)} vh ${L.vh} scrollW ${L.scrollW} clipped ${L.clipped.join(" | ")}`);
  log(`  panel on: trace ${L.trace?.top}-${L.trace?.bottom}, strip ${L.strip?.top}-${L.strip?.bottom}, panel ${L.panel?.top}-${L.panel?.bottom}, session ${L.session?.top}-${L.session?.bottom}, vh ${L.vh}, scrollH ${L.scrollH}`);
}
// reload: persists
{
  await page.reload({ waitUntil: "domcontentloaded" });
  check("reload: listening again after Start practicing", await continueAfterReload(page));
  await sleep(1000);
  const s = await state(page);
  check("reload: heard-as is still on", !heardAsOff(s) && gw(page) === 1, `${s.heardAs?.mode}, ${gw(page)} workers`);
}
// off via Settings
{
  await openSettings(page);
  await page.evaluate(() => document.querySelector("[data-settings-heard-as] [role=switch]")?.click());
  await sleep(300);
  check("Settings' switch now off", (await settingsSwitch(page)) === "false");
  await closeSettings(page);
  // Puppeteer drops a terminated worker's target asynchronously; under load
  // that can take over 0.5 s (review round 2), so wait up to 3 s for it.
  for (let i = 0; i < 12 && gw(page) !== 0; i++) await sleep(250);
  const s = await state(page);
  check("panel gone (off) and the gender worker is gone", heardAsOff(s) && gw(page) === 0, `${s.heardAs?.mode}, ${gw(page)} workers`);
  check("off: still no turn-on button on the dashboard", (await turnOnButtons(page)) === 0);
  // back on (in Settings) for the other voices
  check("back on via Settings", await setHeardAs(page, true));
  await sleep(300);
}
// After the reload a fresh resonance engine withholds its position until the
// narrowband detector has decided (3 voiced s; 2026-10-19): wait for it.
let womanU = null;
await sample(page, 15000, (st) => (womanU = st.rows.resonance?.value ?? null) !== null);
check("no page errors (woman)", errors.length === 0, errors.slice(0, 3).join(" | "));

// ============================================================ 2 speech-man
log("speech-man");
await launch(WAV["speech-man"]);
({ page, errors } = await open());
check("man: listening", await continueAfterReload(page));
{
  let manU = null, pitchLive = false, resLive = false;
  await sample(page, 60000, (s) => {
    if (s.rows.pitch?.state === "live") pitchLive = true;
    if (s.rows.resonance?.state === "live") { resLive = true; manU = s.rows.resonance.value; }
    return pitchLive && resLive && s.heardAs?.mode === "shown";
  });
  const s = await state(page);
  check("man: pitch and resonance live", pitchLive && resLive);
  check("man: resonance reads lower than the woman's", manU !== null && womanU !== null && manU < womanU, `man ${manU} vs woman ${womanU}`);
  check("man: one man <-> woman dome, no '%'", s.heardAs?.mode === "shown" && s.heardAs.axes === 1 && s.heardAs.legacyRows === 0 && !s.heardAs.text.includes("%"), `${s.heardAs?.mode}/${s.heardAs?.reason}`);
  axisChecks("man", s);
  await contrastCheck(page, "man");
  const manGuess = s.heardAs?.axis?.guess ?? null;
  check("orientation: more of the dome would say man (from the left foot) for the man than for the woman — his best guess (data-split-guess) is above hers",
    manGuess !== null && womanGuess !== null && manGuess > womanGuess, `man ${manGuess} vs woman ${womanGuess}`);
  await shot(page, "05-man-live");
  // the panel itself (below the first screen on short / narrow viewports)
  await page.evaluate(() => document.querySelector("[data-heard-as]")?.scrollIntoView({ block: "center" }));
  await sleep(200);
  await shot(page, "05b-heard-as-panel");
  // "More" list: opens, carries the pitch-only late-switch-on and
  // false-alarm disclosures (measurements/heard-as-pitch-only-warning-
  // 2026-10-07.md §8.9) and wraps inside the panel.
  {
    await page.evaluate(() => [...document.querySelectorAll("[data-heard-as] button")].find((b) => b.textContent.trim() === "More")?.click());
    await sleep(300);
    const m = await page.evaluate(() => {
      const panel = document.querySelector("[data-heard-as]"), list = document.querySelector("[data-heard-as-more]");
      const li = document.querySelector("[data-heard-as-more] [data-heard-as-pitch-only-false-alarms]");
      const late = document.querySelector("[data-heard-as-more] [data-heard-as-pitch-only-late]");
      if (!panel || !list || !li || !late) return { found: !!list, li: !!li, late: !!late };
      const p = panel.getBoundingClientRect();
      const fits = (e) => { const r = e.getBoundingClientRect(); return r.left >= p.left - 0.5 && r.right <= p.right + 0.5; };
      return { found: true, li: true, late: true, text: li.textContent, lateText: late.textContent, items: list.querySelectorAll("li").length,
        inside: fits(li) && fits(late), noOverflow: li.scrollWidth <= li.clientWidth + 1 && late.scrollWidth <= late.clientWidth + 1,
        startLine: !!list.querySelector("[data-heard-as-pitch-only-start]")
          || [...list.querySelectorAll("li")].some((e) => !e.hasAttribute("data-heard-as-pitch-only-late") && /before you start talking|when you start talking:/.test(e.textContent)),
        pageScrollW: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    check("heard-as 'More': opens with the pitch-only late-switch-on and false-alarm lines (no start line), wrapped inside the panel, no horizontal page scroll",
      m.found && m.li && m.late && /pitch varies a lot/.test(m.text) && /men's voices/.test(m.text) && /turn this panel on at any time/.test(m.lateText)
      && /about 9 in 10 pitch-only changes in men's voices/.test(m.lateText)
      && /about as many as in the same test with the panel on from the start/.test(m.lateText) && /If the panel is on before you start talking but shows no reading during roughly your first half-minute to a minute of talking \(for example while it is still downloading\), the note may not appear/.test(m.lateText) && !/another tab/.test(m.lateText)
      && /Some expressive speakers see it much more often — up to about 1 in 6 updates/.test(m.text)
      && !m.startLine && m.inside && m.noOverflow && m.pageScrollW <= m.vw,
      JSON.stringify({ ...m, text: m.text?.slice(0, 60), lateText: m.lateText?.slice(0, 60) }));
    await page.evaluate(() => document.querySelector("[data-heard-as-pitch-only-late]")?.scrollIntoView({ block: "center" }));
    await sleep(200);
    await shot(page, "05b-heard-as-more");
    await page.evaluate(() => [...document.querySelectorAll("[data-heard-as] button")].find((b) => b.textContent.trim() === "Less")?.click());
    await sleep(200);
  }
  log(`  axis: ${JSON.stringify(s.heardAs?.axis)}`);
  check("no page errors (man)", errors.length === 0, errors.slice(0, 3).join(" | "));
}

// ============================================================ pitch-only (optional)
for (const who of PITCH_ONLY) {
  const meta = JSON.parse(readFileSync(path.join(WAVDIR, `pitch-only-${who}.json`), "utf8"));
  log(`pitch-only ${who} (${meta.key}, shift at ${meta.shiftS.toFixed(1)} s)`);
  await launch(WAV[`pitch-only-${who}`]);
  ({ page, errors } = await open());
  check(`pitch-only ${who}: listening`, await continueAfterReload(page));
  const t0 = Date.now();
  let before = 0, first = null, firstState = null, shownTicks = 0;
  await sample(page, (meta.shiftS + 25) * 1000, (s) => {
    const t = (Date.now() - t0) / 1000;
    if (s.heardAs?.mode === "shown") shownTicks++;
    const w = s.heardAs?.pitchOnly;
    if (w && t < meta.shiftS) before++;
    if (w && t >= meta.shiftS && first === null) { first = t - meta.shiftS; firstState = s; return true; }
  });
  check(`pitch-only ${who}: the warning is never shown before the shift`, before === 0, `${before} samples`);
  check(`pitch-only ${who}: the warning appears within 25 s after the shift`, first !== null, first === null ? `panel shown on ${shownTicks} samples` : `${first.toFixed(1)} s after`);
  const w = firstState?.heardAs?.pitchOnly;
  check(`pitch-only ${who}: shown in its own note slot directly under the axis, inside the shown estimate, with the shipped words and no '%'`,
    !!w && w.slot === "pitch-only" && w.underAxis && w.inShares && firstState.heardAs.mode === "shown" && w.text === PITCH_ONLY_TEXT && !firstState.heardAs.text.includes("%"), JSON.stringify(w));
  check(`pitch-only ${who}: the only note while it is on (no extra note beside it)`, !!w && w.otherNotes === 0, JSON.stringify(w));
  check(`pitch-only ${who}: the always-mounted live region carries the same words`, firstState?.heardAs?.live?.role === "status" && firstState.heardAs.live.text === PITCH_ONLY_TEXT, JSON.stringify(firstState?.heardAs?.live));
  if (first !== null) {
    // First screen: the warning's box at scrollTop 0, above the practice dock.
    const fold = await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const e of document.querySelectorAll("*")) if (e.scrollTop > 0) e.scrollTop = 0;
      const n = document.querySelector("[data-pitch-only]");
      if (!n) return null;
      // the practice dock pinned under the tab content, or the scroll area's bottom if that is higher
      const bar = document.querySelector("[data-practice-dock]");
      let sc = n.parentElement;
      while (sc && !["auto", "scroll"].includes(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      const limit = Math.min(bar ? bar.getBoundingClientRect().top : innerHeight, sc ? sc.getBoundingClientRect().bottom : innerHeight);
      const r = n.getBoundingClientRect();
      // any line of the dome's sentence (its text, not the line box) above the fold
      const lines = [...document.querySelectorAll("[data-heard-as-range] > span")].map((e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); });
      const dome = document.querySelector("[data-split-bar]")?.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(limit), inView: r.top >= 0 && r.bottom <= limit + 0.5,
        sentenceLines: lines.map((l) => [Math.round(l.top), Math.round(l.bottom)]), sentenceShows: lines.some((l) => l.top + 3 < limit && l.bottom > 0),
        // a sentence line sliced by the fold (the first screen ends through it)
        sentenceCut: lines.some((l) => l.top + 1 < limit && l.bottom - 1 > limit),
        // the warning right under the dome (6-44 px below its box at 360-1366 px wide, 2026-10-26)
        underDome: !!dome && r.top >= dome.bottom - 0.5 && r.top - dome.bottom <= 60, gapBelowDome: dome ? Math.round(r.top - dome.bottom) : null };
    });
    await sleep(150);
    await shot(page, `05c-pitch-only-${who}-first-screen`);
    log(`  pitch-only ${who} at scrollTop 0: ${JSON.stringify(fold)}`);
    // Phones since 2026-10-25: the twin columns fill the first screen and the dome follows below it (owner's
    // choice), so on every phone size the rule is the conditional one — wherever users can read any of the
    // sentence at scrollTop 0, they can read the warning too (2026-10-26: it asked for the whole dome and key row,
    // so a sentence line sliced by the dock with the warning below passed); desktop keeps the dome in the right column.
    // On phones that rule alone is vacuous (the sentence never shows at scrollTop 0 by design — 2026-10-26 review),
    // so they also check what the design promises: no sentence line sliced by the fold; every viewport, the
    // warning directly under the dome.
    if (VIEWPORT === "desktop") {
      check(`pitch-only ${who}: the warning is on the first screen (scrollTop 0, above the bottom bar)`, !!fold?.inView, JSON.stringify(fold));
    } else {
      check(`pitch-only ${who}: whenever any line of the dome's sentence is on the first screen, so is the warning`, !!fold && (!fold.sentenceShows || fold.inView), JSON.stringify(fold));
      check(`pitch-only ${who}: no line of the dome's sentence is sliced by the first screen's end`, !!fold && !fold.sentenceCut, JSON.stringify(fold));
    }
    check(`pitch-only ${who}: the warning sits directly under the dome (<= 60 px below its box)`, !!fold?.underDome, JSON.stringify(fold));
    // Hold through brief hides: shown estimates in the next 20 s that carry it.
    let shownAfter = 0, warnedAfter = 0, wideWarned = 0;
    await sample(page, 20000, (s) => {
      if (s.heardAs?.mode !== "shown") return;
      shownAfter++;
      if (s.heardAs.pitchOnly) { warnedAfter++; if (s.heardAs.wide) wideWarned++; }
    });
    log(`  pitch-only ${who}: next 20 s — ${warnedAfter}/${shownAfter} shown samples carry the warning (${wideWarned} of them while "Could go either way")`);
    check(`pitch-only ${who}: kept on most shown estimates in the next 20 s (>= 80 %)`, shownAfter > 0 && warnedAfter / shownAfter >= 0.8, `${warnedAfter}/${shownAfter}`);
    await page.evaluate(() => document.querySelector("[data-pitch-only]")?.scrollIntoView({ block: "center" }));
    await sleep(200);
    await shot(page, `05c-pitch-only-${who}`);
    const fits = await page.evaluate(() => { const p = document.querySelector("[data-heard-as]"); return p ? p.scrollWidth <= p.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth : false; });
    check(`pitch-only ${who}: the note wraps inside the panel (no horizontal overflow)`, fits);
    await contrastCheck(page, `pitch-only ${who}`);
  }
  check(`no page errors (pitch-only ${who})`, errors.length === 0, errors.slice(0, 3).join(" | "));
}

// ============================================================ pitch-only, panel switched on late (optional)
for (const who of PITCH_ONLY_LATE) {
  const meta = JSON.parse(readFileSync(path.join(WAVDIR, `pitch-only-late-${who}.json`), "utf8"));
  log(`pitch-only late ${who} (${meta.key}, shift at ${meta.shiftS.toFixed(1)} s, panel on at ${PANEL_ON_AT_S} s)`);
  // The panel must be OFF when listening starts, so that its first update() comes after t_fill. The setting persists
  // in the profile (the earlier runs left it on): switch it off in Settings on the page still open from the previous
  // run, before Chrome is relaunched with this run's audio. (The panel is not rendered before listening starts.)
  await openSettings(page);
  if ((await settingsSwitch(page)) === "true") await page.evaluate(() => document.querySelector("[data-settings-heard-as] [role=switch]")?.click());
  await sleep(300);
  const offSaved = (await settingsSwitch(page)) === "false";
  await closeSettings(page);
  await sleep(700);   // the setting's IndexedDB write
  await launch(WAV[`pitch-only-late-${who}`]);
  ({ page, errors } = await open());
  const listening = await continueAfterReload(page);
  const t0 = Date.now();
  check(`pitch-only late ${who}: listening`, listening);
  await sleep(300);
  check(`pitch-only late ${who}: the panel is off when listening starts (switched off in Settings before)`,
    offSaved && heardAsOff(await state(page)) && gw(page) === 0, `${(await state(page)).heardAs?.mode}, ${gw(page)} workers`);
  let offOk = true, startBefore = false;
  await sample(page, PANEL_ON_AT_S * 1000 - (Date.now() - t0), (s) => { if (!heardAsOff(s) || gw(page) !== 0) offOk = false; startBefore = s.cueStart; });
  check(`pitch-only late ${who}: the panel stayed off (no gender worker) until ${PANEL_ON_AT_S} s`, offOk);
  check(`pitch-only late ${who}: the cue's start window had closed before switch-on (start marker shown)`, startBefore);
  const onAt = (Date.now() - t0) / 1000;
  const onOk = await setHeardAs(page, true);   // Settings is the only switch since 2026-10-25
  for (let i = 0; i < 12 && gw(page) !== 1; i++) await sleep(250);
  check(`pitch-only late ${who}: turned on in Settings at ${onAt.toFixed(1)} s, the gender worker starts`, onOk && !heardAsOff(await state(page)) && gw(page) === 1);
  let before = 0, first = null, firstState = null, shownTicks = 0, firstShown = null;
  await sample(page, Math.max(0, (meta.shiftS + 25) * 1000 - (Date.now() - t0)), (s) => {
    const t = (Date.now() - t0) / 1000;
    if (s.heardAs?.mode === "shown") { shownTicks++; if (firstShown === null) firstShown = t; }
    const w = s.heardAs?.pitchOnly;
    if (w && t < meta.shiftS) before++;
    if (w && t >= meta.shiftS && first === null) { first = t - meta.shiftS; firstState = s; return true; }
  });
  log(`  pitch-only late ${who}: switched on at ${onAt.toFixed(1)} s, first shown estimate at ${firstShown?.toFixed(1)} s, shift at ${meta.shiftS.toFixed(1)} s`);
  check(`pitch-only late ${who}: the warning is never shown before the shift`, before === 0, `${before} samples`);
  check(`pitch-only late ${who}: the warning appears within 25 s after the shift`, first !== null, first === null ? `panel shown on ${shownTicks} samples` : `${first.toFixed(1)} s after`);
  const w = firstState?.heardAs?.pitchOnly;
  check(`pitch-only late ${who}: shown under the axis with the shipped words, mirrored in the live region`,
    !!w && w.slot === "pitch-only" && w.underAxis && w.text === PITCH_ONLY_TEXT && firstState.heardAs.live?.text === PITCH_ONLY_TEXT, JSON.stringify(w));
  if (first !== null) {
    await page.evaluate(() => document.querySelector("[data-pitch-only]")?.scrollIntoView({ block: "center" }));
    await sleep(200);
    await shot(page, `05d-pitch-only-late-${who}`);
  }
  check(`no page errors (pitch-only late ${who})`, errors.length === 0, errors.slice(0, 3).join(" | "));
}

// ============================================================ 3 held
log("held vowel");
await launch(WAV.held);
({ page, errors } = await open());
check("held: listening", await continueAfterReload(page));
// Voice gate: FireRedVAD scores this SYNTHETIC held vowel as no voice (the
// 2026-10-20 screen: median 0.08-0.22 on clean synthetic hums), so with the
// gate on the pitch row stays idle — the documented cost
// (measurements/noise-detector-tryout-2026-10-20.md). Checked here, so the
// cost stays visible (when the detector is running; a change here means the
// design note is out of date). Since 2026-10-21 the resonance row reads the
// same gated flags (cueStripModel.js cueRowStates; measurements/
// voice-gate-resonance-row-2026-10-21.md), so it is idle too: "—", not
// "needs running speech" (before, its raw flags kept it "keep talking…").
// Then the gate is switched off in Settings so the checks below, which use
// the pitch row as their voicing proxy for the RESONANCE row's verdict, run
// as before.
if (await page.evaluate(() => !!document.querySelector('[aria-label="Settings & Data"]'))) {
  await sleep(1000);
  let n = 0, live = 0, resVoiced = 0, resIdle = 0, resWarming = 0, resDot = 0;
  const resStates = new Set();
  await sample(page, 8000, (s) => {
    n++;
    if (s.rows.pitch?.state === "live") live++;
    if (s.rows.resonance?.state) resStates.add(s.rows.resonance.state);
    if (s.rows.resonance?.state && !["idle", "starting"].includes(s.rows.resonance.state)) resVoiced++;
    if (s.rows.resonance?.state === "idle") resIdle++;
    if (s.rows.resonance?.state === "warming") resWarming++;
    if (s.rows.resonance?.dot) resDot++;
  });
  await openSettings(page);
  const sw = await page.evaluate(() => {
    const b = document.querySelector("[data-voice-gate-switch]");
    if (!b) return null;
    const status = document.querySelector("[data-voice-gate-status]")?.getAttribute("data-voice-gate-status") ?? null;
    const was = b.getAttribute("aria-checked");
    if (was === "true") b.click();
    return { was, status };
  });
  await sleep(150);
  const after = await page.evaluate(() => document.querySelector("[data-voice-gate-switch]")?.getAttribute("aria-checked") ?? null);
  await closeSettings(page);
  if (sw !== null) {
    const gating = sw.was === "true" && sw.status === "ready";
    log(`  held (gate ${sw.was === "true" ? "on" : "off"}, detector ${sw.status}): pitch row live on ${live}/${n} samples; resonance row active on ${resVoiced}/${n} (states ${[...resStates].join(",")})`);
    if (gating) {
      check("held, voice gate on: the pitch row stays hidden on this synthetic held vowel (the documented cost)",
        n >= 20 && live <= Math.floor(n * 0.1), `live on ${live}/${n} samples`);
      check("held, voice gate on: the resonance row follows the gated flags — idle (\"—\"), not \"keep talking…\", no dot",
        n >= 20 && resIdle >= Math.ceil(n * 0.8) && resWarming <= Math.floor(n * 0.1) && resDot === 0,
        `idle ${resIdle}/${n}, "keep talking…" ${resWarming}, dot ${resDot}`);
    } else {
      log(`  (the gate's cost is not checked: the gate is ${sw.was === "true" ? `on but the detector is ${sw.status}` : "off"})`);
      check("held, gate not hiding: the resonance row is active", n >= 20 && resVoiced >= Math.ceil(n * 0.8), `${resVoiced}/${n}`);
    }
    check("held: try-out voice gate switched off for the resonance checks", after === "false", `${after}`);
  }
}
{
  let voiced = 0, sustained = 0, shownEver = false, reasonSustained = false;
  let voicedRun = 0;
  await sample(page, 22000, (s) => {
    const live = s.rows.pitch?.state === "live";
    voicedRun = live ? voicedRun + 1 : 0;
    if (voicedRun > 4) { voiced++; if (s.rows.resonance?.state === "sustained") sustained++; }
    if (s.heardAs?.mode === "shown") shownEver = true;
    if (s.heardAs?.reason === "sustained") reasonSustained = true;
  });
  check("held: resonance 'sustained' for >= 60 % of the voiced hold after its first second", voiced > 10 && sustained / voiced >= 0.6, `${sustained}/${voiced}`);
  check("held: the panel never shows ranges", !shownEver);
  check("held: the panel says it needs running speech", reasonSustained);
  await shot(page, "06-held");
}
// The try-out voice gate back on (its default) for the later runs on this profile.
if (await page.evaluate(() => !!document.querySelector('[aria-label="Settings & Data"]'))) {
  await openSettings(page);
  await page.evaluate(() => {
    const b = document.querySelector("[data-voice-gate-switch]");
    if (b && b.getAttribute("aria-checked") === "false") b.click();
  });
  await sleep(300);
  await closeSettings(page);
}

// ============================================================ 4 noise / 5 silence
for (const kind of ["noise", "silence"]) {
  log(kind);
  await launch(WAV[kind]);
  ({ page, errors } = await open());
  check(`${kind}: listening`, await continueAfterReload(page));
  await sleep(6000);
  let dots = 0, shownEver = false, n = 0;
  await sample(page, 8000, (s) => {
    n++;
    for (const cue of ["pitch", "resonance"]) if (s.rows[cue]?.dot) dots++;
    if (s.heardAs?.mode === "shown") shownEver = true;
  });
  check(`${kind}: no dot on any row after the 5 s hold`, dots === 0, `${dots} dot-samples / ${n}`);
  check(`${kind}: the panel never shows ranges`, !shownEver);
  await shot(page, `07-${kind}`);
}

// ============================================================ 6 narrowband (phone-quality audio)
{
  log("narrowband");
  await launch(WAV.narrowband);
  ({ page, errors } = await open());
  check("narrowband: listening", await continueAfterReload(page));
  let tNotice = null, pitchLive = false, dotsBefore = 0, dotsDuring = 0, trailDuring = 0, badHeader = null, nDuring = 0;
  await sample(page, 25000, (s, t) => {
    const r = s.rows.resonance;
    if (s.rows.pitch?.state === "live") pitchLive = true;
    if (r?.state === "narrowband") {
      if (tNotice === null) tNotice = t;
      nDuring++;
      if (r.dot) dotsDuring++;
      if (r.trail > 0) trailDuring++;
      if (r.header !== NARROWBAND_NOTICE) badHeader = r.header;
    } else if (tNotice === null && r?.dot) dotsBefore++;
  });
  check("narrowband: the resonance row shows the notice", tNotice !== null && nDuring > 10, `from ${tNotice?.toFixed(1)} s, ${nDuring} samples`);
  check("narrowband: no resonance dot before the notice (position withheld until the detector decides)", dotsBefore === 0, `${dotsBefore} dot-samples`);
  check("narrowband: no dot or trail while the notice is on, header is the notice", dotsDuring === 0 && trailDuring === 0 && badHeader === null,
    `${dotsDuring} dots, ${trailDuring} trails, header ${JSON.stringify(badHeader)}`);
  check("narrowband: the pitch row still goes live", pitchLive);
  const L = await layout(page);
  check("narrowband: the notice header is not clipped; strip in the first screen, no horizontal scroll",
    L.clipped.length === 0 && inView(L.strip, L) && L.scrollW <= L.vw, `${L.clipped.join(" | ")} ${JSON.stringify(L.strip)} vw ${L.vw}`);
  await shot(page, "08-narrowband");
  const r = await probePopover(page, "About the resonance cue");
  check("narrowband: info popover opens, wraps, on top, inside the viewport", r.found && r.open && r.wraps && r.onTop && r.inViewport, JSON.stringify(r));
  const first = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("[data-cue-strip] button")].find((b) => b.getAttribute("aria-label") === "About the resonance cue");
    btn?.click();
    await new Promise((res) => setTimeout(res, 150));
    const pop = document.getElementById(btn?.getAttribute("aria-controls") ?? "");
    return pop?.innerText ?? "";
  });
  await shot(page, "08b-narrowband-info");
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  check("narrowband: the info text comes first in the popover", first.trim().startsWith(NARROWBAND_INFO), first.slice(0, 80));
}

await browser.close().catch(() => {});
closeBrowserHard();
const failedN = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(`\n[${VIEWPORT}] ${results.length - failedN}/${results.length} passed`);
cleanup();
process.exit(failedN ? 1 : 0);
