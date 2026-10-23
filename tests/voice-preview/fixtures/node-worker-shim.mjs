// node-worker-shim.mjs — runs src/voice-preview/vp-worker.js in a Node worker_threads
// Worker with a Web-Worker-style `self` (postMessage with transfer list, onmessage), for
// tests/voice-preview/controller-test.js. Terminating the thread frees everything the
// worker held, as terminating a browser Worker does.
import { parentPort, workerData } from "node:worker_threads";

globalThis.self = { postMessage: (m, transfer) => parentPort.postMessage(m, transfer) };
// the RNNoise module is fetched with fetch(), which has no file: URLs in Node
(await import("../vp-test-lib.js")).installFileFetch();
await import(workerData.url);
parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
