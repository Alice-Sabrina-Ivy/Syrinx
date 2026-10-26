// serve.mjs — static server for the DFN3 browser bench (localhost only). Serves this folder's page
// and worker plus the assets prep.mjs copied to build/vsn/dfbench/; POST /result -> onResult(json).
import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../../../../build/vsn/dfbench");
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
export function serve(port, onResult) {
  return http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    if (q.method === "POST" && rel === "result") { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { r.end("ok"); onResult?.(JSON.parse(b)); }); return; }
    const f = [path.join(here, rel), path.join(assets, rel)].find((p) => existsSync(p) && !p.endsWith(path.sep));
    if (!f) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { "content-type": T[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" }); r.end(readFileSync(f));
  }).listen(port, "127.0.0.1");
}
