// pause-diag.mjs — the pause-floor check on a REAL device's ?diag=1 snapshot:
// replays the snapshot's per-frame inputs (DSP intensity, the latest posted
// pitch / confidence / voice-detector decision) through the REAL
// useAudioPipeline hook (handleAnalysisResult; voice gate on) and prints, in
// aggregate only, what pause-report.mjs measures on the synthetic floors:
// the pause floor (DSP intensity of the frames > 0.5 s from any posted pitch),
// how often the silence gate is engaged there, and the per-frame idle runs of
// the cue strip's flags by cause (onset blink / idle inside a pause / gate).
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/mobile/pause-diag.mjs <snapshot.json> [<snapshot.json> ...]
//
// A snapshot of the user's own voice is private (CLAUDE.md §Private session
// data): run this locally, keep the snapshot and the printout out of the repo.
// Uses the full-rate `frames` ring (~30 s). The pitch message timestamp is not
// in the snapshot, so each frame's pitch counts as fresh (no staleness path).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { M } = await import(pathToFileURL(path.join(repo, "scripts/session-oracle/lib/react-mock.mjs")).href);
const { idleRuns } = await import("./pause-report.mjs");
const hookUrl = pathToFileURL(path.join(repo, "src/audio/useAudioPipeline.js")).href;
let fake = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => (fake += 1000), timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
const q = (a, p) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };
let gen = 0;
for (const file of process.argv.slice(2)) {
  const snap = JSON.parse(readFileSync(file, "utf8"));
  const S = snap.snapshot ?? snap;
  // JSON has no -Infinity: a digitally silent 50 ms window (intensity -Infinity) is saved as null
  const fr = (S.frames ?? []).filter((f) => typeof f.tEpochMs === "number" && (typeof f.intensity === "number" || f.intensity === null))
    .map((f) => (f.intensity === null ? { ...f, intensity: -Infinity } : f)).sort((a, b) => a.tEpochMs - b.tEpochMs);
  if (fr.length < 200) { console.log(`${path.basename(file)}: only ${fr.length} frames`); continue; }
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(`${hookUrl}?diag=${++gen}`);
  const api = mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only */ } }
  const latest = M.refs.find((r) => r.current && typeof r.current === "object" && "pitch" in r.current && "ts" in r.current && "confidence" in r.current && "voiced" in r.current);
  const har = M.refs.find((r) => typeof r.current === "function" && r.current.name === "handleAnalysisResult");
  const gateRef = M.refs.find((r) => r.current && typeof r.current === "object" && "quietFrames" in r.current);
  api.setVoiceGateEnabled(true);
  const code = new Uint8Array(fr.length);
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    latest.current = { pitch: f.pitch ?? null, confidence: f.confidence ?? null, voiced: f.pitch != null, ts: f.tEpochMs, vadVoice: typeof f.vadVoice === "boolean" ? f.vadVoice : null, vadP: null };
    har.current({ intensity: f.intensity, formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: f.tEpochMs });
    const s = M.state;
    code[i] = (s.voiced ? 1 : 0) | (s.holding ? 2 : 0) | (s.pitchVoiced ? 4 : 0) | (s.pitchHolding ? 8 : 0) | (gateRef.current.quietFrames >= 3 ? 32 : 0) | 64;
  }
  // pause frames: > 0.5 s from any frame with a posted pitch
  const tP = fr.filter((f) => f.pitch != null).map((f) => f.tEpochMs);
  let j = 0;
  const pauseI = [];
  for (let i = 0; i < fr.length; i++) {
    const t = fr[i].tEpochMs;
    while (j + 1 < tP.length && tP[j + 1] <= t) j++;
    const dPrev = tP.length && tP[j] <= t ? t - tP[j] : Infinity, dNext = j + 1 < tP.length ? tP[j + 1] - t : tP.length && tP[j] > t ? tP[j] - t : Infinity;
    if (Math.min(dPrev, dNext) > 500) pauseI.push(i);
  }
  const pi = pauseI.map((i) => fr[i].intensity);
  const dur = (fr[fr.length - 1].tEpochMs - fr[0].tEpochMs) / 1000;
  const runs = idleRuns(code, { kFrom: 1 });
  const by = (c) => runs.filter((r) => r.cause === c);
  const voicedPct = (100 * fr.filter((f) => f.pitch != null).length) / fr.length;
  console.log(`${path.basename(file)}: ${dur.toFixed(1)} s, ${fr.length} frames, posted pitch on ${voicedPct.toFixed(0)} %`);
  console.log(`  pause frames (> 0.5 s from any pitch): ${pauseI.length}; intensity q10 / median / q90 ${q(pi, 0.1)?.toFixed(1)} / ${q(pi, 0.5)?.toFixed(1)} / ${q(pi, 0.9)?.toFixed(1)} dBFS; below -50: ${((100 * pi.filter((x) => x < -50).length) / Math.max(1, pi.length)).toFixed(0)} %; silence gate engaged: ${((100 * pauseI.filter((i) => code[i] & 32).length) / Math.max(1, pauseI.length)).toFixed(0)} %`);
  const mins = dur / 60;
  for (const c of ["onset", "pause", "gate", "silence"]) {
    const r = by(c), frames = r.reduce((a, x) => a + x.b - x.a + 1, 0);
    console.log(`  idle runs "${c}": ${(r.length / mins).toFixed(1)} / min, ${((100 * frames) / fr.length).toFixed(1)} % of frames`);
  }
}
process.exit(0);
