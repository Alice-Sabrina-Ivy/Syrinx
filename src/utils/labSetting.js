// labSetting.js — persistence of the "Show the Resonance lab (experimental)"
// setting (2026-10-21). OFF by default, for everyone including existing
// users: missing, unreadable or blocked storage all mean off. While it is off
// the "Resonance lab" tab is not shown and nothing lab-related is fetched or
// run (resonance-lab/labRequest.js still starts the lab only once its tab is
// opened). The Dexie `settings` row "default", field `labEnabled`
// (non-indexed; no schema bump). Exported with the settings row, never
// imported from an export file (exportFormat.js mergeImportedSettings): an
// imported file must never switch an experiment on. Pure (pass db.settings);
// Node-testable.

import { SETTINGS_ROW_ID } from "./trainingDirection.js";

export const LAB_SETTING = "labEnabled";

export async function loadLabEnabled(settingsTable) {
  try {
    const row = await settingsTable.get(SETTINGS_ROW_ID);
    return row?.[LAB_SETTING] === true;
  } catch {
    return false;
  }
}

export async function saveLabEnabled(settingsTable, on) {
  try {
    const now = Date.now();
    const updated = await settingsTable.update(SETTINGS_ROW_ID, { [LAB_SETTING]: !!on, updatedAt: now });
    if (!updated) {
      await settingsTable.put({ id: SETTINGS_ROW_ID, [LAB_SETTING]: !!on, createdAt: now, updatedAt: now });
    }
    return true;
  } catch {
    return false;
  }
}
