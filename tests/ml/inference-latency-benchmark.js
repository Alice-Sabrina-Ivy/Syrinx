// inference-latency-benchmark.js — How long does one inference take with
// the current production model on a 2-sec window? Determines whether 4 Hz
// (250 ms hop) is achievable without swapping models.
//
// Usage: node tests/ml/inference-latency-benchmark.js

import { pipeline, env } from "@huggingface/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const MODEL_ID = "Xenova/wav2vec2-large-xlsr-53-gender-recognition-librispeech";
const SR = 16000;

async function main() {
  console.log(`Loading ${MODEL_ID} (q8)…`);
  const classifier = await pipeline("audio-classification", MODEL_ID, { dtype: "q8" });
  console.log("loaded.\n");

  for (const winSec of [4, 3, 2, 1.5]) {
    const samples = new Float32Array(Math.floor(SR * winSec));
    // Sine + noise so the model has something to chew on
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR) + 0.05 * (Math.random() - 0.5);
    }

    // Warm-up
    await classifier(samples, { sampling_rate: SR });

    // Measure
    const N = 8;
    const ms = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await classifier(samples, { sampling_rate: SR });
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const median = ms[Math.floor(N / 2)];
    const p90 = ms[Math.floor(N * 0.9)];
    console.log(`  ${winSec}s window: median=${median.toFixed(1)}ms  p90=${p90.toFixed(1)}ms  (raw: ${ms.map((m) => m.toFixed(0)).join(", ")})`);
    console.log(`             at 250ms hop (4 Hz): ${(median / 250 * 100).toFixed(0)}% busy`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
