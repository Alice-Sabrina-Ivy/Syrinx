// flag.js — the ?resonance=lab URL flag (experimental resonance lab).
//
// This is the only resonance-lab code in the main bundle. Without the flag
// nothing else is fetched or run: the lab pipeline, worker and view are
// dynamically imported behind RESONANCE_LAB_ENABLED (same pattern as the
// ?diag=1 overlay), and no extra capture consumer is registered.

function readQuery() {
  if (typeof window === "undefined") return new URLSearchParams("");
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(""); }
}

export const RESONANCE_LAB_ENABLED = readQuery().get("resonance") === "lab";
