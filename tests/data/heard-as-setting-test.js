// heard-as-setting-test.js — src/utils/heardAsSetting.js: the experimental
// "Likely heard as" switch is ON by default (since 2026-10-25), keeps an
// explicit off, and survives blocked storage.
//
//   node tests/data/heard-as-setting-test.js

import { loadHeardAsEnabled, saveHeardAsEnabled, HEARD_AS_DEFAULT } from "../../src/utils/heardAsSetting.js";

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

check("the default is on", HEARD_AS_DEFAULT === true);
const t = table();
check("missing row -> on", (await loadHeardAsEnabled(t)) === true);
t.m.set("default", { id: "default", trainingDirection: "feminine" });
check("an existing row without the field -> on (users who never touched it get the new default)", (await loadHeardAsEnabled(t)) === true);
check("save off keeps the other settings", (await saveHeardAsEnabled(t, false)) === true
  && t.m.get("default").heardAsEnabled === false && t.m.get("default").trainingDirection === "feminine");
check("load -> off (an explicit off persists across a reload)", (await loadHeardAsEnabled(t)) === false);
check("save on", (await saveHeardAsEnabled(t, true)) === true && t.m.get("default").heardAsEnabled === true);
check("load -> on", (await loadHeardAsEnabled(t)) === true);
const fresh = table();
check("save off with no row creates the row", (await saveHeardAsEnabled(fresh, false)) === true && fresh.m.get("default").heardAsEnabled === false);
t.m.set("default", { id: "default", heardAsEnabled: "no" });
check("a non-boolean value is the default (on)", (await loadHeardAsEnabled(t)) === true);
check("blocked storage: load -> on (the default), no throw", (await loadHeardAsEnabled(blocked)) === true);
check("blocked storage: save -> false, no throw", (await saveHeardAsEnabled(blocked, false)) === false);
// A hung IndexedDB must not keep the app waiting: App races it against a timeout.
const raced = await Promise.race([loadHeardAsEnabled(hung), new Promise((r) => setTimeout(() => r("timeout"), 50))]);
check("hung storage: the caller's timeout wins (App keeps the default, on)", raced === "timeout");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
