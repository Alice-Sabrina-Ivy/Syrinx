#!/usr/bin/env node
// analyze-voicedness.js — Postprocess a diag snapshot JSON to
// disambiguate why the pitch trace fragments during continuous
// speech. Operates on the per-frame `voicedness`, `voicednessObs`,
// `inputRms`, and `pitch` fields that pushFrame writes into the
// frames ring buffer when ?diag=1 is on.
//
// Usage:
//   node scripts/analyze-voicedness.js <snapshot.json> [--csv]
//
// With `--csv`: also writes <snapshot>.timeline.csv with one row
// per frame (tSec, inputRms, voicedness, voicednessObs, pitchHz)
// for spreadsheet exploration.
//
// Reports:
//   1. Distribution stats (min/p10/p25/median/p75/p90/max) for
//      voicedness, voicednessObs, inputRms.
//   2. Cross-tab voicedness ≥ VOICEDNESS_THRESHOLD × pitch-detected
//      (the 2×2 table). Identifies which gate is responsible for
//      pitch nulls.
//   3. ASCII sparkline of voicedness over time, downsampled to
//      one character per ~window-of-time so failure modes (e.g.,
//      voicedness collapsing mid-utterance) read at a glance.
//   4. Verdict mapping signals to three hypotheses:
//        (a) VOICEDNESS_THRESHOLD too high relative to real speech
//        (b) voicedness calculation buggy (high variance during
//            steady voiced speech)
//        (c) upstream filter dropping windows (pitch fails on
//            windows that DO pass the voicedness gate)
//
// Input formats accepted:
//   - Top-level snapshot (overlay's "Snapshot last 5s" button).
//   - {summary, snapshot} wrapper (mobile-diag-capture output).
//   - {snapshot} wrapper (desktop-diag-capture variants).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";

// Mirrors useAudioPipeline.js's gate threshold so the cross-tab
// matches the production decision. If that constant changes, this
// should too.
const VOICEDNESS_THRESHOLD = 0.5;

// Verdict thresholds. Judgment calls — future real-world data may
// motivate tuning. Documented inline so a reader knows what each
// number is asserting.
//
// (a) "voicedness median below the gate" + "p25 well below" implies
// real voiced speech sits substantially under the gate threshold,
// which is the gate-too-strict hypothesis.
const VERDICT_TOO_HIGH_MEDIAN = 0.5;
const VERDICT_TOO_HIGH_P25 = 0.3;
//
// (b) "voicedness median above gate" + "high std during what
// should be steady voiced speech" — flags the calculation for
// review. Not definitive without a known-good comparison
// implementation; a STRONG (b) signal would warrant pulling out a
// separate test harness.
const VERDICT_BUGGY_STD = 0.3;
//
// (c) "voicedness passes the gate" + "pitch detection still fails
// on the majority of windows" + "audio is present" — implicates
// something downstream/parallel of the gate, not the gate itself.
const VERDICT_UPSTREAM_PITCH_FRAC = 0.5;
const VERDICT_UPSTREAM_RMS = 0.05;

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out.flags[k] = v ?? true;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * q))];
}

function statsOf(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  const sorted = [...v].sort((a, b) => a - b);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return {
    n: v.length,
    min: sorted[0],
    p10: quantile(sorted, 0.10),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.50),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.90),
    max: sorted[sorted.length - 1],
    mean,
    std: Math.sqrt(variance),
  };
}

function fmtStats(s, decimals = 4) {
  if (!s) return "(no data)";
  const f = (x) => x?.toFixed(decimals);
  return `min=${f(s.min)}  p10=${f(s.p10)}  p25=${f(s.p25)}  median=${f(s.median)}  p75=${f(s.p75)}  p90=${f(s.p90)}  max=${f(s.max)}  (mean=${f(s.mean)}, std=${f(s.std)}, n=${s.n})`;
}

