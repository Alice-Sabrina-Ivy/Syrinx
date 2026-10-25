// node-worker-shim.mjs — runs src/voice-preview/vp-worker.js in a Node worker_threads
// Worker with a Web-Worker-style `self` (postMessage with transfer list, onmessage), for
// tests/voice-preview/controller-test.js. Terminating the thread frees everything the
// worker held, as terminating a browser Worker does.
//
// Inside, `Worker` is a Web-Worker-style class over worker_threads running this same shim, so
// the voice-preview worker can start the app's pitch worker for re-tracking (src/voice-preview/
// retrack.js), as it does in a browser.
import { parentPort, workerData, Worker as NodeThread } from "node:worker_threads";

class WebWorker {
  constructor(url) {
    this.t = new NodeThread(new URL(import.meta.url), { workerData: { url: String(url) } });
    this.t.on("message", (data) => this.onmessage && this.onmessage({ data }));
    this.t.on("error", (e) => this.onerror && this.onerror(e));
  }
  postMessage(m, transfer) { this.t.postMessage(m, transfer); }
  terminate() { this.t.terminate(); }
}
globalThis.Worker = WebWorker;
globalThis.self = { postMessage: (m, transfer) => parentPort.postMessage(m, transfer) };
// the RNNoise module is fetched with fetch(), which has no file: URLs in Node
(await import("../vp-test-lib.js")).installFileFetch();
await import(workerData.url);
parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
