// bridge.js — the voice preview's only code in the main bundle: the capture handle
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
let tap = null;

/** useAudioPipeline: the handle when listening starts, null when it stops. */
export function setVoicePreviewCapture(handle) {
  capture = handle;
  for (const fn of captureListeners) {
    try { fn(handle); } catch (err) { console.error("voice preview capture listener", err); }
  }
}

export const getVoicePreviewCapture = () => capture;

/** Subscribe to handle changes; returns the unsubscribe function. */
export function onVoicePreviewCapture(fn) {
  captureListeners.add(fn);
  return () => captureListeners.delete(fn);
}

/** Install (fn) or remove (null) the posted-pitch tap. */
export function setVoicePreviewPitchTap(fn) {
  tap = typeof fn === "function" ? fn : null;
}

/** useAudioPipeline.handlePitchMessage, last: hands the posted message to the tap, if any. */
export function voicePreviewPitchTap(msg) {
  if (!tap) return;
  try { tap(msg); } catch (err) { console.error("voice preview pitch tap", err); }
}
