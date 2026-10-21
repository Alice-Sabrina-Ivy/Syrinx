// oom-glue.mjs — test double for tests/voice-preview/worker-test.js: the committed
// WORLD glue, with malloc failing (returning 0, as dlmalloc does when memory cannot
// grow) for any request above globalThis.__vpFailMallocOver bytes.
import createVpWorld from "../../../src/voice-preview/wasm/vp_world.mjs";

export default async function createFailingVpWorld(opts) {
  const mod = await createVpWorld(opts);
  const malloc = mod._malloc;
  mod._malloc = (n) => (globalThis.__vpFailMallocOver && n > globalThis.__vpFailMallocOver ? 0 : malloc(n));
  return mod;
}