// Down-sample the per-frame series to fit `width` characters, then
// render each bucket as one character keyed to its mean value.
// Bucket characters: ' ' for ≤0, '_' '.' '-' '#' ascending. The '-'
// (0.4–0.6 bucket) lands at the gate edge so a sparkline that
// switches between '-' and '#' is visibly grazing the gate.
function compactSparkline(values, width = 80) {
  if (values.length === 0) return "";
  const series = values.length <= width
    ? values
    : (() => {
        const step = values.length / width;
        const out = [];
        for (let i = 0; i < width; i++) {
          const start = Math.floor(i * step);
          const end = Math.min(values.length, Math.floor((i + 1) * step));
          const slice = values.slice(start, end).filter((x) => typeof x === "number");
          if (slice.length === 0) out.push(null);
          else out.push(slice.reduce((s, x) => s + x, 0) / slice.length);
        }
        return out;
      })();
  const chars = [" ", "_", ".", "-", "#"];
  return series.map((v) => {
    if (v == null || !Number.isFinite(v)) return "?";
    const clamped = Math.max(0, Math.min(1, v));
    const idx = Math.min(chars.length - 1, Math.floor(clamped * chars.length));
    return chars[idx];
  }).join("");
}

function getFrames(snap) {
  // Try common wrapper layouts in turn.
  if (Array.isArray(snap.frames)) return snap.frames;
  if (snap.snapshot && Array.isArray(snap.snapshot.frames)) return snap.snapshot.frames;
  return [];
}

