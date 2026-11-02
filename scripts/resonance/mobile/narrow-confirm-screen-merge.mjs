// narrow-confirm-screen-merge.mjs — copies the noise screen's class of every
// confirmation clip (screen-silero.mjs --set=fresh, plan §6) into the
// confirmation list, as screenClass / screenS / screenRuns (screenRunFrames,
// screenMaxP), and writes the class counts (screenCounts: per final class, per
// metadata family, per source, per subclass). Nothing else in the list changes.
//
//   node scripts/resonance/mobile/narrow-confirm-screen-merge.mjs
//        [--list=scripts/resonance/mobile/narrow-confirm-noise-list.json]
//        [--screen=scripts/resonance/mobile/narrow-confirm-screen.json]
//
// The screen file records the sha256 of the list it read; run the screen
// again (--replace) after a merge so the two match (the screen is
// deterministic: the same classes).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const listPath = path.resolve(repo, arg("list", "scripts/resonance/mobile/narrow-confirm-noise-list.json"));
const screenPath = path.resolve(repo, arg("screen", "scripts/resonance/mobile/narrow-confirm-screen.json"));
const L = JSON.parse(readFileSync(listPath, "utf8"));
const S = JSON.parse(readFileSync(screenPath, "utf8")).sets.fresh;
const by = new Map(S.clips.map((c) => [c.id, c]));
if (by.size !== L.clips.length || L.clips.some((c) => !by.has(c.id))) throw new Error("screen and list hold different clips");
for (const c of L.clips) {
  const s = by.get(c.id);
  if (s.family !== c.family) throw new Error(`${c.id}: family ${s.family} vs ${c.family}`);
  Object.assign(c, { screenClass: s.class, screenS: s.S, screenRunFrames: s.runFrames, screenMaxP: s.maxP, screenRuns: s.runs });
}
const count = (key) => {
  const o = {};
  for (const c of L.clips) { const k = key(c); o[k] ??= { "speech-free": 0, talker: 0 }; o[k][c.screenClass]++; }
  return o;
};
L.screenCounts = {
  total: count(() => "all").all,
  byFamily: count((c) => c.family),
  bySource: count((c) => c.source),
  bySubclass: count((c) => c.cls),
};
L.screen = { file: path.relative(repo, screenPath).replace(/\\/g, "/"), ranAt: S.ranAt, scriptSha256: S.scriptSha256 };
writeFileSync(listPath, JSON.stringify(L, null, 1));
console.log(JSON.stringify(L.screenCounts, null, 1));
