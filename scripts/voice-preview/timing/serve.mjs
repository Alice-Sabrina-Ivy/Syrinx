// serve.mjs — a small static server for the voice-preview timing page (§P5).
//
//   node scripts/voice-preview/timing/serve.mjs [--port=8787]
//   then open http://localhost:8787/scripts/voice-preview/timing/index.html
//
// Serves only what the page needs, read-only, from 127.0.0.1:
//   /scripts/voice-preview/...  this folder's page, Worker and libraries (repo)
//   /src/...                    the app modules the Worker imports (resampler, lab replica)
//   /vp-cache/wasm/...          the built modules (VP_CACHE/wasm, not committed)
//   /vp-cache/clips/...         the public clips (VP_CACHE/clips, not committed)
// Every response is Cache-Control: no-store, so neither the HTTP cache nor the
// compiled-code cache can help a run. No cross-origin-isolation headers are sent:
// GitHub Pages sends none either.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, REPO } from "../lib/paths.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".f32": "application/octet-stream", ".css": "text/css",
};
const ROUTES = [
  ["/scripts/voice-preview/", path.join(REPO, "scripts", "voice-preview")],
  ["/src/", path.join(REPO, "src")],
  ["/vp-cache/wasm/", P.wasm],
  ["/vp-cache/clips/", P.clips],
];

export function startServer({ port = 8787, host = "127.0.0.1", log = false } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let p = "";
    try { p = decodeURIComponent(url.pathname); } catch { /* a malformed %-escape: answered as not found */ }
    let file = null;
    for (const [prefix, dir] of ROUTES) {
      if (p.startsWith(prefix)) {
        const f = path.resolve(dir, p.slice(prefix.length));
        if (f.startsWith(path.resolve(dir) + path.sep)) file = f;
        break;
      }
    }
    let st = null;
    try { st = file && statSync(file); } catch { st = null; }
    if (!st || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("not found");
      if (log) console.log(`404 ${p}`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.find((s) => s.startsWith("--port="));
  const port = a ? Number(a.slice(7)) : 8787;
  await startServer({ port, log: true });
  console.log(`serving on http://localhost:${port}/scripts/voice-preview/timing/index.html (VP_CACHE ${path.dirname(P.wasm)})`);
}
