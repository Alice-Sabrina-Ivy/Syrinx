// lab_live.mjs — NodeBridge scorer that runs ONE finalist through the in-app resonance
// lab's full live path (src/resonance-lab/lab-engine.js): the 16 kHz bench item is
// band-limited-upsampled to 48 kHz (the fv bench's upsampler) and fed as 25 ms capture
// chunks; the engine then does everything the browser lab worker does — anti-aliased
// 48 k -> 16 k analysis resampling, the production pitch-worker replica (linear
// resampler, notch, Boersma-AC, L=2 tracker, vetoes) for voicing AND F0, frame
// scheduling behind the decode lag, the finalist itself. The harness F0 track is ignored.
//
//   node lab_live.mjs <jobs.json> <out.jsonl> <finalist: vtln|le|fv|pnml>
// pnml runs the deployed q8-v2 model (transformers.js cache), patched in memory exactly as
// the lab worker does, through transformers.js / onnxruntime-node (1 thread).
import { readFileSync, openSync, writeSync, closeSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
const { concatIntoOutput } = await imp("src/resonance-lab/onnx-patch.js");
const { upsample } = await imp("scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");

const [jobsPath, outPath, fin] = process.argv.slice(2);
const A = path.join(repo, "public", "resonance-lab");
const j = (n) => JSON.parse(readFileSync(path.join(A, n), "utf8"));
const reference = j("reference.json");
const models = {};
if (fin === "le") models.le = j("le_ens_h64.json");
else if (fin === "vtln") models.vtln = j("vtln_warp.json");
else if (fin === "fv") models.fv = j("fv_model.json");
else if (fin === "pnml") models.pnmlHead = j("pnml_head.json");
else throw new Error(`unknown finalist ${fin}`);

let model = null, Tensor = null, tmpRoot = null;
if (fin === "pnml") {
  const id = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
  const cache = path.join(repo, "node_modules/@huggingface/transformers/.cache", id);
  tmpRoot = mkdtempSync(path.join(tmpdir(), "reslab-live-"));
  const dst = path.join(tmpRoot, id);
  mkdirSync(path.join(dst, "onnx"), { recursive: true });
  for (const f of ["config.json", "preprocessor_config.json"]) copyFileSync(path.join(cache, f), path.join(dst, f));
  writeFileSync(path.join(dst, "onnx/model_quantized.onnx"), concatIntoOutput(new Uint8Array(readFileSync(path.join(cache, "onnx/model_quantized.onnx")))));
  const T = await import("@huggingface/transformers");
  T.env.allowRemoteModels = false;
  T.env.allowLocalModels = true;
  T.env.localModelPath = tmpRoot;
  T.env.useFSCache = false;
  Tensor = T.Tensor;
  model = await T.AutoModelForAudioClassification.from_pretrained(id, {
    dtype: "q8", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
}

const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
const fd = openSync(outPath, "w");
const c0 = process.cpuUsage();
for (const job of jobs) {
  const b = readFileSync(job.audio);
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const y = Float32Array.from(upsample(x));
  const t = [], s = [];
  const eng = createLabEngine({
    sampleRate: 48000, models, reference, pnmlMaxPending: Infinity,
    onBin: (name, te, v) => { if (name === fin) { t.push(te); s.push(v); } },
  });
  const serve = async () => {
    if (!model) return;
    for (let r = eng.takePnmlRequest(); r; r = eng.takePnmlRequest()) {
      const out = await model({ input_values: new Tensor("float32", r.win, [1, r.win.length]) });
      eng.pnmlDone(r.k, out.logits.data);
    }
  };
  for (let k = 0; k < y.length; k += 1200) {
    eng.pushChunk(y.subarray(k, Math.min(y.length, k + 1200)));
    await serve();
  }
  eng.finish();
  await serve();
  writeSync(fd, JSON.stringify({ key: job.key, t, s: s.map((v) => (v === null || !Number.isFinite(v) ? null : v)) }) + "\n");
}
const u = process.cpuUsage(c0);
writeSync(fd, JSON.stringify({ __cpu_s: (u.user + u.system) / 1e6 }) + "\n");
closeSync(fd);
if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
