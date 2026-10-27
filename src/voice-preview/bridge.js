// bridge.js — Voice Shaper's only module in the main bundle (App.jsx adds the tab, its
// lazy import and error boundary): the capture handle
// useAudioPipeline registers while listening, and the posted-pitch tap it calls at the
// end of handlePitchMessage. No imports; nothing happens while no tap is installed.
// The lazily loaded voice-preview controller uses both during a recording
// (measurements/voice-preview-phase1-2026-10-19.md §2, §3).
//
// Capture handle (null while not listening):
//   { sampleRate, connect() -> MessagePort (a new capture consumer: every ~25 ms chunk
//     { buffer, contextTime }), disconnect(port), startedAt (performance.now() ms when
//     listening started) }

let capture = null;
const captureListeners = new Set();
const taps = new Set(); // posted-pitch taps (Voice Shaper's tab and the exercises' "Hear it first" can both record)

/** useAudioPipeline: the handle when listening starts, null when it stops. */
export function setVoicePreviewCapture(handle) {
  capture = handle;
  for (const fn of captureListeners) {
    try { fn(handle); } catch (err) { console.error("Voice Shaper capture listener", err); }
  }
}

export const getVoicePreviewCapture = () => capture;

/** Subscribe to handle changes; returns the unsubscribe function. */
export function onVoicePreviewCapture(fn) {
  captureListeners.add(fn);
  return () => captureListeners.delete(fn);
}

/** Replace every posted-pitch tap with fn (or remove them all: null). */
export function setVoicePreviewPitchTap(fn) {
  taps.clear();
  if (typeof fn === "function") taps.add(fn);
}

/** Add one posted-pitch tap beside any others; returns the function that removes just that one. */
export function addVoicePreviewPitchTap(fn) {
  taps.add(fn);
  return () => { taps.delete(fn); };
}

/** useAudioPipeline.handlePitchMessage, last: hands the posted message to the tap, if any. */
export function voicePreviewPitchTap(msg) {
  if (taps.size === 0) return;
  for (const fn of taps) {
    try { fn(msg); } catch (err) { console.error("Voice Shaper pitch tap", err); }
  }
}
