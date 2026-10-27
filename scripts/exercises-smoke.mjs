// exercises-smoke.mjs — headless check of the Exercises tab (src/exercises/) against the
// BUILT app (dist/, served by a static server under /Syrinx/), with Chrome's fake mic
// playing public speech (scripts/voice-preview-smoke-wavs.mjs -> clean.wav: two
// LibriSpeech test-clean excerpts, CC BY 4.0). docs/guided-exercises-design.md §8.
//
//   npm run build && node scripts/voice-preview-smoke-wavs.mjs && node scripts/exercises-smoke.mjs
//     [--viewports=p360,phone,p402,landscape,desktop] [--parts=tabs,idle,cards,flow] [--out=<dir>]
//
// Parts:
//   tabs   per viewport, the tab bar with the Resonance lab off (five tabs) and on (six):
//          the order, one row, inside the viewport, no overflow; 320 px too.
//   idle   the mic off: the Exercises tab lists every lesson; a live card offers "Turn on
//          the mic", which starts listening and keeps the lesson and the card.
//   cards  per viewport, every card of every lesson for every direction: Back / Next above
//          the practice dock, no horizontal page scroll, and on a live card the trace and
//          its level line visible without scrolling (the design's phone rule: 360 x 690 and
//          448 x 890). Screenshots of each card at the first viewport.
//   flow   (feminine) "Count on your target": the measuring cards collect voice and the
//          result names a level and an in-band share; the feel answer saves ("Saved."),
//          the list then says "Last done: today"; "Tongue and lips": two takes recorded
//          and played; "Hear it first": a recording, then the brighter version renders and
//          plays; a Strained answer offers the cool-down, which opens it. No page errors.
//
// Process hygiene (CLAUDE.md hard rule 2): Puppeteer's own Chrome with a per-run profile;
// cleanup kills only its PID (taskkill /pid <pid> /T /F) and removes the profile.

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const PARTS = new Set(arg("parts", "tabs,idle,cards,flow").split(",").filter(Boolean));
const VIEWPORT_LIST = arg("viewports", "p360,phone,p402,landscape,desktop").split(",").filter(Boolean);
const OUT = arg("out", path.join(repo, "build", "exercises-smoke", "shots"));
const WAV = arg("wav", path.join(repo, "build", "voice-preview-smoke", "wavs", "clean.wav"));
const PORT = Number(arg("port", "4195"));
const CHROME = arg("chrome", "") || ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!CHROME || !existsSync(WAV)) { console.error("need Chrome and the speech WAV (node scripts/voice-preview-smoke-wavs.mjs)"); process.exit(2); }
if (!existsSync(path.join(repo, "dist", "index.html"))) { console.error("need a build (npm run build)"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  p360: { width: 360, height: 690, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  p402: { width: 402, height: 750, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  phone: { width: 448, height: 890, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { width: 890, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
// the design's fit rule is for portrait phones; elsewhere it is reported, not required
const FIT_REQUIRED = new Set(["p360", "p402", "phone"]);

// ---------------------------------------------------------------- processes

let browser = null;
let profile = null;
let httpServer = null;
function closeBrowserHard() {
  const pid = browser?.process?.()?.pid;
  if (pid) { try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* closed */ } }
  browser = null;
  if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } profile = null; }
}
function cleanup() { closeBrowserHard(); try { httpServer?.close(); } catch { /* closed */ } }
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let scope = "";
const check = (name, ok, detail = "") => {
  results.push({ name: `[${scope}] ${name}`, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${scope}] ${name}${detail ? `  (${detail})` : ""}`);
};
const note = (name, detail = "") => console.log(`NOTE  [${scope}] ${name}${detail ? `  (${detail})` : ""}`);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".onnx": "application/octet-stream" };
function startStatic() {
  const root = path.join(repo, "dist");
  httpServer = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = decodeURIComponent(u.pathname.replace(/^\/Syrinx\/?/, "/"));
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(f));
  });
  return new Promise((r) => httpServer.listen(PORT, "127.0.0.1", r));
}

async function launch() {
  if (browser) { await browser.close().catch(() => {}); closeBrowserHard(); }
  profile = mkdtempSync(path.join(tmpdir(), "ex-smoke-"));
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
  });
}

async function open(viewport) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[viewport]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`http://127.0.0.1:${PORT}/Syrinx/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.bringToFront();
  return { page, errors };
}

const clickText = (page, texts, sel = "button") => page.evaluate((ts, sel) => {
  const b = [...document.querySelectorAll(sel)].find((x) => ts.some((t) => x.textContent.trim() === t || x.textContent.trim().includes(t)));
  if (b) b.click();
  return !!b;
}, texts, sel);
const clickSel = (page, sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); return !!b; }, sel);

/** The goal sheet: pick a goal; start the mic or put it off ("Not now"). */
async function answerGoal(page, direction, { start = true } = {}) {
  await page.waitForSelector("[data-dialog=direction]", { timeout: 60000 });
  await page.evaluate(() => document.querySelector("[role=dialog] [data-change-goal]")?.click());
  await sleep(200);
  await page.evaluate((id) => { document.querySelector(`[role=dialog] input[data-direction="${id}"]`)?.closest("label")?.click(); }, direction);
  await sleep(200);
  if (start) {
    await clickText(page, ["Start — allow the microphone", "Start practicing"], "[role=dialog] button");
    await page.waitForFunction(() => document.body.innerText.includes("Mic off"), { timeout: 30000 });
  } else {
    await clickText(page, ["Not now"], "[role=dialog] button");
    await page.waitForFunction(() => !document.querySelector("[data-dialog=direction]"), { timeout: 10000 });
  }
}
async function setGoalInSettings(page, direction) {
  await clickSel(page, 'button[aria-label="Settings & Data"]');
  await page.waitForSelector(`input[data-direction="${direction}"]`, { timeout: 10000 });
  await page.evaluate((id) => { document.querySelector(`input[data-direction="${id}"]`)?.closest("label")?.click(); }, direction);
  await sleep(200);
  await clickText(page, ["Done"]);
  await sleep(300);
}
async function setLab(page, on) {
  await clickSel(page, 'button[aria-label="Settings & Data"]');
  await page.waitForSelector("[data-settings-lab-switch]", { timeout: 10000 });
  const was = await page.evaluate(() => document.querySelector("[data-settings-lab-switch]").getAttribute("aria-checked") === "true");
  if (was !== on) await clickSel(page, "[data-settings-lab-switch]");
  await sleep(200);
  await clickText(page, ["Done"]);
  await sleep(300);
}
const openTab = async (page, label) => { await clickText(page, [label], "nav button"); await sleep(300); };
const tabBar = (page) => page.evaluate(() => {
  const nav = document.querySelector("nav");
  const bs = [...nav.querySelectorAll("button")];
  const r = bs.map((b) => b.getBoundingClientRect());
  return { labels: bs.map((b) => b.textContent.trim()), oneRow: r.every((x) => Math.abs(x.top - r[0].top) < 0.5),
    left: +Math.min(...r.map((x) => x.left)).toFixed(1), right: +Math.max(...r.map((x) => x.right)).toFixed(1),
    minW: +Math.min(...r.map((x) => x.width)).toFixed(1), minH: +Math.min(...r.map((x) => x.height)).toFixed(1),
    navOverflow: nav.scrollWidth > nav.clientWidth + 0.5, innerW: innerWidth, docW: document.documentElement.scrollWidth,
    navLeft: nav.getBoundingClientRect().left, navRight: nav.getBoundingClientRect().right };
});
// Six tabs (the lab on) below ~410 px: the row scrolls inside itself — one row, no page
// scroll, and scrolled to its end the last tab is fully inside the nav.
const scrollsToLast = (page) => page.evaluate(() => {
  const nav = document.querySelector("nav");
  nav.scrollLeft = nav.scrollWidth;
  const last = [...nav.querySelectorAll("button")].at(-1).getBoundingClientRect();
  const n = nav.getBoundingClientRect();
  const ok = last.right <= n.right + 0.5 && last.left >= n.left - 0.5;
  nav.scrollLeft = 0;
  return ok;
});
const TABS = ["Dashboard", "Exercises", "Pitch", "History", "Voice Shaper", "Resonance lab"];
const TABS_NO_LAB = TABS.slice(0, 5);

const LESSONS = ["S1", "W1", "W2", "P5", "P6", "R1", "R2", "R3", "R4"];
const openLesson = async (page, id) => {
  if (await page.$("[data-lesson-close]")) { await clickSel(page, "[data-lesson-close]"); await sleep(200); }
  await page.waitForSelector(`[data-lesson="${id}"]`, { timeout: 15000 });
  await clickSel(page, `[data-lesson="${id}"]`);
  await page.waitForSelector(`[data-lesson-player="${id}"]`, { timeout: 15000 });
};
const cardInfo = (page) => page.evaluate(() => {
  const p = document.querySelector("[data-lesson-player]");
  const nav = p.querySelector("nav").getBoundingClientRect();
  const scroller = p.querySelector("[data-card-scroll]");
  const sc = scroller.getBoundingClientRect();
  const dock = document.querySelector("[data-dock-slot]")?.getBoundingClientRect();
  const tool = p.querySelector("[data-card-tool]")?.getBoundingClientRect();
  return {
    kind: p.dataset.cardKind, card: +p.dataset.card, of: p.querySelector("[data-card-of]").textContent,
    heading: p.querySelector("[data-card-heading]").textContent,
    navTop: +nav.top.toFixed(1), navBottom: +nav.bottom.toFixed(1), dockTop: dock && dock.height > 0 ? +dock.top.toFixed(1) : innerHeight,
    toolTop: tool ? +tool.top.toFixed(1) : null, toolBottom: tool ? +tool.bottom.toFixed(1) : null,
    scrollerTop: +sc.top.toFixed(1), scrollerBottom: +sc.bottom.toFixed(1), scrollerH: +sc.height.toFixed(1),
    overflowY: scroller.scrollHeight > scroller.clientHeight + 1, innerW: innerWidth, docW: document.documentElement.scrollWidth,
    innerH: innerHeight,
  };
});

// ---------------------------------------------------------------- parts

async function partTabs(v) {
  scope = `tabs ${v}`;
  await launch();
  const { page, errors } = await open(v);
  await answerGoal(page, "feminine");
  await setLab(page, false);
  const t5 = await tabBar(page);
  check("lab off: Dashboard, Exercises, Pitch, History, Voice Shaper", JSON.stringify(t5.labels) === JSON.stringify(TABS_NO_LAB), t5.labels.join(" | "));
  check("lab off: one row, inside the viewport, no overflow; tabs >= 24 x 24", t5.oneRow && t5.left >= -0.5 && t5.right <= t5.innerW + 0.5 && !t5.navOverflow && t5.docW <= t5.innerW && t5.minW >= 24 && t5.minH >= 24, JSON.stringify(t5));
  await setLab(page, true);
  const t6 = await tabBar(page);
  check("lab on: six tabs in order", JSON.stringify(t6.labels) === JSON.stringify(TABS), t6.labels.join(" | "));
  if (VIEWPORTS[v].width >= 410) {
    check("lab on: one row, inside the viewport, no overflow; tabs >= 24 x 24", t6.oneRow && t6.left >= -0.5 && t6.right <= t6.innerW + 0.5 && !t6.navOverflow && t6.docW <= t6.innerW && t6.minW >= 24 && t6.minH >= 24, JSON.stringify(t6));
  } else {
    check("lab on, narrow: one row that scrolls inside itself to the last tab, no page scroll; tabs >= 24 x 24",
      t6.oneRow && t6.docW <= t6.innerW && t6.minW >= 24 && t6.minH >= 24 && (await scrollsToLast(page)), JSON.stringify(t6));
    await clickText(page, ["Resonance lab"], "nav button");
    await sleep(600);
    const lab = await page.evaluate(() => { const b = [...document.querySelectorAll("nav button")].at(-1).getBoundingClientRect(); const n = document.querySelector("nav").getBoundingClientRect(); return b.right <= n.right + 0.5 && b.left >= n.left - 0.5; });
    check("lab on, narrow: selecting the last tab scrolls it into view", lab);
    await openTab(page, "Dashboard");
  }
  await page.screenshot({ path: path.join(OUT, `${v}-tabs6.png`), clip: { x: 0, y: 0, width: VIEWPORTS[v].width, height: 140 } });
  if (v === VIEWPORT_LIST[0] && VIEWPORTS[v].width > 320) {
    await page.setViewport({ ...VIEWPORTS[v], width: 320 });
    await sleep(300);
    const t320 = await tabBar(page);
    check("320 px, lab on: six tabs on one row that scrolls inside itself, no page scroll", t320.oneRow && t320.docW <= t320.innerW && t320.minW >= 24 && t320.minH >= 24 && (await scrollsToLast(page)), JSON.stringify(t320));
    await setLab(page, false);
    const t320b = await tabBar(page);
    check("320 px, lab off: five tabs on one row inside the viewport", t320b.oneRow && t320b.left >= -0.5 && t320b.right <= t320b.innerW + 0.5 && !t320b.navOverflow, JSON.stringify(t320b));
    await page.screenshot({ path: path.join(OUT, "p320-tabs5.png"), clip: { x: 0, y: 0, width: 320, height: 140 } });
  }
  await setLab(page, false);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

async function partIdle(v) {
  scope = `idle ${v}`;
  await launch();
  const { page, errors } = await open(v);
  await answerGoal(page, "feminine", { start: false });
  await openTab(page, "Exercises");
  await page.waitForSelector("[data-exercises-list]", { timeout: 30000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll("[data-lesson]")].map((b) => b.dataset.lesson));
  check("mic off: the list shows every lesson in order", JSON.stringify(ids) === JSON.stringify(LESSONS), ids.join(","));
  const lastDone = await page.evaluate(() => [...document.querySelectorAll("[data-last-done]")].every((x) => x.textContent === "Not done yet"));
  check("a fresh profile: every lesson \"Not done yet\"", lastDone);
  await page.screenshot({ path: path.join(OUT, `${v}-list.png`) });
  await openLesson(page, "P6");
  for (let i = 0; i < 2; i++) { await clickSel(page, "[data-card-next]"); await sleep(150); }
  const before = await cardInfo(page);
  const prompt = await page.$("[data-mic-prompt]");
  check("mic off: the first live card offers \"Turn on the mic\"", before.kind === "live" && !!prompt, JSON.stringify(before));
  await clickText(page, ["Turn on the mic"], "[data-mic-prompt] button");
  await page.waitForFunction(() => document.body.innerText.includes("Mic off"), { timeout: 30000 });
  await page.waitForSelector("[data-live-view]", { timeout: 30000 });
  const after = await cardInfo(page);
  check("…which starts listening and keeps the lesson and the card", after.card === before.card && after.heading === before.heading, `${before.heading} -> ${after.heading}`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

async function partCards(v) {
  scope = `cards ${v}`;
  await launch();
  const { page, errors } = await open(v);
  await answerGoal(page, "feminine");
  await openTab(page, "Exercises");
  const shots = v === VIEWPORT_LIST[0];
  for (const dir of ["feminine", "masculine", "androgynous", "exploring"]) {
    if (dir !== "feminine") await setGoalInSettings(page, dir);
    for (const id of LESSONS) {
      await openLesson(page, id);
      const bad = [];
      let n = 0;
      let safetySeen = false;
      for (let guard = 0; guard < 20; guard++) {
        const c = await cardInfo(page);
        n++;
        // the safety box is on screen before the lesson's steps (lessons-test checks the text)
        if (await page.$eval("[data-lesson-player]", (el) => (el.querySelector("[data-safety]")?.textContent ?? "").includes("Stop if it hurts"))) safetySeen = true;
        if (c.kind === "result" && id !== "S1" && !safetySeen) bad.push(`${id}: no safety box shown on any card`);
        const navOk = c.navBottom <= c.dockTop + 0.5 && c.navTop >= 0;
        const wideOk = c.docW <= c.innerW;
        // the card's tool (trace / recorder / play buttons) sits between the text and
        // Back / Next, and the text keeps room for its heading and a few lines
        const toolOk = c.toolTop == null || (c.toolTop >= c.scrollerTop - 0.5 && c.toolBottom <= c.navTop + 0.5 && (c.toolTop >= c.scrollerBottom - 0.5 || c.innerW > c.innerH));
        const textOk = c.scrollerH >= 120;
        if (!navOk || !wideOk || !toolOk || (!textOk && FIT_REQUIRED.has(v))) bad.push(`${c.of} ${c.heading}: ${JSON.stringify(c)}`);
        else if (!textOk) note(`${dir} ${id} ${c.of} little room for the text`, `${c.scrollerH} px`);
        if (shots && dir === "feminine") await page.screenshot({ path: path.join(OUT, `${v}-${id}-${String(c.card + 1).padStart(2, "0")}.png`) });
        if (c.kind === "result") break;
        await clickSel(page, "[data-card-next]");
        await sleep(120);
      }
      check(`${dir} ${id}: ${n} cards — Back / Next above the dock, the tool between text and buttons, no sideways scroll${FIT_REQUIRED.has(v) ? ", >= 120 px for the text" : ""}`, bad.length === 0, bad[0]);
    }
  }
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

const goToCard = async (page, heading) => {
  for (let i = 0; i < 20; i++) {
    const c = await cardInfo(page);
    if (c.heading === heading) return c;
    if (c.kind === "result") return null;
    await clickSel(page, "[data-card-next]");
    await sleep(150);
  }
  return null;
};

// the saved exerciseResults rows, read straight from IndexedDB (review 2026-10-27: "Saved."
// alone comes from the page's state, not from the database)
const savedRows = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("syrinx");
  req.onsuccess = () => {
    const db = req.result;
    const all = db.transaction("exerciseResults").objectStore("exerciseResults").getAll();
    all.onsuccess = () => { resolve(all.result); db.close(); };
    all.onerror = () => { resolve(null); db.close(); };
  };
  req.onerror = () => resolve(null);
}));

async function partFlow(v) {
  scope = `flow ${v}`;
  await launch();
  const { page, errors } = await open(v);
  await answerGoal(page, "feminine");
  await openTab(page, "Exercises");

  // Count on your target
  await openLesson(page, "P6");
  await goToCard(page, "Count to ten");
  await sleep(7000);
  const voiced1 = await page.evaluate(() => +document.querySelector("[data-voice-so-far]")?.dataset.voiceSoFar);
  const level = await page.evaluate(() => document.querySelector("[data-level-line]")?.textContent);
  check("Count to ten: voice collected while the card is on screen", voiced1 >= 2, `${voiced1} s`);
  check("…the level line names a level and where it sits", /Pitch level: \d+ Hz/.test(level ?? "") || /—/.test(level ?? ""), level);
  await goToCard(page, "Short phrases");
  await sleep(4000);
  await goToCard(page, "How did it go?");
  await page.waitForSelector("[data-result-lines]", { timeout: 10000 });
  await sleep(500);
  const lines = await page.evaluate(() => document.querySelector("[data-result-lines]").innerText);
  check("result: a level and an in-band share", /Your pitch level: about \d+ Hz \([A-G]#?\d\)\./.test(lines) && /In the band \d+ % of the time you were speaking\./.test(lines), lines.replace(/\n/g, " / "));
  await clickSel(page, '[data-feel-answer="easy"]');
  await sleep(400);
  const reply = await page.evaluate(() => document.querySelector("[data-feel-reply]").textContent);
  check("the feel answer saves", reply === "Saved.", reply);
  await page.screenshot({ path: path.join(OUT, `${v}-flow-P6-result.png`) });
  await clickSel(page, "[data-card-next]"); // "Lessons" on the result card
  await page.waitForSelector("[data-exercises-list]", { timeout: 10000 });
  await sleep(400);
  const p6Done = await page.evaluate(() => document.querySelector('[data-lesson="P6"] [data-last-done]').textContent);
  check("the list: \"Last done: today\"", p6Done === "Last done: today", p6Done);
  const rows1 = await savedRows(page);
  check("one saved row for the run, with its feel and a measured level, no audio",
    rows1?.length === 1 && rows1[0].exerciseId === "P6" && rows1[0].feel === "easy" && Number.isFinite(rows1[0].results?.levelHz)
      && Object.keys(rows1[0]).sort().join() === "direction,endedAt,exerciseId,feel,id,results,sessionId,startedAt",
    JSON.stringify(rows1));
  // a second run shows "Last time"
  await openLesson(page, "P6");
  await goToCard(page, "Count to ten");
  await sleep(5000);
  // the frame tap goes with the card: on the next card nothing more is counted for this one
  await goToCard(page, "Short phrases");
  const tapAway = await page.evaluate(() => +document.querySelector("[data-voice-so-far]")?.dataset.voiceSoFar);
  await sleep(2500);
  const tapAway2 = await page.evaluate(() => +document.querySelector("[data-voice-so-far]")?.dataset.voiceSoFar);
  check("Short phrases counts its own voice (a fresh log, the tap moved with the card)", tapAway < 1 && tapAway2 > tapAway, `${tapAway} → ${tapAway2}`);
  await goToCard(page, "How did it go?");
  await sleep(800);
  const lines2 = await page.evaluate(() => document.querySelector("[data-result-lines]").innerText);
  check("a second run shows \"Last time\"", /Last time: about \d+ Hz, \d+ % in the band\./.test(lines2), lines2.replace(/\n/g, " / "));
  await clickSel(page, '[data-feel-answer="strained"]');
  await sleep(300);
  const cool = await page.$("[data-cool-down]");
  check("Strained: the cool-down is offered, no next lesson", !!cool && !(await page.$("[data-next-lesson]")));
  await clickSel(page, "[data-cool-down]");
  await page.waitForSelector('[data-lesson-player="W2"]', { timeout: 10000 });
  const rows2 = await savedRows(page);
  check("…and opens it; two runs = exactly two saved rows, the second strained",
    rows2?.length === 2 && rows2.filter((r) => r.feel === "strained").length === 1, JSON.stringify(rows2?.map((r) => r.feel)));

  // Tongue and lips: two takes
  await openLesson(page, "R3");
  await goToCard(page, "Bright");
  await clickSel(page, '[data-take="bright"] [data-take-record]');
  await sleep(2500);
  await clickSel(page, '[data-take="bright"] [data-take-stop]');
  await sleep(300);
  await goToCard(page, "Dark");
  await clickSel(page, '[data-take="dark"] [data-take-record]');
  await sleep(2500);
  await clickSel(page, '[data-take="dark"] [data-take-stop]');
  await sleep(300);
  await goToCard(page, "Compare");
  const plays = await page.evaluate(() => [...document.querySelectorAll("[data-compare] [data-play]")].map((b) => ({ name: b.dataset.play, disabled: b.disabled })));
  check("Compare: both takes playable", plays.length === 2 && plays.every((p) => !p.disabled), JSON.stringify(plays));
  await clickSel(page, '[data-compare] [data-play="bright"]');
  await sleep(300);
  const pressed = await page.evaluate(() => document.querySelector('[data-compare] [data-play="bright"]').getAttribute("aria-pressed"));
  check("Play: the take plays (aria-pressed)", pressed === "true", pressed);

  // Hear it first
  await openLesson(page, "R4");
  await goToCard(page, "Record your usual voice");
  await page.waitForFunction(() => { const b = document.querySelector("[data-hear-record]"); return b && !b.disabled; }, { timeout: 60000 });
  await clickSel(page, "[data-hear-record]");
  await page.waitForSelector("[data-hear-stop]", { timeout: 10000 });
  await sleep(4500);
  await clickSel(page, "[data-hear-stop]");
  await page.waitForSelector('[data-hear-phase="preview"]', { timeout: 60000 }).catch(() => {});
  const phase = await page.evaluate(() => document.querySelector("[data-hear-phase]")?.dataset.hearPhase);
  check("Hear it first: the recording is analysed", phase === "preview", phase);
  await goToCard(page, "Listen");
  await page.waitForFunction(() => { const b = document.querySelector('[data-play="hear-10"]'); return b && !b.disabled; }, { timeout: 60000 }).catch(() => {});
  const hearBtns = await page.evaluate(() => [...document.querySelectorAll("[data-hear-versions] [data-play]")].map((b) => `${b.dataset.play}:${b.disabled ? "off" : "on"}`));
  check("Listen: your recording and the brighter version (feminine) are playable", hearBtns.join() === "hear-original:on,hear-10:on", hearBtns.join());
  await clickSel(page, '[data-play="hear-10"]');
  await sleep(300);
  check("…and the brighter version plays", (await page.evaluate(() => document.querySelector('[data-play="hear-10"]').getAttribute("aria-pressed"))) === "true");
  await page.screenshot({ path: path.join(OUT, `${v}-flow-R4-listen.png`) });
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- run

await startStatic();
try {
  for (const v of VIEWPORT_LIST) {
    if (PARTS.has("tabs")) await partTabs(v);
  }
  if (PARTS.has("idle")) await partIdle(VIEWPORT_LIST[0]);
  for (const v of VIEWPORT_LIST) {
    if (PARTS.has("cards")) await partCards(v);
  }
  if (PARTS.has("flow")) await partFlow(VIEWPORT_LIST[0]);
} finally {
  if (browser) await browser.close().catch(() => {});
  cleanup();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? `  (${f.detail})` : ""}`);
process.exit(failed.length ? 1 : 0);
