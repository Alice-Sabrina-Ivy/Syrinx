// bridge.js — the guided exercises' only module in the main bundle (App.jsx adds the
// tab, its lazy import and error boundary): a tap on the hook's per-frame record, the
// same object a session recording gets (useAudioPipeline's frame callback), for lessons
// that measure ("Count on your target"). No imports; nothing happens while no tap is
// installed. docs/guided-exercises-design.md §8.

let tap = null;

/** Install (fn) or remove (null) the frame tap. */
export function setExerciseFrameTap(fn) {
  tap = typeof fn === "function" ? fn : null;
}

export const hasExerciseFrameTap = () => tap !== null;

/** useAudioPipeline, beside the session recording's frame callback: hands the frame to the tap, if any. */
export function exerciseFrameTap(frame) {
  if (!tap) return;
  try { tap(frame); } catch (err) { console.error("Exercise frame tap", err); }
}
