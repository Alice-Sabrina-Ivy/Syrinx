// lessons-test.js — the guided exercises' text (src/exercises/lessons.js) and the tab's
// wiring in App.jsx. docs/guided-exercises-design.md §2, §5, §6.
//   - Every lesson resolves to text for every training direction (and for no goal yet,
//     which uses the "Just exploring" text): a title, a purpose, a body on every card,
//     no unresolved {placeholders}, no empty strings.
//   - No verdict, score or streak words anywhere; no gender words except the citation of
//     the one study's participants ("trans women", R3's feminine text).
//   - Every lesson that uses the voice shows the standard safety line before its steps,
//     and "Just exploring" never gets a target or an aim.
//   - The direction-specific lines exist where the design says the aim differs.
//   - App.jsx: the tab between Dashboard and Pitch, its texts equal UI.tab / UI.loading /
//     UI.loadError, the view a lazy import, and exercises/bridge.js without imports.
//
//   node tests/exercises/lessons-test.js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LESSONS, GROUPS, LESSON_ORDER, UI, SAFETY, SENTENCE, DIRECTIONS, forDir, cardsFor, takesFor,
  hearShifts, lastDoneText, PRACTICE, nextLessonAfter,
} from "../../src/exercises/lessons.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const DIRS = [...DIRECTIONS, null];

// every string a lesson can show, per direction
function lessonStrings(lesson, dir) {
  const out = [];
  const push = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach(push);
    else out.push(String(v));
  };
  push(forDir(lesson.title, dir));
  push(forDir(lesson.purpose, dir));
  for (const c of cardsFor(lesson, dir)) {
    push(forDir(c.title, dir));
    push(forDir(c.body, dir));
    push(forDir(c.list, dir));
    push(forDir(c.after, dir));
    push(forDir(c.safety, dir));
    push(forDir(c.troubleshooting, dir));
    push(forDir(c.feel, dir));
    push(forDir(c.phrases, dir));
    for (const d of c.drawings ?? []) { push(d.caption); push(d.alt); }
    if (c.reps) push(forDir(c.reps.label, dir));
    if (c.timer) push(c.timer.label);
    for (const t of c.takes ?? []) push(t.label);
  }
  push(lesson.result?.done);
  return out;
}
const uiStrings = [];
(function walk(v) {
  if (typeof v === "string") uiStrings.push(v);
  else if (typeof v === "function") {
    for (const args of [[1, 2], [172, "F3"], [64], ["Big dog"], [3.2]]) {
      try { const r = v(...args); if (typeof r === "string") uiStrings.push(r); } catch { /* other arity */ }
    }
  } else if (v && typeof v === "object") Object.values(v).forEach(walk);
})(UI);

const VERDICT = /\b(score[sd]?|rating|grade[sd]?|pass(ed|es)?|fail(ed|s|ure)?|streaks?|perfect)\b/i;
const GENDER = /\b(male|female|man|men|woman|women|boy|girl|lady|guy|gender\w*)\b/i;
const ALLOWED_GENDER = /ten trans women practised/;

console.log("lessons, every direction");
let before = failed;
for (const id of LESSON_ORDER) {
  const L = LESSONS[id];
  for (const dir of DIRS) {
    const strs = lessonStrings(L, dir);
    const tag = `${id} / ${dir ?? "no goal"}`;
    const title = forDir(L.title, dir), purpose = forDir(L.purpose, dir);
    const cards = cardsFor(L, dir);
    const empty = cards.filter((c) => forDir(c.body ?? [], dir).length === 0 && forDir(c.list ?? [], dir).length === 0);
    const badDrawing = cards.flatMap((c) => c.drawings ?? []).filter((d) => !d.id || !d.caption || !d.alt);
    if (badDrawing.length) check(`${tag}: every drawing has an id, a caption and alt text`, false, JSON.stringify(badDrawing[0]));
    if (!title || !purpose || empty.length || strs.some((x) => !x.trim())) {
      check(`${tag}: title, purpose and a body on every card`, false, empty.map((c) => c.title ?? c.kind).join(", "));
    }
    const bad = strs.filter((x) => VERDICT.test(x) || (GENDER.test(x) && !ALLOWED_GENDER.test(x)));
    if (bad.length) check(`${tag}: no verdict / score / gender words`, false, bad[0]);
    const braces = strs.filter((x) => /\{(?!band\})[^}]*\}/.test(x));
    if (braces.length) check(`${tag}: no unknown placeholders`, false, braces[0]);
  }
}
check("every lesson resolves for every direction and for no goal yet (no failures above)", failed === before);

