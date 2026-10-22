// lab-pipeline-feed-test.js — stopping the resonance lab takes its capture
// feed off the capture source (src/resonance-lab/labPipeline.js).
//
// 2026-10-21 review: with the lab behind a Settings switch, turning it off
// while listening stopped only the lab worker; the extra capture consumer
// startLab had connected kept receiving a copied chunk 40 times a second
// until listening stopped, one more per off / on / open cycle. Checks that
// the number of feeds goes back to the starting count after every stop,
// including a restart (startLab stops the previous lab first) and a capture
// source without disconnectConsumer.
//
// Loads labPipeline.js in Node with a fake Worker and a load hook that gives
// it an import.meta.env.BASE_URL.
//
//   node tests/resonance-lab/lab-pipeline-feed-test.js

import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function load(url, ctx, next) {
  if (/\\/labPipeline\\.js(\\?|$)/.test(url)) {
    const src = readFileSync(fileURLToPath(url.split("?")[0]), "utf8").replaceAll("import.meta.env.BASE_URL", '"/Syrinx/"');
    return { format: "module", source: src, shortCircuit: true };
  }
  return next(url, ctx);
}`));

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

const workers = [];
globalThis.Worker = class {
  constructor(url) { this.url = String(url); this.terminated = false; workers.push(this); }
  postMessage() {}
  terminate() { this.terminated = true; }
};

// A capture source that counts its feeds like captureSource.js does.
function fakeSource({ withDisconnect = true } = {}) {
  const feeds = new Set();
  const src = {
    sampleRate: 48000,
    feeds,
    connectConsumer() { const port = { id: Symbol("port") }; feeds.add(port); return port; },
  };
  if (withDisconnect) src.disconnectConsumer = (port) => feeds.delete(port);
  return src;
}

const lab = await import(new URL("../../src/resonance-lab/labPipeline.js", import.meta.url).href);

{
  const src = fakeSource();
  // The production consumers (DSP, pitch, resonance) are already connected.
  src.connectConsumer(); src.connectConsumer(); src.connectConsumer();
  const base = src.feeds.size;
  const h = lab.startLab(src);
  check("starting the lab adds one feed", src.feeds.size === base + 1, `${src.feeds.size}`);
  h.stop();
  check("stopping it removes that feed", src.feeds.size === base, `${src.feeds.size}`);
  check("…and ends its worker", workers.at(-1).terminated === true);
  check("the lab is not running", lab.getState().running === false);
  for (let i = 0; i < 3; i++) { lab.startLab(src).stop(); }
  check("three more on / off cycles: back to the starting count", src.feeds.size === base, `${src.feeds.size}`);
  lab.startLab(src);
  lab.startLab(src);
  check("a restart replaces the feed (one lab feed)", src.feeds.size === base + 1, `${src.feeds.size}`);
  check("…and ends the previous worker", workers.at(-2).terminated === true && workers.at(-1).terminated === false);
  lab.stopLab();
  check("stopLab() removes it", src.feeds.size === base, `${src.feeds.size}`);
  lab.stopLab();
  check("a second stop is harmless", src.feeds.size === base, `${src.feeds.size}`);
}
{
  const src = fakeSource({ withDisconnect: false });
  let threw = false;
  try { lab.startLab(src).stop(); } catch { threw = true; }
  check("a source without disconnectConsumer: stop does not throw", !threw);
}
{
  const src = fakeSource();
  src.disconnectConsumer = () => { throw new Error("closed"); };
  let threw = false;
  try { lab.startLab(src).stop(); } catch { threw = true; }
  check("a closed source: stop does not throw and the worker ends", !threw && workers.at(-1).terminated === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
