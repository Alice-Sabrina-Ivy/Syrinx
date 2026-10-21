// labRequest.js — starts the resonance lab only for users who open its tab.
//
// The "Resonance lab" tab is shown only when Settings' "Show the Resonance lab
// (experimental)" is on (off by default since 2026-10-21, utils/labSetting.js).
// Its worker, models and extra capture consumer cost CPU and downloads, so
// nothing lab-related runs until the tab is first opened. LabView calls
// requestResonanceLab() on mount; useAudioPipeline starts the lab then (if
// listening) or at the next listening start, and keeps it running for the
// rest of the page visit so the readings survive tab switches — until the
// setting is turned off: withdrawResonanceLab() stops the running lab and it
// stays stopped until the tab is opened again. This tiny module is the only
// lab code in the main bundle; everything else is dynamically imported.

let requested = false;
const listeners = new Set();

export function requestResonanceLab() {
  if (requested) return;
  requested = true;
  for (const fn of listeners) fn();
}

/** The setting was turned off: stop the lab (if running) and do not start it again until the tab is opened. */
export function withdrawResonanceLab() {
  if (!requested) return;
  requested = false;
  for (const fn of listeners) fn();
}

export const isResonanceLabRequested = () => requested;

export function onResonanceLabRequested(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