console.log("\nthe tab's own strings");
const badUi = uiStrings.filter((x) => VERDICT.test(x) || GENDER.test(x));
check("UI strings: no verdict / score / gender words", badUi.length === 0, badUi[0]);

console.log("\nsafety and aims");
before = failed;
for (const id of LESSON_ORDER) {
  const L = LESSONS[id];
  if (!L.usesVoice) continue;
  for (const dir of DIRS) {
    const cards = cardsFor(L, dir);
    const firstStep = cards.findIndex((c) => ["live", "record", "hear"].includes(c.kind) || (c.kind === "text" && c.title && !/Get ready/.test(forDir(c.title, dir))));
    const safetyAt = cards.findIndex((c) => (forDir(c.safety, dir) ?? []).includes(SAFETY));
    if (safetyAt < 0 || (firstStep >= 0 && safetyAt > firstStep)) {
      check(`${id} / ${dir ?? "no goal"}: the standard safety line comes before the steps`, false, `safety ${safetyAt}, first step ${firstStep}`);
    }
  }
}
check("every lesson that uses the voice shows the standard safety line before its steps", failed === before);
// the check above keys on usesVoice: a lesson whose cards use the voice must say so
check("every lesson with a live, record or hear card is marked usesVoice", LESSON_ORDER.every((id) =>
  LESSONS[id].usesVoice || !LESSONS[id].cards.some((c) => ["live", "record", "hear"].includes(c.kind))));
