// syrinx_corpus.mjs — the REAL Syrinx production chain (session-oracle
// lib/chain.mjs: real pitch-worker.js incl. streaming resampler + notch +
// guards, real dsp-worker.js, real useAudioPipeline handleAnalysisResult)
// over every corpus track, saving per-hop series for the Python scorer.
// Output: <WORK>/out/syrinx/<tag>/<corpus>/<trackId>.f32 = Float32 [4][n] rows
//   post (worker-posted Hz, 0 = null), paint (live-trace Hz, 0 = gap),
//   dec (tracker decode), conf (posted confidence)
// plus <WORK>/out/syrinx/<tag>/<corpus>.<i>of<n>.json {trackId: {n, hopS, L, cpuMsPerChunk}}.
// Time conventions (session-oracle corpus.mjs): post/dec[k] describe the
// analysis-window centre (k+1)*hop - 40 ms; paint[k] describes
// (k+1)*hop - 40 ms - L*hop - 30 ms.
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/pitch-benchmark/syrinx_corpus.mjs \
//     --src=build/pitch-benchmark/trees/main/src --tag=main --corpus=fda --shard=0/2
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"]; }));
const { loadSrc, runWorkers, buildFrames, driveHook } = await import("../session-oracle/lib/chain.mjs");
const WORK = resolve(process.env.PITCH_BENCH_DIR ?? "build/pitch-benchmark");
const DATA = resolve(WORK, "data");
const index = JSON.parse(readFileSync(resolve(DATA, "index.json"), "utf8"));
const corpus = args.corpus; const tag = args.tag;
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const S = await loadSrc(args.src);
const dir = resolve(WORK, "out/syrinx", tag, corpus); mkdirSync(dir, { recursive: true });
const meta = {}; const t0 = Date.now();
const tracks = index.filter((t) => t.corpus === corpus).filter((_, i) => i % shN === shI);
for (const t of tracks) {
  const buf = readFileSync(resolve(DATA, corpus, `${t.trackId}.f32`));
  const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const W = runWorkers(S, samples, t.sr);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const out = new Float32Array(4 * W.n);
  out.set(W.col.post, 0); out.set(D.paint, W.n); out.set(W.col.dec, 2 * W.n); out.set(W.col.conf, 3 * W.n);
  writeFileSync(resolve(dir, `${t.trackId}.f32`), Buffer.from(out.buffer));
  meta[t.trackId] = { n: W.n, hopS: W.C / W.sr, L: W.L, cpuMsPerChunk: W.cpu.pitchMsPerChunk };
}
writeFileSync(resolve(WORK, "out/syrinx", tag, `${corpus}.${shI}of${shN}.json`), JSON.stringify(meta));
console.log(`${tag} ${corpus} ${shI}/${shN}: ${tracks.length} tracks ${(Date.now() - t0) / 1000}s`);
