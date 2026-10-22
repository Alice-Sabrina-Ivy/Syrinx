// sessionRepair.js — Start-up repair for sessions that never finalized.
//
// Only the dashboard's finalize writes endedAt + summary stats, so a
// recording cut off by tab close, a crash, or a mobile tab discard stays
// in IndexedDB with endedAt == null and no stats forever (frames are
// flushed every ~1 s, so the data itself is mostly there). Once per app
// instance, rebuild those rows from their frames.
//
// Never touches a recording that may still be live:
//   - this tab: only sessions that STARTED before this module loaded are
//     candidates, and every recording in this tab starts after that;
//   - another open tab: each recording holds a Web Lock for its session
//     id (holdRecordingLock below); sessions whose lock is held are
//     skipped. Locks are released automatically when the owning tab
//     closes or crashes, which is exactly when repair becomes correct.
//     (Browsers without navigator.locks fall back to the start-time rule
//     alone.)

import db from "../db";
import { computeSummaryStats } from "./sessionStats";

const APP_STARTED_AT = Date.now();
const LOCK_PREFIX = "syrinx-recording-";

// Sessions recording in THIS tab right now (History labels only these
// "recording…"; an unfinalized row that isn't live — interrupted, or
// imported mid-recording — shows no duration until repaired).
const liveSessionIds = new Set();
export function isLiveSession(sessionId) {
  return liveSessionIds.has(sessionId);
}

// Hold the "recording in progress" lock for a session. Returns a release
// function (idempotent; safe to call before the lock is even granted).
export function holdRecordingLock(sessionId) {
  liveSessionIds.add(sessionId);
  let releaseLock = () => {};
  const release = () => {
    liveSessionIds.delete(sessionId);
    releaseLock();
  };
  if (typeof navigator === "undefined" || !navigator.locks?.request) return release;
  const held = new Promise((resolve) => { releaseLock = resolve; });
  navigator.locks
    .request(LOCK_PREFIX + sessionId, () => held)
    .catch(() => { /* locks unavailable (e.g. opaque origin) — best effort */ });
  return release;
}

let repairPromise = null;

// Idempotent per app instance (StrictMode double-invokes mount effects).
// Resolves to the number of sessions repaired; never rejects.
export function repairInterruptedSessions() {
  if (!repairPromise) {
    repairPromise = run().catch((err) => {
      console.warn("Session repair skipped:", err);
      return 0;
    });
  }
  return repairPromise;
}

async function run() {
  const candidates = await db.sessions
    .filter((s) => s.endedAt == null && typeof s.startedAt === "number" && s.startedAt < APP_STARTED_AT)
    .toArray();
  if (candidates.length === 0) return 0;

  let heldLocks = new Set();
  try {
    const snapshot = await navigator.locks?.query?.();
    heldLocks = new Set((snapshot?.held ?? []).map((l) => l.name));
  } catch { /* no Web Locks — start-time rule only */ }

  let repaired = 0;
  for (const session of candidates) {
    if (heldLocks.has(LOCK_PREFIX + session.id)) continue;
    const frames = await db.frames.where("sessionId").equals(session.id).toArray();
    let lastMs = 0;
    for (const f of frames) if (f.timestampMs > lastMs) lastMs = f.timestampMs;
    await db.sessions.update(session.id, {
      endedAt: session.startedAt + lastMs,
      durationSeconds: Math.round(lastMs / 1000),
      ...computeSummaryStats(frames, { directionLog: session.directionLog }),
    });
    repaired++;
  }
  return repaired;
}
