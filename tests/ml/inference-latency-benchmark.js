// inference-latency-benchmark.js — How long does one inference take with
// the current production model? The pipeline runs 0.75-sec windows at a
// 150 ms hop (~6.7 Hz), so per-window inference must finish under 150 ms
// on the slowest target device (Pixel-8-class mobile CPU/WASM).
//
// Usage: node tests/ml/inference-latency-benchmark.js

import { pipeline, env } from "@huggingface/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const MODEL_ID = "prithivMLmods/Common-Voice-Gender-Detection-ONNX";
const SR = 16000;
const HOP_MS = 150;

async function main() {
  console.log(`Loading ${MODEL_ID} (q8)…`);
  const classifier = await pipeline("audio-classification", MODEL_ID, { dtype: "q8" });
  console.log("loaded.\n");

  for (const winSec of [1.5, 1.0, 0.75, 0.5]) {
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
    console.log(`             at ${HOP_MS}ms hop (${(1000 / HOP_MS).toFixed(1)} Hz): ${(median / HOP_MS * 100).toFixed(0)}% busy`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
