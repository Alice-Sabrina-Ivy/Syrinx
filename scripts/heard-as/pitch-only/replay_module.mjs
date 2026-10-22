// replay_module.mjs — replay session.mjs outputs (natural reading) through the
// shipped src/ml/pitch-only-warning.js and, optionally, an older copy of it
// (--old=<file>), as the app feeds it: posted pitch frames, then the 2 s
// tick's resonance snapshot and the panel's ln F0 (null when hidden).
// Prints, per session, the share of eligible updates with the warning on
// and the start reference P0 against the session's median pitch.
// Review round 2 (measurements/heard-as-panel-review-2-2026-10-07.md §6):
// fresh LibriSpeech dev-clean readers and jittered starts (jobs built by
// dropping a reader's first k utterances).
//
//   node replay_module.mjs out/*.jsonl [--old=<path to an older module>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const NEW = await import(pathToFileURL(path.join(here, "../../../src/ml/pitch-only-warning.js")).href);
const oldArg = process.argv.find((a) => a.startsWith("--old="));
const OLD = oldArg ? await import(pathToFileURL(path.resolve(oldArg.slice(6))).href) : NEW;
const rows = [];
for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) for (const l of readFileSync(f, "utf8").split("\n")) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  const out = { key: r.key, sex: r.meta.sex, skip: r.meta.skip ?? 0 };
  for (const [name, M] of [["old", OLD], ["new", NEW]]) {
    const w = M.createPitchOnlyWarning();
    let i = 0, elig = 0, on = 0, vis = 0, onVis = 0;
    for (const t of r.ticks) {
      const tMs = t.t * 1000;
      while (i < r.pitch.length && r.pitch[i][0] <= tMs) { w.addPitch({ audioMs: r.pitch[i][0], f0: r.pitch[i][1] }); i++; }
      const snap = { u: t.r.u, startU: t.r.su, fill: t.r.fill, verdict: t.r.vd, sinceResumeS: t.r.sr };
      w.noteResonance(snap, tMs);
      const lnF0 = t.e && "f" in t.e ? t.e.f : null;
      const isOn = w.update({ lnF0, resonance: snap });
      const e = M.pitchOnlyEligible({ lnF0, p0: w.pitchStart(), resonance: snap });
      if (lnF0 != null) { vis++; if (isOn) onVis++; }
      if (e) { elig++; if (isOn) on++; }
    }
    out[name] = { elig, on, share: elig ? on / elig : 0, vis, onVis };
    if (name === "new") {
      const v = r.pitch.map((p) => p[1]).filter((x) => x > 0).sort((a, b) => a - b);
      const med = v[v.length >> 1];
      out.p0Hz = w.pitchStart() == null ? null : Math.exp(w.pitchStart());
      out.p0St = out.p0Hz == null ? null : 12 * Math.log2(out.p0Hz / med);
      out.medHz = med;
    }
  }
  rows.push(out);
}
rows.sort((a, b) => a.key.localeCompare(b.key));
for (const r of rows) console.log(`${r.key.padEnd(18)} ${r.sex} skip ${r.skip}: P0 ${r.p0Hz?.toFixed(1)} Hz (${r.p0St?.toFixed(2)} st vs session median ${r.medHz.toFixed(1)}) | old ${r.old.on}/${r.old.elig} = ${(100 * r.old.share).toFixed(1)} % | new ${r.new.on}/${r.new.elig} = ${(100 * r.new.share).toFixed(1)} % (of shown ${r.new.onVis}/${r.new.vis})`);
const byReader = {};
for (const r of rows) (byReader[r.key.replace(/_skip\d+$/, "")] ??= []).push(r);
for (const [k, g] of Object.entries(byReader)) {
  const sh = g.map((r) => 100 * r.new.share);
  console.log(`${k}: new-module share over ${g.length} starts: min ${Math.min(...sh).toFixed(1)} % median ${sh.sort((a, b) => a - b)[sh.length >> 1].toFixed(1)} % max ${Math.max(...sh).toFixed(1)} %`);
}
