// heardAsSetting.js — persistence of the experimental "Likely heard as"
// panel's on/off setting. ON by default since 2026-10-25 (user decision: on
// and downloading automatically, no turn-on button; it was off by default
// before): missing, unreadable or blocked storage all mean on, and only a
// saved `false` (the user switched it off in Settings) means off. The Dexie
// `settings` row "default", field `heardAsEnabled` (non-indexed; no schema
// bump). Never imported from an export file (exportFormat.js
// mergeImportedSettings). Pure (pass db.settings); Node-testable.

import { SETTINGS_ROW_ID } from "./trainingDirection.js";

export const HEARD_AS_SETTING = "heardAsEnabled";
export const HEARD_AS_DEFAULT = true;

export async function loadHeardAsEnabled(settingsTable) {
  try {
    const row = await settingsTable.get(SETTINGS_ROW_ID);
    const v = row?.[HEARD_AS_SETTING];
    return typeof v === "boolean" ? v : HEARD_AS_DEFAULT;
  } catch {
    return HEARD_AS_DEFAULT;
  }
}

export async function saveHeardAsEnabled(settingsTable, on) {
  try {
    const now = Date.now();
    const updated = await settingsTable.update(SETTINGS_ROW_ID, { [HEARD_AS_SETTING]: !!on, updatedAt: now });
    if (!updated) {
      await settingsTable.put({ id: SETTINGS_ROW_ID, [HEARD_AS_SETTING]: !!on, createdAt: now, updatedAt: now });
    }
    return true;
  } catch {
    return false;
  }
}
