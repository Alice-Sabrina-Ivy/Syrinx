// session-data.js — Location of the private session recordings.
//
// The user's practice-session recordings (and their label files) are
// private and local-only: never committed, never hard-coded. Scripts reach
// them through the SYRINX_SESSIONS_DIR environment variable (see CLAUDE.md
// "Private session data"). Resolution is lazy — importing this module never
// throws; a script fails, with the message below, only at the point where it
// actually needs a session file.

const HINT = "set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)";

/** Sessions root with forward slashes and no trailing slash. */
export function sessionsDir() {
  const dir = process.env.SYRINX_SESSIONS_DIR;
  if (!dir) throw new Error(HINT);
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Absolute forward-slash path of `rel` under the sessions root — the same
 * spelling the build/pitch-compare/praat-contours.json `path` keys use.
 */
export function sessionPath(rel) {
  return `${sessionsDir()}/${rel}`;
}
