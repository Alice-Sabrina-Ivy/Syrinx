// export-import-test.js — serialize/parse logic of the JSON data export
// (src/utils/exportFormat.js). Plain Node script: prints pass/fail per
// check, exits non-zero on failure.
//
//   node tests/data/export-import-test.js
//
// Covers the line layout (one frame record per line) written since
// 2026-10, the legacy single-line layout written before it, round-trip
// equality through a Blob assembled from parts (what DataManagement
// downloads), and malformed input.

import { deepStrictEqual } from "node:assert";
import {
  EXPORT_VERSION,
  exportHeader,
  createFrameSerializer,
  EXPORT_FOOTER,
  serializeExport,
  stripSessionForExport,
  isLineLayout,
  iterateExportRecords,
  parseExport,
} from "../../src/utils/exportFormat.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
function deepEq(a, b) {
  try { deepStrictEqual(a, b); return true; } catch { return false; }
}
function throwsMatching(fn, re) {
  try { fn(); } catch (err) { return re.test(err.message) ? true : `wrong error: ${err.message}`; }
  return "did not throw";
}
const enc = new TextEncoder();
const bytesOf = (parts) => enc.encode(parts.join(""));

// --- Fixture -------------------------------------------------------------
const settings = [{ id: "default", recordAudio: true, targetF0Low: 165, createdAt: 1, updatedAt: 2 }];
const sessionsRaw = [
  {
    id: 1, startedAt: 1700000000000, endedAt: 1700000060000, durationSeconds: 60,
    sessionType: "freeform", avgF0: 201.5, pitchRangeLow: null,
    // Newlines, quotes, backslashes, non-ASCII and a lone "]}" line inside
    // a string must not confuse the line layout.
    notes: 'line one\nline two "quoted" \\ back\r\n]}\n{"frames":[\n— ünïcödé ✓',
    audioBlob: { fake: "blob" },
  },
  { id: 7, startedAt: 1700000100000, sessionType: "freeform", notes: "" },
];
const frames = [];
for (let i = 0; i < 250; i++) {
  frames.push({
    id: i + 1, sessionId: i < 200 ? 1 : 7, timestampMs: i * 25,
    voiced: i % 3 !== 0, f0: i % 3 !== 0 ? 180 + (i % 40) / 3 : null,
    f1: 512.25, f2: i % 5 ? 1810.5 : null, f3: 2700, intensity: -31.5, spectralTilt: 4.2, hnr: 14.75,
  });
}
const exportedAt = "2026-10-03T12:00:00.000Z";
const sessions = sessionsRaw.map(stripSessionForExport);
const expected = { version: EXPORT_VERSION, exportedAt, settings, sessions, frames };

// --- 1. Line layout: shape -------------------------------------------------
{
  const parts = serializeExport({ exportedAt, settings, sessions, frames });
  const text = parts.join("");
  const lines = text.split("\n");
  check("stripSessionForExport drops audioBlob", !("audioBlob" in sessions[0]) && sessions[0].notes === sessionsRaw[0].notes);
  check("line layout is valid JSON with the v1 top-level schema", deepEq(JSON.parse(text), expected));
  check("line 1 is the header ending in \"frames\":[", lines[0].endsWith('"frames":[') && lines[0].startsWith('{"version":1,'));
  check("one frame record per line", lines.length === 1 + frames.length + 2 && lines.slice(1, 1 + frames.length).every((l) => l.startsWith("{")),
    `${lines.length} lines`);
  check("closing ]} on its own line", lines[lines.length - 2] === "]}" && lines[lines.length - 1] === "");
  check("isLineLayout detects it", isLineLayout(bytesOf(parts)));
}

// --- 2. Round trips ------------------------------------------------------------
{
  const parts = serializeExport({ exportedAt, settings, sessions, frames });
  check("line layout round-trips (parseExport)", deepEq(parseExport(bytesOf(parts)), expected));

  // Streaming writer pieces, as DataManagement uses them (frames emitted
  // per session, header/footer separate).
  const streamed = [exportHeader({ exportedAt, settings, sessions })];
  const line = createFrameSerializer();
  for (const s of sessions) for (const f of frames) if (f.sessionId === s.id) streamed.push(line(f));
  streamed.push(EXPORT_FOOTER);
  check("per-session streamed parts == serializeExport output", streamed.join("") === parts.join(""));

  // Header yields before any frame; frames arrive in order.
  const recs = [...iterateExportRecords(bytesOf(parts))];
  check("iterator yields header first, then every frame in order",
    recs[0].type === "header" && !("frames" in recs[0].header) && recs.length === frames.length + 1 &&
    recs.slice(1).every((r, i) => r.type === "frame" && r.frame.id === frames[i].id));

  // Zero frames.
  const empty = serializeExport({ exportedAt, settings: [], sessions: [], frames: [] });
  check("zero-frame export is valid JSON and round-trips",
    deepEq(JSON.parse(empty.join("")), { version: 1, exportedAt, settings: [], sessions: [], frames: [] }) &&
    deepEq(parseExport(bytesOf(empty)), { version: 1, exportedAt, settings: [], sessions: [], frames: [] }));

  // CRLF line endings (file re-saved on Windows).
  const crlf = enc.encode(parts.join("").replace(/\n/g, "\r\n"));
  check("CRLF line endings still parse", deepEq(parseExport(crlf), expected));
}

