// heard-as-setting-test.js — src/utils/heardAsSetting.js: the experimental
// "Likely heard as" switch is off by default and survives blocked storage.
//
//   node tests/data/heard-as-setting-test.js

import { loadHeardAsEnabled, saveHeardAsEnabled } from "../../src/utils/heardAsSetting.js";

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name}`); }
}

// Dexie-like table backed by a Map (update resolves to the number of rows changed).
function table() {
  const m = new Map();
  return {
    m,
    async get(id) { return m.get(id); },
    async update(id, patch) { if (!m.has(id)) return 0; m.set(id, { ...m.get(id), ...patch }); return 1; },
    async put(row) { m.set(row.id, row); return row.id; },
  };
}
const blocked = {
  get: async () => { throw new Error("SecurityError: site data blocked"); },
  update: async () => { throw new Error("blocked"); },
  put: async () => { throw new Error("blocked"); },
};
const hung = { get: () => new Promise(() => {}) };

const t = table();
check("missing row -> off", (await loadHeardAsEnabled(t)) === false);
check("save on creates the row", (await saveHeardAsEnabled(t, true)) === true && t.m.get("default").heardAsEnabled === true);
check("load -> on (persists across a reload)", (await loadHeardAsEnabled(t)) === true);
t.m.set("default", { ...t.m.get("default"), trainingDirection: "feminine", recordAudio: true });
check("save off keeps the other settings", (await saveHeardAsEnabled(t, false)) === true
  && t.m.get("default").heardAsEnabled === false && t.m.get("default").trainingDirection === "feminine" && t.m.get("default").recordAudio === true);
check("load -> off", (await loadHeardAsEnabled(t)) === false);
t.m.set("default", { id: "default", heardAsEnabled: "yes" });
check("a non-boolean value is off", (await loadHeardAsEnabled(t)) === false);
check("blocked storage: load -> off, no throw", (await loadHeardAsEnabled(blocked)) === false);
check("blocked storage: save -> false, no throw", (await saveHeardAsEnabled(blocked, true)) === false);
// A hung IndexedDB must not keep the app waiting: App races it against a timeout.
const raced = await Promise.race([loadHeardAsEnabled(hung), new Promise((r) => setTimeout(() => r("timeout"), 50))]);
check("hung storage: the caller's timeout wins (App treats it as off)", raced === "timeout");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
