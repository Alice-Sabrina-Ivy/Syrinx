// workflow-paths-test.js — the CI and deploy workflows' `paths` filters keep
// THIRD_PARTY_NOTICES.md after the '!**/*.md' exclusion. GitHub applies the
// patterns in order and the last match wins, so moving the notices line
// above the exclusion would silently skip runs that change only the notices
// (the build regenerates it and two unit tests read it). 2026-10-19 review
// F3F7-4.
//
// Run: node tests/site/workflow-paths-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

// Every `paths:` list in a workflow file, as arrays of unquoted patterns.
function pathLists(text) {
  const lines = text.split(/\r?\n/);
  const lists = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)paths:\s*$/.exec(lines[i]);
    if (!m) continue;
    const list = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*(.+?)\s*$/.exec(lines[j]);
      if (!item) break;
      list.push(item[1].replace(/^(['"])(.*)\1$/, "$2"));
    }
    lists.push(list);
  }
  return lists;
}

for (const file of ["ci.yml", "deploy.yml"]) {
  console.log(file);
  const lists = pathLists(readFileSync(path.join(REPO, ".github/workflows", file), "utf8"));
  check("has a paths filter", lists.length > 0);
  for (const list of lists) {
    const md = list.indexOf("!**/*.md");
    const notices = list.indexOf("THIRD_PARTY_NOTICES.md");
    check("'**' comes first", list[0] === "**", list.join(", "));
    check("measurements and Markdown are excluded", list.includes("!measurements/**") && md >= 0, list.join(", "));
    check("THIRD_PARTY_NOTICES.md comes after '!**/*.md' (last match wins)", notices > md && md >= 0, list.join(", "));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
