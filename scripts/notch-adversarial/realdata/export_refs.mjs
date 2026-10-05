// export_refs.mjs — dump the repo corpora's F0 references (tests/dsp/data/
// corpora.js parsers: Hillenbrand vowdata, PTDB-TUG .f0, vocadito csv, FDA .fx
// pitchmarks) to build/notchvd/dl/corpora/<corpus>.refs.json so fetch_voice.py
// uses the SAME reference conventions as the pitch harnesses.
//   node scripts/notch-adversarial/realdata/export_refs.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "../../../tests/dsp/data/corpora.js";
const OUT = resolve(process.env.NOTCHVD_ROOT ?? "build/notchvd", "dl/corpora");
mkdirSync(OUT, { recursive: true });
for (const [name, fn] of [["hillenbrand", loadHillenbrand], ["ptdb-tug", loadPtdbTug], ["vocadito", loadVocadito], ["fda", loadFda]]) {
  const tr = fn();
  const recs = tr.map((t) => ({ corpus: t.corpus, trackId: t.trackId, gender: t.gender, sampleRate: t.sampleRate,
    nSamples: t.samples.length, hopMs: t.ref.hopMs, f0: Array.from(t.ref.f0, (v) => Math.round(v * 100) / 100) }));
  writeFileSync(resolve(OUT, `${name}.refs.json`), JSON.stringify(recs));
  console.log(name, recs.length, "tracks");
}