// --- 3. Legacy single-line exports --------------------------------------------
{
  const legacy = enc.encode(JSON.stringify(expected));
  check("legacy single-line export is not detected as line layout", !isLineLayout(legacy));
  check("legacy single-line export parses (JSON.parse fallback)", deepEq(parseExport(legacy), expected));
  const pretty = enc.encode(JSON.stringify(expected, null, 2));
  check("pretty-printed export parses (fallback)", !isLineLayout(pretty) && deepEq(parseExport(pretty), expected));
  const legacyNoSettings = enc.encode(JSON.stringify({ version: 1, sessions, frames }));
  check("legacy export without settings parses", deepEq(parseExport(legacyNoSettings), { version: 1, sessions, frames }));
}

// --- 4. Through a Blob built from parts (what the browser downloads) ----------
{
  const parts = serializeExport({ exportedAt, settings, sessions, frames });
  // Mimic DataManagement: some parts already folded into an inner Blob.
  const blob = new Blob([new Blob(parts.slice(0, 100)), ...parts.slice(100)], { type: "application/json" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  check("Blob-from-parts round-trips byte-exactly", new TextDecoder().decode(bytes) === parts.join("") && deepEq(parseExport(bytes), expected));
}

// --- 5. Malformed input --------------------------------------------------------------
{
  const good = serializeExport({ exportedAt, settings, sessions, frames }).join("");
  const lines = good.split("\n");
  const cases = [
    ["truncated (no closing ]})", lines.slice(0, 120).join("\n") + "\n", /truncated/i],
    ["truncated mid-record", good.slice(0, Math.floor(good.length / 2)), /Invalid frame record|truncated/i],
    ["garbage frame line", [...lines.slice(0, 5), "{not json},", ...lines.slice(5)].join("\n"), /line 6/],
    ["frame record that is not an object", [...lines.slice(0, 3), "42,", ...lines.slice(3)].join("\n"), /Invalid frame record on line 4/],
    ["missing comma between frames", [...lines.slice(0, 2), lines[2].slice(0, -1), ...lines.slice(3)].join("\n"), /Missing ","/],
    ["trailing comma before ]}", [...lines.slice(0, -3), lines[lines.length - 3] + ",", ...lines.slice(-2)].join("\n"), /Trailing ","/],
    ["content after the closing ]}", good + "{\"extra\":1}\n", /after end of export/],
    ["bad header line", "{\"version\":1,\"sessions\":[oops],\"frames\":[\n]}\n", /Invalid export header/],
    ["header missing sessions (line layout)", "{\"version\":1,\"settings\":[],\"frames\":[\n]}\n", /Invalid export file format/],
    ["not JSON at all", "hello world", /Not a valid JSON export/],
    ["empty file", "", /Not a valid JSON export/],
    ["legacy JSON missing frames", JSON.stringify({ version: 1, sessions: [] }), /Invalid export file format/],
    ["legacy JSON missing version", JSON.stringify({ sessions: [], frames: [] }), /Invalid export file format/],
    ["legacy JSON with non-object frame", JSON.stringify({ version: 1, sessions: [], frames: [null] }), /Invalid frame record at index 0/],
    ["settings not an array", JSON.stringify({ version: 1, settings: {}, sessions: [], frames: [] }), /Invalid export file format/],
  ];
  for (const [name, text, re] of cases) {
    const r = throwsMatching(() => parseExport(enc.encode(text)), re);
    check(`rejects: ${name}`, r === true, r === true ? "" : r);
  }
}

// --- 6. Scale: no giant string, linear time ---------------------------------------------
{
  const N = 300000;
  const big = new Array(N);
  for (let i = 0; i < N; i++) big[i] = { ...frames[i % frames.length], id: i + 1 };
  const t0 = Date.now();
  const lines = serializeExport({ exportedAt, settings, sessions, frames: big });
  // ~1 MB string chunks into the Blob, as DataManagement assembles it.
  const parts = [];
  let chunk = "";
  for (const l of lines) { chunk += l; if (chunk.length >= 1 << 20) { parts.push(chunk); chunk = ""; } }
  parts.push(chunk);
  const blob = new Blob(parts);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let count = 0, lastId = 0, ordered = true;
  for (const rec of iterateExportRecords(bytes)) {
    if (rec.type !== "frame") continue;
    count++;
    if (rec.frame.id !== lastId + 1) ordered = false;
    lastId = rec.frame.id;
  }
  check(`${N} frames: serialize → Blob → iterate`, count === N && ordered, `${Date.now() - t0} ms, ${(bytes.length / 1e6).toFixed(1)} MB`);
}

console.log(failures === 0 ? "\nAll export/import checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
