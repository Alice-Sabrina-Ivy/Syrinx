// export_corpora.mjs — dump every ground-truth corpus track exactly as the
// project's loaders (tests/dsp/data/corpora.js) see it, so the Python
// detectors and the scorer read bit-identical audio + references.
//   <WORK>/data/<corpus>/<trackId>.f32      Float32 mono PCM at the native rate
//   <WORK>/data/<corpus>/<trackId>.ref.f32  reference F0 (0 = unvoiced)
//   <WORK>/data/index.json  [{corpus, trackId, gender, sr, n, refHopMs, refOffsetMs}]
// refOffsetMs: reference frame i describes time i*refHopMs + refOffsetMs
// (PTDB-TUG +20 ms, CLAUDE.md binding rule; others 0).
// WORK = $PITCH_BENCH_DIR or build/pitch-benchmark (see paths.py).
// Usage (repo root): node scripts/pitch-benchmark/export_corpora.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } from "../../tests/dsp/data/corpora.js";
const WORK = resolve(process.env.PITCH_BENCH_DIR ?? "build/pitch-benchmark");
const OUT = resolve(WORK, "data");
const SETS = { fda: [loadFda, 0], ptdb: [loadPtdbTug, 20], hil: [loadHillenbrand, 0], voc: [loadVocadito, 0] };
const index = [];
for (const [c, [loader, off]] of Object.entries(SETS)) {
  mkdirSync(resolve(OUT, c), { recursive: true });
  for (const tr of loader()) {
    writeFileSync(resolve(OUT, c, `${tr.trackId}.f32`), Buffer.from(tr.samples.buffer, tr.samples.byteOffset, tr.samples.byteLength));
    const r = Float32Array.from(tr.ref.f0);
    writeFileSync(resolve(OUT, c, `${tr.trackId}.ref.f32`), Buffer.from(r.buffer));
    const gender = c === "voc" ? "u" : (tr.gender === "w" ? "f" : tr.gender);
    index.push({ corpus: c, trackId: tr.trackId, gender, sr: tr.sampleRate, n: tr.samples.length, refHopMs: tr.ref.hopMs, refOffsetMs: off });
  }
  console.log(c, index.filter((x) => x.corpus === c).length, "tracks");
}
writeFileSync(resolve(OUT, "index.json"), JSON.stringify(index, null, 0));
