// drawings-test.js — the guided exercises' line drawings (src/exercises/drawings.js).
//   - Every drawing the cards use exists, with the viewBox "0 0 160 120" (pairs line up).
//   - Every part is { kind, d } with a kind from DRAWING_KINDS; at least one accent part per
//     drawing, at most 40 parts.
//   - Every path parses, uses absolute commands only, and every x / y (control points and
//     arc end points included) lies inside the viewBox.
//   - No text or labels: no other fields, no <text> / <tspan> in the file.
//
//   node tests/exercises/drawings-test.js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRAWINGS, DRAWING_KINDS } from "../../src/exercises/drawings.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const IDS = ["straw", "lipBuzz", "fingertips", "boxUp", "boxDown", "bright", "dark"];
const W = 160, H = 120;

// parameters per command, and which of them are x / y coordinates
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
function coordsOf(cmd, args) {
  switch (cmd) {
    case "H": return [[args[0], null]];
    case "V": return [[null, args[0]]];
    case "A": return [[args[5], args[6]]];
    default: {
      const out = [];
      for (let i = 0; i < args.length; i += 2) out.push([args[i], args[i + 1]]);
      return out;
    }
  }
}

// returns { error } or { points: [[x|null, y|null], …] }
function parsePath(d) {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|\S/g) || [];
  const points = [];
  let i = 0;
  if (!/^[Mm]$/.test(tokens[0] || "")) return { error: "does not start with M" };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (!/^[A-Za-z]$/.test(cmd)) return { error: `unexpected token ${cmd}` };
    if (!(cmd in ARITY)) return { error: cmd === cmd.toLowerCase() && cmd.toUpperCase() in ARITY ? `relative command ${cmd}` : `unknown command ${cmd}` };
    const n = ARITY[cmd];
    const args = [];
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      const v = Number(tokens[i++]);
      if (!Number.isFinite(v)) return { error: `bad number after ${cmd}` };
      args.push(v);
    }
    if (n === 0) { if (args.length) return { error: "numbers after Z" }; continue; }
    if (args.length === 0 || args.length % n) return { error: `${cmd} takes multiples of ${n} numbers, got ${args.length}` };
    for (let k = 0; k < args.length; k += n) points.push(...coordsOf(cmd, args.slice(k, k + n)));
  }
  return { points };
}

check("DRAWING_KINDS is line / accent / ghost / accentFill",
  JSON.stringify(DRAWING_KINDS) === JSON.stringify(["line", "accent", "ghost", "accentFill"]));

for (const id of IDS) {
  const dr = DRAWINGS[id];
  check(`${id}: exists`, !!dr);
  if (!dr) continue;
  check(`${id}: only viewBox and parts`, JSON.stringify(Object.keys(dr).sort()) === '["parts","viewBox"]');
  check(`${id}: viewBox "0 0 160 120"`, dr.viewBox === "0 0 160 120", dr.viewBox);
  check(`${id}: 1–40 parts`, Array.isArray(dr.parts) && dr.parts.length >= 1 && dr.parts.length <= 40, String(dr.parts?.length));
  check(`${id}: at least one accent part`, dr.parts.some((p) => p.kind === "accent"));
  const bad = [];
  dr.parts.forEach((p, k) => {
    if (JSON.stringify(Object.keys(p).sort()) !== '["d","kind"]') bad.push(`part ${k}: fields ${Object.keys(p)}`);
    if (!DRAWING_KINDS.includes(p.kind)) bad.push(`part ${k}: kind ${p.kind}`);
    if (typeof p.d !== "string") { bad.push(`part ${k}: d not a string`); return; }
    const r = parsePath(p.d);
    if (r.error) { bad.push(`part ${k}: ${r.error}`); return; }
    for (const [x, y] of r.points) {
      if (x != null && !(x >= 0 && x <= W)) bad.push(`part ${k}: x ${x}`);
      if (y != null && !(y >= 0 && y <= H)) bad.push(`part ${k}: y ${y}`);
    }
  });
  check(`${id}: parts valid, absolute, inside the viewBox`, bad.length === 0, bad.slice(0, 5).join("; "));
}

const extra = Object.keys(DRAWINGS).filter((id) => !IDS.includes(id));
check("no unexpected drawings", extra.length === 0, extra.join(", "));
check("DRAWINGS frozen", Object.isFrozen(DRAWINGS) && Object.isFrozen(DRAWING_KINDS));

// the parser rejects what it should
check("parser rejects relative commands", !!parsePath("M 0 0 l 10 10").error);
check("parser rejects a wrong number count", !!parsePath("M 0 0 C 1 2 3 4 5").error);
check("parser reads arc end points only", JSON.stringify(parsePath("M 0 0 A 300 300 0 0 1 10 20").points) === "[[0,0],[10,20]]");

const src = readFileSync(path.join(REPO, "src/exercises/drawings.js"), "utf8");
check("no text in the drawings file", !/<\s*(text|tspan|title|desc)\b/i.test(src) && !/\b(label|text)\s*:/.test(src));
check("no imports, no JSX", !/^\s*import\b/m.test(src) && !/<[A-Za-z]/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