function main() {
  const { positional, flags } = parseArgs(process.argv);
  if (!positional[0]) {
    console.error("usage: node scripts/analyze-voicedness.js <snapshot.json> [--csv]");
    process.exit(2);
  }

  const path = positional[0];
  const snap = JSON.parse(readFileSync(path, "utf8"));
  const frames = getFrames(snap);
  if (frames.length === 0) {
    console.error("✗ No frames in snapshot. Was ?diag=1 set during capture? Or is the JSON layout unexpected?");
    process.exit(2);
  }

  const voicedness = frames.map((f) => f.voicedness);
  const voicednessObs = frames.map((f) => f.voicednessObs);
  const inputRms = frames.map((f) => f.inputRms);

  const vstats = statsOf(voicedness);
  const ostats = statsOf(voicednessObs);
  const rstats = statsOf(inputRms);

  // Cross-tab: voicedness gate × pitch-detected.
  let voicedAndPitch = 0, voicedNoPitch = 0;
  let unvoicedAndPitch = 0, unvoicedNoPitch = 0;
  let nullVoicedness = 0;
  for (const f of frames) {
    if (typeof f.voicedness !== "number") {
      nullVoicedness++;
      continue;
    }
    const voiced = f.voicedness >= VOICEDNESS_THRESHOLD;
    const hasPitch = typeof f.pitch === "number" && f.pitch !== null;
    if (voiced && hasPitch) voicedAndPitch++;
    else if (voiced && !hasPitch) voicedNoPitch++;
    else if (!voiced && hasPitch) unvoicedAndPitch++;
    else unvoicedNoPitch++;
  }
  const total = voicedAndPitch + voicedNoPitch + unvoicedAndPitch + unvoicedNoPitch;
  const totalVoiced = voicedAndPitch + voicedNoPitch;
  const pitchFracOfVoiced = totalVoiced > 0 ? voicedAndPitch / totalVoiced : null;

  // Audio-present-but-no-pitch — load-bearing for hypothesis (c).
  let audioPresentNoPitch = 0;
  let totalLoud = 0;
  for (const f of frames) {
    if (typeof f.inputRms !== "number" || f.inputRms <= VERDICT_UPSTREAM_RMS) continue;
    totalLoud++;
    if (f.pitch === null || typeof f.pitch !== "number") audioPresentNoPitch++;
  }
  const loudWindowPitchRate = totalLoud > 0 ? 1 - audioPresentNoPitch / totalLoud : null;

  // ── Print report ─────────────────────────────────────────
  console.log(`Snapshot: ${path}`);
  const ua = snap.userAgent ?? snap.snapshot?.userAgent;
  if (ua) console.log(`UA:       ${ua.slice(0, 80)}${ua.length > 80 ? "…" : ""}`);
  console.log(`Frames:   ${frames.length}` +
    (nullVoicedness ? `  (${nullVoicedness} with null voicedness — Stage 0/1 pYIN, pre-Stage-2.B)` : ""));
  console.log();

  console.log("=== Voicedness (HMM-smoothed posterior, gate signal) ===");
  console.log("  " + fmtStats(vstats));
  console.log();

  console.log("=== voicednessObs (raw Beta-CDF candidate mass, pre-HMM) ===");
  console.log("  " + fmtStats(ostats));
  console.log();

  console.log("=== inputRms (audio level, RMS) ===");
  console.log("  " + fmtStats(rstats, 5));
  console.log();

  console.log(`=== Cross-tab: voicedness ≥ ${VOICEDNESS_THRESHOLD} × pitch-detected ===`);
  if (total > 0) {
    const pct = (n) => `${(100 * n / total).toFixed(1).padStart(5)}%`;
    console.log(`  voiced + pitch:      ${voicedAndPitch.toString().padStart(5)}  (${pct(voicedAndPitch)})`);
    console.log(`  voiced + no-pitch:   ${voicedNoPitch.toString().padStart(5)}  (${pct(voicedNoPitch)})`);
    console.log(`  unvoiced + pitch:    ${unvoicedAndPitch.toString().padStart(5)}  (${pct(unvoicedAndPitch)})`);
    console.log(`  unvoiced + no-pitch: ${unvoicedNoPitch.toString().padStart(5)}  (${pct(unvoicedNoPitch)})`);
  } else {
    console.log("  (no rows with numeric voicedness)");
  }
  if (pitchFracOfVoiced != null) {
    console.log(`  voiced-window pitch detection rate: ${(pitchFracOfVoiced * 100).toFixed(1)}%`);
  }
  if (loudWindowPitchRate != null) {
    console.log(`  loud-window pitch detection rate:   ${(loudWindowPitchRate * 100).toFixed(1)}%  (loud = inputRms > ${VERDICT_UPSTREAM_RMS}, n=${totalLoud})`);
  }
  console.log();

  console.log("=== Voicedness sparkline (chronological, 80 chars) ===");
  console.log("  " + compactSparkline(voicedness, 80));
  console.log("  legend:  ' ' ≤0   '_' 0–0.2   '.' 0.2–0.4   '-' 0.4–0.6 (gate edge)   '#' >0.6");
  console.log();

  console.log("=== Verdict ===");
  printVerdict({
    vstats, pitchFracOfVoiced,
    audioPresentNoPitch, totalLoud,
  });
  console.log();

  if (flags.csv) {
    const ext = extname(path);
    const csvPath = join(dirname(path), basename(path, ext) + ".timeline.csv");
    const t0 = frames[0].tEpochMs;
    const lines = ["tSec,inputRms,voicedness,voicednessObs,pitchHz"];
    for (const f of frames) {
      const t = ((f.tEpochMs - t0) / 1000).toFixed(3);
      const rms = typeof f.inputRms === "number" ? f.inputRms.toFixed(5) : "";
      const v = typeof f.voicedness === "number" ? f.voicedness.toFixed(5) : "";
      const o = typeof f.voicednessObs === "number" ? f.voicednessObs.toFixed(5) : "";
      const p = typeof f.pitch === "number" ? f.pitch.toFixed(2) : "";
      lines.push(`${t},${rms},${v},${o},${p}`);
    }
    writeFileSync(csvPath, lines.join("\n") + "\n");
    console.log(`CSV timeline written: ${csvPath}`);
  }
}

