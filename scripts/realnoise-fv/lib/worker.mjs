// worker.mjs — drive the REAL pitch worker of any src tree in Node (25 ms
// chunks), several trees per process. Same protocol as
// scripts/notch-adversarial/lib.mjs runWorker, without its fixed tree list:
// trees are given as name=path pairs (`parseTrees("base=src,c1=build/t/c1/src")`).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };

export function parseTrees(spec) {
  return spec.split(",").map((p) => { const [name, path] = p.split("="); return { name, path: path ?? name }; });
}

export async function loadWorkers(trees) {
  const H = {};
  for (const t of trees) {
    globalThis.self = { postMessage: (m) => posts.push(m) };
    await import(pathToFileURL(resolve(t.path, "dsp/pitch-worker.js")).href);
    H[t.name] = globalThis.self.onmessage;
  }
  globalThis.self = { postMessage: (m) => posts.push(m) };
  return H;
}

// runWorker(h, x, sr) -> [{ t (frame centre, s), pitch (Hz | null), nf (notched Hz[] | null) }]
export function runWorker(h, x, sr) {
  posts.length = 0;
  h({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  h({ data: { type: "audioPort", port } });
  const C = Math.round(0.025 * sr);
  for (let c = 0; c + C <= x.length; c += C) {
    const chunk = Float32Array.from(x.subarray(c, c + C));
    port.onmessage({ data: { buffer: chunk.buffer, contextTime: (c + C) / sr } });
  }
  return posts.filter((p) => p.type === "pitch").map((p) => ({ t: p.contextTime - 0.04, pitch: p.pitch, nf: p.notchedFreqs ?? null }));
}
