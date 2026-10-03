// exportFormat.js — Pure serialize/parse logic for the JSON data export.
// Kept free of Dexie / DOM so tests/data/export-import-test.js can run it
// in plain Node.
//
// Line layout (written since 2026-10). Still ONE valid JSON document with
// the version-1 top-level schema — any JSON.parse reads it — but laid out
// so neither side ever needs the whole file as one string:
//
//   {"version":1,"exportedAt":"…","settings":[…],"sessions":[…],"frames":[
//   {frame},
//   {frame}
//   ]}
//
// Line 1 is the header (everything before the frames array's first
// element), then exactly one frame record per line, then the closing
// "]}". JSON.stringify escapes every newline inside string values, so the
// only literal newlines in the file are the separators written here. The
// old single-string export hit V8's max string length (RangeError at
// ~2.58 M frames, ~18 h recorded) on both export (JSON.stringify) and
// import (file.text()).
//
// Older exports are a single JSON.stringify line; the parser detects the
// layout from line 1 and falls back to a whole-document JSON.parse.

export const EXPORT_VERSION = 1;

const FRAMES_OPEN = '"frames":[';
const FOOTER_LINE = "]}";
export const EXPORT_FOOTER = "\n" + FOOTER_LINE + "\n";

// Sessions carry an optional audioBlob, which JSON can't represent — the
// export has always dropped it.
export function stripSessionForExport(session) {
  // eslint-disable-next-line no-unused-vars
  const { audioBlob, ...rest } = session;
  return rest;
}

// Line 1: the top-level object up to and including the frames array's
// opening bracket. Key order matches the legacy export.
export function exportHeader({ exportedAt, settings, sessions }) {
  const head = JSON.stringify({
    version: EXPORT_VERSION,
    exportedAt,
    settings,
    sessions,
  });
  // head ends with "}" — reopen the object to append the frames array.
  return head.slice(0, -1) + "," + FRAMES_OPEN;
}

// Returns a function mapping each frame to its serialized line, including
// the separator owed to the previous record (so callers can stream frames
// without knowing which one is last).
export function createFrameSerializer() {
  let first = true;
  return (frame) => {
    const prefix = first ? "\n" : ",\n";
    first = false;
    return prefix + JSON.stringify(frame);
  };
}

// Whole export as an array of string parts (Blob-ready). For tests and
// small data; DataManagement streams the same pieces per session.
export function serializeExport({ exportedAt, settings, sessions, frames }) {
  const parts = [exportHeader({ exportedAt, settings, sessions })];
  const line = createFrameSerializer();
  for (const f of frames) parts.push(line(f));
  parts.push(EXPORT_FOOTER);
  return parts;
}

function assertHeader(data) {
  if (
    !data || typeof data !== "object" ||
    !data.version ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.frames) ||
    (data.settings != null && !Array.isArray(data.settings))
  ) {
    throw new Error("Invalid export file format");
  }
}

function assertFrame(frame, where) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new Error(`Invalid frame record ${where}`);
  }
}

const NL = 0x0a;
const CR = 0x0d;
const DECODE_CHUNK_BYTES = 1 << 20;

// Lines of bytes[start..] as strings. Decodes ~1 MB at a time, cut at a
// newline (UTF-8 never has 0x0a inside a multi-byte sequence, so the cuts
// are always on character boundaries), then splits — a decode call per
// line is several times slower on multi-million-line files.
function* linesAfter(bytes, start, decoder) {
  let pos = start;
  while (pos < bytes.length) {
    let end = Math.min(bytes.length, pos + DECODE_CHUNK_BYTES);
    if (end < bytes.length) {
      const lastNl = bytes.lastIndexOf(NL, end - 1);
      if (lastNl >= pos) {
        end = lastNl + 1;
      } else {
        // One line longer than the chunk: extend to its end.
        const next = bytes.indexOf(NL, end);
        end = next < 0 ? bytes.length : next + 1;
      }
    }
    const lines = decoder.decode(bytes.subarray(pos, end)).split("\n");
    // A chunk cut after a newline ends with "" — not a line of its own.
    if (end < bytes.length || lines[lines.length - 1] === "") lines.pop();
    yield* lines;
    pos = end;
  }
}