function printVerdict({ vstats, pitchFracOfVoiced, audioPresentNoPitch, totalLoud }) {
  if (!vstats) {
    console.log("  No voicedness data available — capture may have used Stage 0/1 pYIN");
    console.log("  (which doesn't compute voicedness). Cannot disambiguate the three hypotheses.");
    return;
  }

  const flags = [];

  // (a) THRESHOLD-TOO-HIGH: voicedness sits below the gate.
  if (vstats.median < VERDICT_TOO_HIGH_MEDIAN) {
    const strength = vstats.p25 < VERDICT_TOO_HIGH_P25 ? "STRONG" : "WEAK";
    flags.push(
      `(a) THRESHOLD-TOO-HIGH (${strength}):\n` +
      `      voicedness median ${vstats.median.toFixed(3)} < ${VERDICT_TOO_HIGH_MEDIAN} (gate threshold)\n` +
      `      p25 ${vstats.p25.toFixed(3)} ${vstats.p25 < VERDICT_TOO_HIGH_P25 ? `< ${VERDICT_TOO_HIGH_P25}` : `≥ ${VERDICT_TOO_HIGH_P25}`}\n` +
      `      → Real-world voicedness sits below the gate. Lowering the\n` +
      `        threshold (or recalibrating it from a measured baseline)\n` +
      `        should reduce trace fragmentation. Investigate the gate\n` +
      `        constant in src/audio/useAudioPipeline.js.`
    );
  }

  // (b) CALCULATION-SUSPECT: high variance during what should be steady speech.
  if (vstats.median >= VERDICT_TOO_HIGH_MEDIAN && vstats.std > VERDICT_BUGGY_STD) {
    flags.push(
      `(b) CALCULATION-SUSPECT:\n` +
      `      voicedness median ${vstats.median.toFixed(3)} ≥ ${VERDICT_TOO_HIGH_MEDIAN} (passes gate)\n` +
      `      but std ${vstats.std.toFixed(3)} > ${VERDICT_BUGGY_STD} (high variance)\n` +
      `      → Steady voiced speech is producing unexpectedly volatile\n` +
      `        voicedness values. Investigate pYIN voicedness extraction\n` +
      `        in src/dsp/dsp-worker.js. Compare voicedness vs voicednessObs\n` +
      `        (raw candidate mass, pre-HMM) for the same windows — if they\n` +
      `        diverge, the HMM smoothing layer is the suspect; if they\n` +
      `        track, the candidate-mass calculation is the suspect.`
    );
  }

  // (c) UPSTREAM-FILTER-SUSPECT: voiced + audio present, but pitch fails.
  if (
    vstats.median >= VERDICT_TOO_HIGH_MEDIAN &&
    pitchFracOfVoiced != null &&
    pitchFracOfVoiced < VERDICT_UPSTREAM_PITCH_FRAC
  ) {
    let detail = "";
    if (totalLoud > 0) {
      const lossRate = audioPresentNoPitch / totalLoud;
      detail =
        `      Loud-window pitch-loss rate: ${audioPresentNoPitch}/${totalLoud}\n` +
        `      (${(lossRate * 100).toFixed(1)}% of windows with inputRms > ${VERDICT_UPSTREAM_RMS} have pitch=null).\n`;
    }
    flags.push(
      `(c) UPSTREAM-FILTER-SUSPECT:\n` +
      `      voicedness median ≥ ${VERDICT_TOO_HIGH_MEDIAN} (gate passes)\n` +
      `      but only ${(pitchFracOfVoiced * 100).toFixed(1)}% of voiced windows produce pitch.\n` +
      detail +
      `      → Pitch detection is failing on windows that PASS the gate.\n` +
      `        The voicedness gate isn't responsible. Check pitch detection\n` +
      `        itself (Stage 2.B HMM in src/dsp/dsp-worker.js) or look for\n` +
      `        upstream gates that null-out pitch independently.`
    );
  }

  if (flags.length === 0) {
    console.log(`  No issue detected with the three hypotheses.`);
    console.log(`    voicedness median ${vstats.median.toFixed(3)} (${vstats.median >= VERDICT_TOO_HIGH_MEDIAN ? "above" : "below"} ${VERDICT_TOO_HIGH_MEDIAN} gate)`);
    if (pitchFracOfVoiced != null) {
      console.log(`    voiced-window pitch detection rate: ${(pitchFracOfVoiced * 100).toFixed(1)}%`);
    }
    console.log(`  Capture appears clean for trace-fragmentation analysis.`);
    console.log(`  (Either no fragmentation occurred in this capture, or the issue is`);
    console.log(`  outside the three hypotheses encoded in this script.)`);
  } else {
    flags.forEach((f) => {
      console.log(`  ${f}`);
      console.log();
    });
  }
}

main();
