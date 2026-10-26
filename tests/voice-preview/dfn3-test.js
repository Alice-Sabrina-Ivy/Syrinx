// dfn3-test.js — Voice Shaper's background-noise reduction, DeepFilterNet 3 (src/voice-preview/dfn3.js,
// src/voice-preview/dfn3-model.js). Without the graphs (CI): the pins, the model source, the loader's
// checks, the 960-point FFT against a direct DFT, the ERB bands and the level normalisation. With
// the graphs in build/models/dfn3 (node scripts/fetch-dfn3-model.mjs): their hashes, the [df]
// values of their config.ini against the hard-coded DF, and the port end to end on a committed
// LibriSpeech clip with white noise — length, no delay, noise reduced, deterministic, the 44.1 kHz
// path, and a quiet copy (-30 dB) treated like the original (level normalisation).
// measurements/voice-shaper-noise-2026-10-25.md §6–§7.
//
//   node tests/voice-preview/dfn3-test.js
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeChecker, makeInput, installFileFetch, DFN3_DIR, DFN3_SOURCE, DFN3_HINT } from "./vp-test-lib.js";
import { DFN3_MODEL, dfn3ModelSource, loadDfn3Files, createDfn3Sessions, createDfn3, denoiseClipDfn3, dfn3Gain, makeFft, erbFb, DF } from "../../src/voice-preview/dfn3.js";

const T = makeChecker();
installFileFetch();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const dB = (r) => 20 * Math.log10(r + 1e-12);

console.log("pins and hosting");
T.check("three graphs pinned (enc, erb_dec, df_dec) with sizes and sha256", DFN3_MODEL.files.map((f) => f.name).join() === "enc.onnx,erb_dec.onnx,df_dec.onnx"
  && DFN3_MODEL.files.every((f) => f.bytes > 1e6 && /^[0-9a-f]{64}$/.test(f.sha256)));
T.check("the upstream archive and commit are pinned", /^[0-9a-f]{40}$/.test(DFN3_MODEL.commit) && DFN3_MODEL.archive.bytes === 7983136);
T.check("source: the mirror at a pinned commit when set", dfn3ModelSource({ model: { ...DFN3_MODEL, mirrorCommit: "abc" } }).base === `https://huggingface.co/${DFN3_MODEL.mirror}/resolve/abc/`);
T.check("source: the app's own folder without a mirror, null without either",
  dfn3ModelSource({ appBaseUrl: "http://x/models/dfn3/", model: { ...DFN3_MODEL, mirrorCommit: null } })?.kind === "app"
  && dfn3ModelSource({ model: { ...DFN3_MODEL, mirrorCommit: null } }) === null);
{
  // a server that answers a different file (a dev server's HTML fallback) is refused
  const fake = async () => new Response(new Uint8Array(100), { status: 200 });
  let code = null;
  try { await loadDfn3Files({ kind: "app", base: "http://x/" }, { fetchFn: fake }); } catch (err) { code = err.code; }
  T.check("loader: a wrong-size file -> code \"unavailable\"", code === "unavailable");
  code = null;
  try { await loadDfn3Files(null); } catch (err) { code = err.code; }
  T.check("loader: no source -> code \"unavailable\"", code === "unavailable");
}

console.log("\nsignal processing");
{
  const N = DF.fft, fft = makeFft(N);
  const re = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9)), im = new Float64Array(N);
  const oRe = new Float64Array(N), oIm = new Float64Array(N);
  fft(re, im, oRe, oIm);
  let err = 0;
  for (let k = 0; k < N; k += 7) {
    let a = 0, b = 0;
    for (let n = 0; n < N; n++) { a += re[n] * Math.cos(-2 * Math.PI * k * n / N); b += re[n] * Math.sin(-2 * Math.PI * k * n / N); }
    err = Math.max(err, Math.abs(a - oRe[k]), Math.abs(b - oIm[k]));
  }
  T.check("960-point FFT = direct DFT (max error < 1e-9)", err < 1e-9, err.toExponential(1));
  const erb = erbFb(DF.sr, N, DF.nbErb, DF.minNbErbFreqs);
  T.check("ERB bands: 32, at least 2 bins each, covering the 481 bins", erb.length === 32 && erb.every((b) => b >= 2) && erb.reduce((a, b) => a + b, 0) === N / 2 + 1, erb.join(","));
  const { pcm, rate } = makeInput({ clip: "ls_woman_high", rate: 48000 });
  const g = dfn3Gain(pcm, rate), gq = dfn3Gain(pcm.map((v) => v * 0.0316), rate);
  T.check("level normalisation: a copy 30 dB quieter gets 30 dB more gain", Math.abs(dB(gq / g) - 30) < 0.01, `${dB(g).toFixed(1)} / ${dB(gq).toFixed(1)} dB`);
  T.check("…digital silence is left alone (gain 1)", dfn3Gain(new Float32Array(4800), rate) === 1);
}

