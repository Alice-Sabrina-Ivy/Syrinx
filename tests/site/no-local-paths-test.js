// no-local-paths-test.js — no tracked text file names a local Windows user
// profile (a drive-letter "Users" folder with an account name after it) or a
// Claude scratch folder under AppData/Local/Temp/claude. This repo is public:
// such a path publishes the account name and a session id. Cite local files
// with a placeholder instead ($SCRATCH/<file>, $SYRINX_SESSIONS_DIR/...).
//
// Lists files with `git ls-files`; skips binaries (a NUL byte in the first
// 8 KB) and files over 5 MB. Skips gracefully when git or the work tree is
// unavailable (e.g. a source archive).
//
//   node tests/site/no-local-paths-test.js

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_BYTES = 5 * 1024 * 1024;

// Generic patterns only — never a real account name. `<you>`, `$USER`,
// `%USERNAME%` and similar placeholders after "Users" are allowed.
const SEP = String.raw`[\\/]+`;
const PATTERNS = [
  { name: "Windows user-profile path",
    re: new RegExp(String.raw`(?:\b[A-Za-z]:|(?:^|[\s"'\x60(=])/(?:mnt/)?[A-Za-z])${SEP}Users${SEP}(?![<$%{])[A-Za-z0-9._ -]*[A-Za-z0-9]`, "i") },
  { name: "Claude scratch path",
    re: new RegExp(String.raw`AppData${SEP}Local${SEP}Temp${SEP}claude\b`, "i") },
];

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}
const hits = (text) => PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);

console.log("patterns");
// Built from pieces so this file never contains a matching path itself.
const U = "Us" + "ers", T = ["AppData", "Local", "Temp", "cla" + "ude"];
check("drive path, forward slashes", hits(`C:/${U}/someone/x.log`).length === 1);
check("drive path, backslashes", hits(`C:\\${U}\\someone\\x.log`).length === 1);
check("drive path, doubled backslashes (JSON)", hits(`"D:\\\\${U}\\\\some.one\\\\x"`).length === 1);
check("Git Bash path", hits(`see /c/${U}/someone/x`).length === 1);
check("WSL path", hits(`cd /mnt/c/${U}/someone`).length === 1);
check("Claude scratch path", hits(`x/${T.join("/")}/proj/x.log`).includes("Claude scratch path"));
check("placeholder account is allowed", hits(`C:/${U}/<you>/x`).length === 0 && hits(`C:\\${U}\\%USERNAME%\\x`).length === 0);
check("URL path segment is allowed", hits(`https://example.org/api/${U}/42`).length === 0);
check("placeholder path is allowed", hits("$SCRATCH/warning-late-panel-hashes.log").length === 0);

console.log("\ntracked files");
const ls = spawnSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (ls.error || ls.status !== 0) {
  console.log(`  SKIP git ls-files unavailable (${ls.error?.code ?? `exit ${ls.status}`})`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
const files = ls.stdout.split("\0").filter(Boolean);
let scanned = 0, skipped = 0;
const found = [];
for (const f of files) {
  const p = path.join(repo, f);
  let buf;
  try {
    if (statSync(p).size > MAX_BYTES) { skipped++; continue; }
    buf = readFileSync(p);
  } catch { skipped++; continue; } // deleted in the work tree, or a broken link
  if (buf.subarray(0, 8192).includes(0)) { skipped++; continue; }
  scanned++;
  const lines = buf.toString("utf8").split("\n");
  lines.forEach((line, i) => {
    for (const name of hits(line)) found.push(`${f}:${i + 1}: ${name}`);
  });
}
for (const h of found.slice(0, 50)) console.log(`    ${h}`);
check("no local user-profile or Claude scratch path in tracked text files", found.length === 0,
  `${scanned} files scanned, ${skipped} skipped, ${found.length} hit(s)`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