// Byte offset of the first "\n" (or -1), and whether the line before it
// ends with '"frames":[' — i.e. the file uses the line layout. Compared
// on bytes so a multi-hundred-MB legacy single-line file isn't decoded
// just to sniff it.
function sniffLineLayout(bytes) {
  const nl = bytes.indexOf(NL);
  if (nl < 0) return { lineLayout: false, nl };
  let end = nl;
  if (end > 0 && bytes[end - 1] === CR) end--;
  if (end < FRAMES_OPEN.length) return { lineLayout: false, nl };
  for (let i = 0; i < FRAMES_OPEN.length; i++) {
    if (bytes[end - FRAMES_OPEN.length + i] !== FRAMES_OPEN.charCodeAt(i)) {
      return { lineLayout: false, nl };
    }
  }
  return { lineLayout: true, nl };
}

export function isLineLayout(bytes) {
  return sniffLineLayout(bytes).lineLayout;
}

// Synchronous record iterator over the raw file bytes. Yields
//   { type: "header", header: { version, exportedAt, settings, sessions } }
// once, then { type: "frame", frame } per frame record, and throws on any
// malformed input (bad JSON, wrong schema, truncated file, trailing
// garbage). Synchronous on purpose: the importer runs it INSIDE an
// IndexedDB transaction, which auto-commits at the first await on
// anything that isn't an IndexedDB request — so the file is read up front
// as bytes and parsed here line by line, never as one giant string or one
// giant frames array.
export function* iterateExportRecords(bytes) {
  const decoder = new TextDecoder();
  const { lineLayout, nl } = sniffLineLayout(bytes);

  if (!lineLayout) {
    // Legacy single-line (or hand-reformatted) export: whole-document parse.
    let data;
    try {
      data = JSON.parse(decoder.decode(bytes));
    } catch (err) {
      throw new Error(`Not a valid JSON export (${err.message})`);
    }
    assertHeader(data);
    const { frames, ...header } = data;
    yield { type: "header", header };
    for (let i = 0; i < frames.length; i++) {
      assertFrame(frames[i], `at index ${i}`);
      yield { type: "frame", frame: frames[i] };
    }
    return;
  }

  let header;
  try {
    header = JSON.parse(decoder.decode(bytes.subarray(0, nl)) + FOOTER_LINE);
  } catch (err) {
    throw new Error(`Invalid export header (${err.message})`);
  }
  assertHeader(header);
  delete header.frames;
  yield { type: "header", header };

  let lineNo = 1;
  let closed = false;
  let sawFrame = false;
  let expectMore = true; // a frame line ending in "," promises another frame
  for (let line of linesAfter(bytes, nl + 1, decoder)) {
    lineNo++;
    line = line.trim();
    if (line === "") continue;
    if (closed) throw new Error(`Unexpected content after end of export (line ${lineNo})`);
    if (line === FOOTER_LINE) {
      if (sawFrame && expectMore) throw new Error(`Trailing "," before end of frames (line ${lineNo})`);
      closed = true;
      continue;
    }
    if (!expectMore) throw new Error(`Missing "," before line ${lineNo}`);
    sawFrame = true;
    expectMore = line.endsWith(",");
    if (expectMore) line = line.slice(0, -1);
    let frame;
    try {
      frame = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid frame record on line ${lineNo} (${err.message})`);
    }
    assertFrame(frame, `on line ${lineNo}`);
    yield { type: "frame", frame };
  }
  if (!closed) throw new Error("Export file is truncated (missing closing \"]}\")");
}

// Convenience: fully materialized parse (tests, small files).
export function parseExport(bytes) {
  let header = null;
  const frames = [];
  for (const rec of iterateExportRecords(bytes)) {
    if (rec.type === "header") header = rec.header;
    else frames.push(rec.frame);
  }
  return { ...header, frames };
}