console.log("\nthe graphs and the port end to end");
if (!DFN3_SOURCE) console.log(`  SKIP the graphs are not in build/models/dfn3 (${DFN3_HINT})`);
else {
  T.check("local graphs = the pinned files (size, sha256)", DFN3_MODEL.files.every((f) => { const b = readFileSync(path.join(DFN3_DIR, f.name)); return b.length === f.bytes && sha(b) === f.sha256; }));
  const cfgPath = path.join(DFN3_DIR, "config.ini");
  if (existsSync(cfgPath)) {
    const cfg = readFileSync(cfgPath, "utf8");
    const get = (sec, key) => { const m = cfg.split(`[${sec}]`)[1]?.split(/\n\[/)[0].match(new RegExp(`^${key}\\s*=\\s*(\\S+)`, "m")); return m ? Number(m[1]) : NaN; };
    T.check("config.ini = the pinned file", sha(readFileSync(cfgPath)) === DFN3_MODEL.configSha256);
    T.check("DF = config.ini's [df] (sr, fft_size, hop_size, nb_erb, nb_df, df_order, df_lookahead, norm_tau, min_nb_erb_freqs) and conv_lookahead",
      get("df", "sr") === DF.sr && get("df", "fft_size") === DF.fft && get("df", "hop_size") === DF.hop && get("df", "nb_erb") === DF.nbErb && get("df", "nb_df") === DF.nbDf
      && get("df", "df_order") === DF.order && get("df", "df_lookahead") === DF.lookahead && get("df", "norm_tau") === DF.tau && get("df", "min_nb_erb_freqs") === DF.minNbErbFreqs
      && get("deepfilternet", "conv_lookahead") === DF.lookahead);
  } else console.log("  SKIP config.ini (re-run node scripts/fetch-dfn3-model.mjs)");
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  const dfn = createDfn3(ort, await createDfn3Sessions(ort, await loadDfn3Files(DFN3_SOURCE)));
  const { pcm: clean, rate } = makeInput({ clip: "ls_woman_high", rate: 48000 });
  let s = 7;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
  const noise = Float32Array.from({ length: clean.length }, rnd);
  const k = rms(clean) / rms(noise) / Math.sqrt(10); // 10 dB SNR
  const noisy = clean.map((v, i) => v + k * noise[i]);
  const y = await denoiseClipDfn3(dfn, noisy, rate);
  T.check("output: the input's length", y.length === noisy.length);
  // no delay: the output correlates best with the clean clip at lag 0
  let best = 0, bv = -Infinity;
  for (let d = -480; d <= 480; d += 1) { let c = 0; for (let i = 24000; i < Math.min(clean.length, 72000); i += 3) c += clean[i] * (y[i + d] ?? 0); if (c > bv) { bv = c; best = d; } }
  T.check("no delay (best correlation with the clean clip at lag 0)", best === 0, `lag ${best}`);
  const errIn = rms(noisy.map((v, i) => v - clean[i])), errOut = rms(y.map((v, i) => v - clean[i]));
  T.check("white noise at 10 dB: the error against the clean clip drops by more than 6 dB", dB(errIn) - dB(errOut) > 6, `${(dB(errIn) - dB(errOut)).toFixed(1)} dB`);
  const y2 = await denoiseClipDfn3(dfn, noisy, rate);
  T.check("deterministic (a second run gives the same bytes)", sha(Buffer.from(y.buffer)) === sha(Buffer.from(y2.buffer)));
  const q = noisy.map((v) => v * 0.0316); // -30 dB
  const yq = await denoiseClipDfn3(dfn, q, rate);
  T.check("a copy 30 dB quieter comes out 30 dB quieter, otherwise the same (level normalisation)", Math.abs(dB(rms(yq)) - dB(rms(y)) + 30) < 0.1 && dB(rms(yq.map((v, i) => v / 0.0316 - y[i]))) - dB(rms(y)) < -40,
    `${(dB(rms(yq)) - dB(rms(y))).toFixed(2)} dB`);
  const { pcm: c44 } = makeInput({ clip: "ls_woman_high", rate: 44100 });
  const y44 = await denoiseClipDfn3(dfn, c44.map((v, i) => v + k * noise[i % noise.length]), 44100);
  T.check("44.1 kHz: through 48 kHz, the input's length", y44.length === c44.length && rms(y44) > 0);
}

T.done();
