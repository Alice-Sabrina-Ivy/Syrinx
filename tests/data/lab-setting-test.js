// lab-setting-test.js — the "Show the Resonance lab (experimental)" setting
// (src/utils/labSetting.js, 2026-10-21): off by default (missing, unreadable
// or blocked storage = off, so existing users do not see the tab until they
// turn it on), saved values round-trip, an export carries it and an imported
// file never sets it (exportFormat.js mergeImportedSettings); and
// withdrawResonanceLab() (src/resonance-lab/labRequest.js) undoes a request
// and tells the listeners, so the hook stops a running lab.
//
//   node tests/data/lab-setting-test.js

import { loadLabEnabled, saveLabEnabled, LAB_SETTING } from "../../src/utils/labSetting.js";
import { mergeImportedSettings } from "../../src/utils/exportFormat.js";
import {
  requestResonanceLab, withdrawResonanceLab, isResonanceLabRequested, onResonanceLabRequested,
} from "../../src/resonance-lab/labRequest.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

function table(rows = {}) {
  return {
    rows,
    async get(id) { return rows[id]; },
    async update(id, patch) { if (!rows[id]) return 0; rows[id] = { ...rows[id], ...patch }; return 1; },
    async put(row) { rows[row.id] = row; },
  };
}
const broken = { get: async () => { throw new Error("blocked"); }, update: async () => { throw new Error("blocked"); }, put: async () => { throw new Error("blocked"); } };

check("the field is labEnabled", LAB_SETTING === "labEnabled");
check("no settings row: off", (await loadLabEnabled(table())) === false);
check("an existing user's row without the field: off", (await loadLabEnabled(table({ default: { id: "default", trainingDirection: "feminine", heardAsEnabled: true } }))) === false);
check("a non-boolean value: off", (await loadLabEnabled(table({ default: { id: "default", [LAB_SETTING]: "yes" } }))) === false);
check("blocked storage: off", (await loadLabEnabled(broken)) === false);
{
  const t = table({ default: { id: "default", trainingDirection: "masculine" } });
  check("save on", (await saveLabEnabled(t, true)) === true && t.rows.default[LAB_SETTING] === true);
  check("load returns on, other fields kept", (await loadLabEnabled(t)) === true && t.rows.default.trainingDirection === "masculine");
  await saveLabEnabled(t, false);
  check("save off", (await loadLabEnabled(t)) === false);
  const e = table();
  check("save on an empty table creates the row", (await saveLabEnabled(e, true)) === true && e.rows.default?.[LAB_SETTING] === true && "createdAt" in e.rows.default);
}
check("save on blocked storage reports false", (await saveLabEnabled(broken, true)) === false);
{
  const merged = mergeImportedSettings({ id: "default" }, { id: "default", [LAB_SETTING]: true, trainingDirection: "feminine" });
  check("an imported file never switches it on", merged && !(LAB_SETTING in merged) && merged.trainingDirection === "feminine", JSON.stringify(merged));
  const kept = mergeImportedSettings({ id: "default", [LAB_SETTING]: true }, { id: "default", [LAB_SETTING]: false });
  check("…nor off (the local value stays)", kept === null, JSON.stringify(kept));
}
{
  let calls = 0;
  const off = onResonanceLabRequested(() => { calls++; });
  check("not requested at first", isResonanceLabRequested() === false);
  withdrawResonanceLab();
  check("withdraw without a request: no call", calls === 0);
  requestResonanceLab();
  check("request: requested, listeners told", isResonanceLabRequested() === true && calls === 1);
  withdrawResonanceLab();
  check("withdraw: not requested, listeners told (the hook stops the lab)", isResonanceLabRequested() === false && calls === 2);
  requestResonanceLab();
  check("opening the tab again requests it again", isResonanceLabRequested() === true && calls === 3);
  off();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
