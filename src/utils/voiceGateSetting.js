// voiceGateSetting.js — persistence of the "Hide pitch when no voice is heard
// (experimental)" setting (the voice gate: noise-detector try-out 2026-10-20,
// merged into cue-strip 2026-10-21; measurements/noise-detector-tryout-
// 2026-10-20.md), and the plain-words status line Settings shows for it. ON
// by default: missing, unreadable or blocked storage all mean on. The Dexie
// `settings` row "default", field `voiceGateEnabled` (non-indexed; no schema
// bump). Never imported from an export file (exportFormat.js
// mergeImportedSettings). Pure (pass db.settings); Node-testable.

import { SETTINGS_ROW_ID } from "./trainingDirection.js";

export const VOICE_GATE_SETTING = "voiceGateEnabled";
export const VOICE_GATE_DEFAULT = true;

export async function loadVoiceGateEnabled(settingsTable) {
  try {
    const row = await settingsTable.get(SETTINGS_ROW_ID);
    const v = row?.[VOICE_GATE_SETTING];
    return typeof v === "boolean" ? v : VOICE_GATE_DEFAULT;
  } catch {
    return VOICE_GATE_DEFAULT;
  }
}

export async function saveVoiceGateEnabled(settingsTable, on) {
  try {
    const now = Date.now();
    const updated = await settingsTable.update(SETTINGS_ROW_ID, { [VOICE_GATE_SETTING]: !!on, updatedAt: now });
    if (!updated) {
      await settingsTable.put({ id: SETTINGS_ROW_ID, [VOICE_GATE_SETTING]: !!on, createdAt: now, updatedAt: now });
    }
    return true;
  } catch {
    return false;
  }
}

const VOICE_GATE_UNAVAILABLE = "Off: the voice detector could not load, so pitch is shown as before.";

// Settings' status line for the voice gate. status: the detector's state
// while listening (useAudioPipeline voiceGateStatus: idle | loading | ready |
// unavailable | error | slow). probe (before the first listening session):
// "ok" / "unavailable" (the app's own model files checked), "mirror" (the
// Hugging Face mirror: fetched when listening starts), null (checking).
// Plain words only — no developer command; the technical reason is in the
// diag overlay (?diag=1).
export function voiceGateStatusText(status, probe = null) {
  switch (status) {
    case "ready": return "Voice detector running.";
    case "loading": return "Loading the voice detector…";
    case "unavailable": return VOICE_GATE_UNAVAILABLE;
    case "error": return "Off: the voice detector stopped with an error, so pitch is shown as before.";
    case "slow": return "Off for this session: the voice detector could not keep up on this device, so pitch is shown as before.";
    default:
      if (probe === "ok" || probe === "mirror") return "The voice detector starts when you start listening.";
      if (probe === "unavailable") return VOICE_GATE_UNAVAILABLE;
      return "Checking the voice detector…";
  }
}
