// clock.js — a manual clock for the fixed-input render checks
// (scripts/main-thread/visual-check.mjs). Imported first by each fixture:
// performance.now(), requestAnimationFrame and setInterval are driven by
// the test, so both trees draw the same frames at the same clock times.
const T0 = 1_760_000_000_000;
const fake = { epoch: T0, raf: [], nextId: 1, intervals: new Map() };
window.__fake = fake;
performance.now = () => fake.epoch - performance.timeOrigin;
window.requestAnimationFrame = (cb) => { const id = fake.nextId++; fake.raf.push({ id, cb }); return id; };
window.cancelAnimationFrame = (id) => { fake.raf = fake.raf.filter((e) => e.id !== id); };
// Run the callbacks queued so far (one frame).
window.__flush = () => {
  const q = fake.raf;
  fake.raf = [];
  for (const { cb } of q) cb(performance.now());
};
// setInterval: only the fixture's tick() fires them (cue strip's 250 ms tick).
const realSetInterval = window.setInterval.bind(window);
window.__realSetInterval = realSetInterval;
window.setInterval = (fn, ms) => { const id = fake.nextId++; fake.intervals.set(id, { fn, ms }); return id; };
window.clearInterval = (id) => { fake.intervals.delete(id); };
window.__runIntervals = (ms) => { for (const v of [...fake.intervals.values()]) if (v.ms === ms) v.fn(); };
