// heardAsSetting.js — persistence of the experimental "Likely heard as"
// panel's on/off setting. OFF by default: missing, unreadable or blocked
// storage all mean off. The Dexie `settings` row "default", field
// `heardAsEnabled` (non-indexed; no schema bump). Never imported from an
// export file (exportFormat.js mergeImportedSettings): an imported file must
// never switch an experiment on. Pure (pass db.settings); Node-testable.

import { SETTINGS_ROW_ID } from "./trainingDirection.js";

export const HEARD_AS_SETTING = "heardAsEnabled";

export async function loadHeardAsEnabled(settingsTable) {
  try {
    const row = await settingsTable.get(SETTINGS_ROW_ID);
    return row?.[HEARD_AS_SETTING] === true;
  } catch {
    return false;
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
