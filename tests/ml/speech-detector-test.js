// speech-detector-test.js — framing + streaming contract of the meter's
// speech detector (src/ml/speech-detector.js): Silero VAD's reference
// streaming protocol (512-sample chunks, each prefixed with the previous
// chunk's last 64 samples, LSTM state carried), fed from 25 ms capture
// chunks and stamped on the audio clock. Uses a fake ONNX session (the
// model file is fetched at runtime, not committed).
//
// Usage: node tests/ml/speech-detector-test.js

import { SPEECH_DETECTOR as S, createSpeechFramer, createSileroRunner, sha256Hex } from "../../src/ml/speech-detector.js";

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

console.log("constants");
check("16 kHz, 512-sample chunks, 64-sample context", S.sampleRate === 16000 && S.chunk === 512 && S.context === 64);
check("model pinned by sha256", /^[0-9a-f]{64}$/.test(S.modelSha256) && S.modelUrl.includes("v6.2.3"));

console.log("\nframer: 25 ms capture chunks -> 32 ms frames on the audio clock");
{
  const f = createSpeechFramer();
  const x = Float32Array.from({ length: 16000 }, (_, i) => i); // sample i has value i
  const frames = [];
  for (let k = 0; k < 40; k++) {
    const chunk = x.subarray(k * 400, (k + 1) * 400);
    frames.push(...f.push(chunk, (k + 1) * 25));
  }
  check("31 full frames in 1 s", frames.length === 31, `${frames.length}`);
  check("frame i ends at 32 (i + 1) ms", frames.every((fr, i) => Math.abs(fr.ts - 32 * (i + 1)) < 1e-9));
  check("input = 64 context + 512 samples", frames.every((fr) => fr.input.length === 576));
  check("first frame's context is zeros", frames[0].input.subarray(0, 64).every((v) => v === 0));
  check("first frame's chunk = samples 0..511", frames[0].input[64] === 0 && frames[0].input[575] === 511);
  check("frame i's context = the previous chunk's last 64 samples",
    frames.slice(1).every((fr, i) => fr.input[0] === 512 * (i + 1) - 64 && fr.input[63] === 512 * (i + 1) - 1));
  check("frame i's chunk = samples 512 i .. 512 i + 511",
    frames.every((fr, i) => fr.input[64] === 512 * i && fr.input[575] === 512 * i + 511));
  frames[0].input[100] = -1;
  check("inputs are copies", frames[1].input[100] !== -1 && frames[1].input[100] === 512 + 36);
  f.reset();
  const again = f.push(x.subarray(0, 512), 32);
  check("reset: fresh context and alignment", again.length === 1 && again[0].input[0] === 0 && again[0].input[64] === 0);
}

console.log("\nrunner: LSTM state carried, sr = 16000");
{
  class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
  const seen = [];
  const session = {
    async run(feeds) {
      seen.push(feeds);
      const prev = feeds.state.data[0];
      return { output: { data: Float32Array.of(prev / 10) }, stateN: new Tensor("float32", new Float32Array(256).fill(prev + 1), [2, 1, 128]) };
    },
  };
  const r = createSileroRunner({ Tensor }, session);
  const input = new Float32Array(576);
  const p1 = await r.run(input), p2 = await r.run(input), p3 = await r.run(input);
  check("state starts at zeros and is carried", p1 === 0 && Math.abs(p2 - 0.1) < 1e-7 && Math.abs(p3 - 0.2) < 1e-7);
  check("input tensor [1, 576] float32", seen[0].input.type === "float32" && seen[0].input.dims.join() === "1,576");
  check("state tensor [2, 1, 128]", seen[0].state.dims.join() === "2,1,128");
  check("sr int64 scalar 16000", seen[0].sr.type === "int64" && seen[0].sr.data[0] === 16000n && seen[0].sr.dims.length === 0);
  r.reset();
  check("reset clears the state", (await r.run(input)) === 0);
}

console.log("\nsha256");
{
  const h = await sha256Hex(new TextEncoder().encode("abc").buffer);
  check("sha256('abc')", h === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
