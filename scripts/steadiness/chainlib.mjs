// chainlib.mjs — steadiness-readout oracle helpers (2026-10-04).
//
// driveHookMessages(): drives the REAL useAudioPipeline hook the way
// production does for the steadiness path — every pitch-worker message
// goes through the hook's own handlePitchMessage (which updates
// latestPitchRef and pushes the posted value into the steadiness
// tracker), then each DSP frame goes through handleAnalysisResult, whose
// throttled state carries `steadiness` / `steadinessHeld`. The session
// oracle's driveHook() sets latestPitchRef directly and so never reaches
// the steadiness path; the display columns of the two drivers must be
// identical (checked by hook-check.mjs).
//
// simulateModule(): the pure module over the same posted series (what
// the hook should reproduce).
//
// Requires `node --import ./scripts/session-oracle/lib/register.mjs`.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { M } from "../session-oracle/lib/react-mock.mjs";

let gen = 0;

// W = runWorkers() result. Messages: the pitch message emitted while
// processing chunk k (W.msgPitch[k] not NaN) describes frame k - L, whose
// contextTime the worker posts as (k - L + 1) * C / sr.
export async function driveHookMessages(hookPath, W) {
  M.refs = []; M.effects = []; M.state = null;
  const mod = await import(pathToFileURL(hookPath).href + `?st=${++gen}`);
  mod.useAudioPipeline();
  for (const e of M.effects) { try { e(); } catch { /* browser-only effects */ } }
  const byName = (name) => M.refs.find((r) => typeof r.current === "function" && r.current.name === name);
  const har = byName("handleAnalysisResult");
  const hpm = byName("handlePitchMessage");
  if (!har || !hpm) throw new Error("could not locate handleAnalysisResult / handlePitchMessage refs");
  const { n, C, sr, L, col, msgPitch, msgConf } = W;
  const out = {
    steady: new Float32Array(n).fill(NaN), held: new Uint8Array(n),
    ro: new Float32Array(n), msgs: [],
  };
  for (let k = 0; k < n; k++) {
    const now = (k + 1) * C / sr * 1000;
    if (!Number.isNaN(msgPitch[k])) {
      const pitch = msgPitch[k] > 0 ? msgPitch[k] : null;
      const msg = { type: "pitch", pitch, confidence: msgConf[k], voiced: pitch !== null, ts: now, contextTime: (k - L + 1) * C / sr };
      out.msgs.push(msg);
      hpm.current(msg);
    }
    if (Number.isNaN(col.inten[k])) continue;
    har.current({ intensity: col.inten[k], formants: null, spectralTilt: null, hnr: null, cpp: null, absoluteTime: now });
    const s = M.state;
    out.steady[k] = typeof s.steadiness === "number" ? s.steadiness : NaN;
    out.held[k] = s.steadinessHeld ? 1 : 0;
    out.ro[k] = s.pitch ?? 0;
  }
  return out;
}

export async function loadSteadiness(srcDir) {
  return import(pathToFileURL(resolve(srcDir, "audio/steadiness.js")).href);
}

// Pure module over posted values `post[kk]` (0 = unvoiced) with message
// time (kk + 1) * hop — the attr-dump / runWorkers detection-column
// convention. Returns per-kk value (NaN = "—") and held flag, read after
// each push (the hook reads at least once per DSP frame).
export function simulateModule(mod, post, hop, opts = {}) {
  const tr = mod.createSteadinessTracker(opts);
  const n = post.length;
  const value = new Float32Array(n).fill(NaN), held = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    tr.push(post[k] > 0 ? post[k] : null, (k + 1) * hop);
    const r = tr.read();
    if (r.value !== null) { value[k] = r.value; held[k] = r.held ? 1 : 0; }
  }
  return { value, held };
}
