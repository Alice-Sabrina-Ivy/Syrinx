// session.js — the open lesson, kept outside React for the page visit: a tab switch, or
// the mic starting (App renders the tab in another branch then), keeps the position, the
// takes and the measured frames. Closing the lesson drops all of it (the takes, the
// player's AudioContext, "Hear it first"'s Voice Shaper worker).

import { createFrameLog } from "./results.js";
import { createTakePlayer } from "./takes.js";

const EMPTY = Object.freeze({
  lessonId: null,
  card: 0,
  startedAt: null,
  takes: {},        // takeId -> { pcm, rate, seconds }
  recording: null,  // { takeId, seconds } while a take is being recorded
  rowId: null,      // the saved exerciseResults row (once the result card was reached)
  result: null,     // what the result card computed (saved with the row)
  measuredFrames: 0, // how many frames the measuring cards logged when it was computed
  feel: null,
  hearReady: false, // "Hear it first"'s Voice Shaper wrapper is loaded
});

export function createLessonSession({ createPlayer = createTakePlayer } = {}) {
  let state = EMPTY;
  const listeners = new Set();
  let frameLogs = new Map(); // card index -> frame log
  let recorder = null;       // the running take recorder
  let hear = null;           // "Hear it first"'s Voice Shaper wrapper (R4 only)
  const player = createPlayer();

  function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function stopRecorder() {
    if (recorder) { const r = recorder; recorder = null; r.stop(); }
  }

  function teardown() {
    stopRecorder();
    player.close();
    frameLogs = new Map();
    if (hear) { hear.dispose(); hear = null; }
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState: () => state,
    player,

    open(lessonId, { now = Date.now() } = {}) {
      teardown();
      set({ ...EMPTY, lessonId, startedAt: now });
    },
    close() {
      teardown();
      set(EMPTY);
    },
    setCard(card) {
      if (card === state.card) return;
      stopRecorder();
      player.stop();
      // "Hear it first": leaving the card ends its recording (as Stop does)
      if (hear && hear.getState().phase === "recording") hear.stop();
      set({ card });
    },

    /** The frame log of a measuring card (created on first use). */
    frameLog(card) {
      let log = frameLogs.get(card);
      if (!log) { log = createFrameLog(); frameLogs.set(card, log); }
      return log;
    },
    /** Every measuring card's frames, in time order. */
    allFrames() {
      return [...frameLogs.values()].flatMap((l) => l.frames()).sort((a, b) => a.timestampMs - b.timestampMs);
    },

    /** Start recording a take with recordTake-like `start(onProgress, onDone)`; false if one is running. */
    startTake(takeId, start) {
      if (recorder) return false;
      player.stop();
      const r = start(
        (seconds) => { if (recorder === r) set({ recording: { takeId, seconds } }); },
        (take) => {
          if (recorder === r) recorder = null;
          const takes = take ? { ...state.takes, [takeId]: take } : state.takes;
          set({ takes, recording: null });
        },
      );
      if (!r) return false;
      recorder = r;
      set({ recording: { takeId, seconds: 0 } });
      return true;
    },
    stopTake() { stopRecorder(); },

    setHear(h) { hear = h; set({ hearReady: !!h }); },
    getHear: () => hear,

    setSaved(patch) { set(patch); },
  };
}
