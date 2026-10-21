// voiceGateSetting.js — persistence of the TRY-OUT "Hide pitch when no voice
// is heard (experimental)" setting (branch noise-detector-tryout,
// 2026-10-20; measurements/noise-detector-tryout-2026-10-20.md). ON by
// default in this try-out: missing, unreadable or blocked storage all mean
// on. The Dexie `settings` row "default", field `voiceGateEnabled`
// (non-indexed; no schema bump). Never imported from an export file
// (exportFormat.js mergeImportedSettings). Pure (pass db.settings);
// Node-testable.

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
