// labRequest.js — starts the resonance lab only for users who open its tab.
//
// The "Resonance lab" tab is visible to everyone, but its worker, models and
// extra capture consumer cost CPU and downloads, so nothing lab-related runs
// until the tab is first opened. LabView calls requestResonanceLab() on
// mount; useAudioPipeline starts the lab then (if listening) or at the next
// listening start, and keeps it running for the rest of the page visit so
// the readings survive tab switches. This tiny module is the only lab code
// in the main bundle; everything else is dynamically imported.

let requested = false;
const listeners = new Set();

export function requestResonanceLab() {
  if (requested) return;
  requested = true;
  for (const fn of listeners) fn();
}

export const isResonanceLabRequested = () => requested;

export function onResonanceLabRequested(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
