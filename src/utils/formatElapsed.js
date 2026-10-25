// m:ss for the practice dock's timer, the saved toast and History's
// "Recording now" card.
export function formatElapsed(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
