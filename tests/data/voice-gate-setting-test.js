// voice-gate-setting-test.js — the try-out "Hide pitch when no voice is
// heard" setting (src/utils/voiceGateSetting.js): on by default in the
// try-out (missing / unreadable storage = on), saved values round-trip, and
// an imported export file never sets it (exportFormat.js).
//
//   node tests/data/voice-gate-setting-test.js

import { loadVoiceGateEnabled, saveVoiceGateEnabled, VOICE_GATE_SETTING } from "../../src/utils/voiceGateSetting.js";
import { mergeImportedSettings } from "../../src/utils/exportFormat.js";

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

check("no settings row: on", (await loadVoiceGateEnabled(table())) === true);
check("row without the field: on", (await loadVoiceGateEnabled(table({ default: { id: "default", recordAudio: true } }))) === true);
check("blocked storage: on", (await loadVoiceGateEnabled(broken)) === true);
{
  const t = table();
  check("save off on an empty table", (await saveVoiceGateEnabled(t, false)) === true && t.rows.default?.[VOICE_GATE_SETTING] === false);
  check("load returns off", (await loadVoiceGateEnabled(t)) === false);
  await saveVoiceGateEnabled(t, true);
  check("save on keeps other fields", (await loadVoiceGateEnabled(t)) === true && "createdAt" in t.rows.default);
}
check("save on blocked storage reports false", (await saveVoiceGateEnabled(broken, false)) === false);
{
  const merged = mergeImportedSettings({ id: "default" }, { id: "default", [VOICE_GATE_SETTING]: false, trainingDirection: "feminine" });
  check("an imported file never sets it", merged && !(VOICE_GATE_SETTING in merged) && merged.trainingDirection === "feminine", JSON.stringify(merged));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