for (const id of ["P5", "P6"]) {
  const exploring = lessonStrings(LESSONS[id], "exploring").join(" ");
  check(`${id} for "Just exploring": no band and no target`, !/\bband\b(?!.*there's no band)/i.test(exploring.replace("there's no band", "")) && !/{band}/.test(exploring) && !/your target/i.test(exploring.replace("Glide to your target", "")), exploring.slice(0, 120));
}
{
  const f = lessonStrings(LESSONS.P5, "feminine").join(" "), m = lessonStrings(LESSONS.P5, "masculine").join(" ");
  check("P5: the feminine text slides up into the band, the masculine one down", /slide slowly up until the line is inside the band/.test(f) && /slide slowly down until the line is inside the band/.test(m));
  check("P5: the masculine text warns against pressing down and creaky voice", /Don't press down, tuck your chin, or drop into a creaky voice/.test(m));
  check("P5: the targets say to stop short when the band is work", /stop short of it/.test(f) && /stop short of it/.test(m));
}
{
  const a = lessonStrings(LESSONS.P6, "androgynous").join(" ");
  check("P6 androgynous: the narrow band is disclosed (about two-thirds)", /about two-thirds of the time/.test(a));
}
{
  const andro = cardsFor(LESSONS.R3, "androgynous"), fem = cardsFor(LESSONS.R3, "feminine");
  check("R3: androgynous gets an \"In between\" take; feminine doesn't", takesFor(LESSONS.R3, "androgynous").map((t) => t.id).join() === "bright,dark,middle"
    && takesFor(LESSONS.R3, "feminine").map((t) => t.id).join() === "bright,dark" && andro.length === fem.length + 1);
  check("R3 and R4 use the all-voiced sentence", lessonStrings(LESSONS.R3, "feminine").some((x) => x.includes(SENTENCE)) && lessonStrings(LESSONS.R4, "masculine").some((x) => x.includes(SENTENCE)));
}
check("R4 shifts: brighter for feminine, darker for masculine, both otherwise",
  hearShifts("feminine").join() === "10" && hearShifts("masculine").join() === "-10" && hearShifts("androgynous").join() === "10,-10"
  && hearShifts("exploring").join() === "10,-10" && hearShifts(null).join() === "10,-10");
check("every lesson is in exactly one group, in the list order", GROUPS.flatMap((g) => g.lessons).join() === LESSON_ORDER.join()
  && new Set(LESSON_ORDER).size === LESSON_ORDER.length && LESSON_ORDER.every((id) => LESSONS[id]?.id === id));
check("the first version's lessons (no new measurement needed)", LESSON_ORDER.join() === "S1,W1,W2,P5,P6,R1,R2,R3,R4");
check("only P6 measures", LESSON_ORDER.filter((id) => LESSONS[id].measures).join() === "P6"
  && LESSON_ORDER.every((id) => cardsFor(LESSONS[id], "feminine").every((c) => !c.live?.measure || LESSONS[id].measures)));

console.log("\nlesson order and the cool-down (Juni comparison fixes, 2026-10-27)");
check("Next: safety -> warm-up -> first practice lesson -> each practice lesson in turn; nothing after the cool-down or the last one",
  nextLessonAfter("S1") === "W1" && nextLessonAfter("W1") === PRACTICE[0] && nextLessonAfter("W2") === null
  && PRACTICE.every((id, i) => nextLessonAfter(id) === (PRACTICE[i + 1] ?? null)));
check("the warm-up never leads straight into the cool-down", nextLessonAfter("W1") !== "W2" && !PRACTICE.includes("W1") && !PRACTICE.includes("W2"));
{
  const live = cardsFor(LESSONS.W2, "feminine").filter((c) => c.kind === "live");
  check("the cool-down's live card is neutral (no band, never judged) and optional", live.length === 1 && live[0].live.neutral === true && live[0].live.optional === true);
  const pitchLive = ["P5", "P6"].flatMap((id) => cardsFor(LESSONS[id], "feminine").filter((c) => c.kind === "live"));
  check("the pitch lessons' live cards keep the band", pitchLive.length === 4 && pitchLive.every((c) => !c.live.neutral));
}
{
  const c = cardsFor(LESSONS.S1, "feminine").find((x) => x.list);
  check("S1: the stop signs come right under their heading (the rest after the list)", c && !c.body && Array.isArray(c.after) && c.after.length > 0);
}

console.log("\nthe ideas from the Juni decompile check (2026-10-27)");
{
  const w1 = cardsFor(LESSONS.W1, "feminine");
  const ready = w1.find((c) => forDir(c.title, "feminine") === "Get ready");
  check("W1: how it should feel comes on Get ready, before the steps", ready && forDir(ready.feel, "feminine").length === 1
    && w1.indexOf(ready) < w1.findIndex((c) => c.timer));
  const hum = w1.find((c) => c.timer);
  check("W1: a hold timer for the five hums (up to 5 s each), a counter for the five slides", hum?.timer.reps === 5 && hum.timer.seconds === 5
    && w1.some((c) => c.reps?.count === 5 && c.reps.label === "Slide"));
  check("W2: a counter for the five sighs", cardsFor(LESSONS.W2, "feminine").some((c) => c.kind === "live" && c.reps?.count === 5));
  for (const dir of DIRS) {
    const live = cardsFor(LESSONS.P5, dir).filter((c) => c.kind === "live");
    const counts = live.map((c) => forDir(c.reps?.count, dir));
    if (!(live.length === 2 && live.every((c) => c.live.judge === false && c.live.steadiness) && counts.every((n) => n >= 2))) {
      check(`P5 / ${dir ?? "no goal"}: neutral glide cards with steadiness and a counter`, false, counts.join());
    }
  }
  check("P5: three slides, four for androgynous (twice up, twice down)", forDir(cardsFor(LESSONS.P5, "feminine").find((c) => c.kind === "live").reps.count, "feminine") === 3
    && forDir(cardsFor(LESSONS.P5, "androgynous").find((c) => c.kind === "live").reps.count, "androgynous") === 4);
  const phrases = cardsFor(LESSONS.P6, "feminine").find((c) => c.phrases);
  check("P6: the phrases are shown one at a time (a phrases card, no bulleted list)", phrases?.phrases.length === 5 && !phrases.list && phrases.live?.measure === "count");
  const idx = (L, dir, pred) => cardsFor(LESSONS[L], dir).findIndex(pred);
  for (const dir of DIRS) {
    const g3 = idx("R3", dir, (c) => c.kind === "guess"), cmp = idx("R3", dir, (c) => c.kind === "compare");
    const g4 = idx("R4", dir, (c) => c.kind === "guess"), listen = idx("R4", dir, (c) => c.stage === "listen"), tryAt = idx("R4", dir, (c) => c.compareWithHear);
    if (!(g3 === cmp + 1 && g4 === listen + 1 && tryAt === g4 + 1)) check(`R3 / R4 / ${dir ?? "no goal"}: the ear test after listening, before the try`, false, `${g3} ${cmp} ${g4} ${listen} ${tryAt}`);
  }
  const g3 = cardsFor(LESSONS.R3, "feminine").find((c) => c.kind === "guess");
  check("R3's ear test uses its bright and dark takes", g3.guess.takes.join() === "bright,dark" && g3.guess.takes.every((id) => takesFor(LESSONS.R3, "feminine").some((t) => t.id === id)));
  check("R4's ear test uses Voice Shaper's versions", cardsFor(LESSONS.R4, "feminine").find((c) => c.kind === "guess").guess.hear === true);
  const listenText = lessonStrings(LESSONS.R4, "feminine").join(" ");
  check("R4's listening compares the unchanged rebuild with the changed one", /Play the unchanged version, then the brighter one/.test(listenText) && /rebuilt from your recording in the same way/.test(listenText));
  const drawn = (L) => cardsFor(LESSONS[L], "feminine").flatMap((c) => (c.drawings ?? []).map((d) => d.id));
  check("drawings: W1 straw + lip buzz, R1 fingertips / up / down, R2 down / up, R3 bright / dark",
    drawn("W1").join() === "straw,lipBuzz" && drawn("R1").join() === "fingertips,boxUp,boxDown" && drawn("R2").join() === "boxDown,boxUp" && drawn("R3").join() === "bright,dark");
}

console.log("\nforDir");
check("string passes through", forDir("x", "feminine") === "x");
check("direction key, then target, then all", forDir({ masculine: "m", target: "t", all: "a" }, "masculine") === "m"
  && forDir({ target: "t", all: "a" }, "feminine") === "t" && forDir({ target: "t", all: "a" }, "exploring") === "a");
check("no goal = exploring", forDir({ exploring: "e", target: "t" }, null) === "e");
check("arrays drop entries with no text for the direction", JSON.stringify(forDir(["a", { masculine: "m" }], "feminine")) === '["a"]');

console.log("\nlast done");
const now = new Date(2026, 9, 26, 15, 0).getTime();
check("never", lastDoneText(undefined, now) === UI.notDone);
check("today / yesterday / days ago", lastDoneText(new Date(2026, 9, 26, 1, 0).getTime(), now) === "Last done: today"
  && lastDoneText(new Date(2026, 9, 25, 23, 0).getTime(), now) === "Last done: yesterday"
  && lastDoneText(new Date(2026, 9, 22, 9, 0).getTime(), now) === "Last done: 4 days ago");

console.log("\nApp.jsx");
const app = readFileSync(path.join(REPO, "src/App.jsx"), "utf8");
const tabsAt = app.indexOf("const TABS = [");
const tabs = [...app.slice(tabsAt, app.indexOf("];", tabsAt)).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
check(`tab "${UI.tab}" between Dashboard and Pitch`, tabs.join(" | ") === `Dashboard | ${UI.tab} | Pitch | History | Voice Shaper | Resonance lab`, tabs.join(" | "));
check("loading fallback = UI.loading", app.includes(`>${UI.loading}</p>`));
check("load-error fallback = UI.loadError", app.includes(`>${UI.loadError}</p>`));
check("the tab's module is a lazy import, never a static one", /lazy\(\(\) => import\("\.\/exercises\/ExercisesView\.jsx"\)\)/.test(app)
  && !/^import [^\n]*exercises\/(ExercisesView|lessons)/m.test(app));
const bridgeSrc = readFileSync(path.join(REPO, "src/exercises/bridge.js"), "utf8");
check("exercises/bridge.js (main bundle) has no imports", !/^\s*import\b/m.test(bridgeSrc));
const view = readFileSync(path.join(REPO, "src/exercises/ExercisesView.jsx"), "utf8");
const jsxText = [...view.matchAll(/>([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)</g)].map((m) => m[1].trim()).filter(Boolean);
check("the view renders no literal text of its own (all from lessons.js)", jsxText.length === 0, jsxText.slice(0, 3).join(" | "));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
