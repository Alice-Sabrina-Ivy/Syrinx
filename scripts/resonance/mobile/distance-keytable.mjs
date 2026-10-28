// distance-keytable.mjs — the condensed tables of the distance / room area from
// <root>/report.json (written by distance-report.mjs).
//   node scripts/resonance/mobile/distance-keytable.mjs [--root=build/resonance-mobile/distance]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const root = path.resolve(repo, arg("root", "build/resonance-mobile/distance"));
const R = JSON.parse(readFileSync(path.join(root, "report.json"), "utf8"));
const C = JSON.parse(readFileSync(path.join(root, "conds.json"), "utf8"));
const rir = (cond) => { const n = C[cond]?.ir; const p = n && path.join(root, "rir", `${n}.json`); return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
const g = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const s = (x) => (x == null || !Number.isFinite(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(2));
const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));
const tc = (e) => (e?.n ? `${g(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");

const groups = [
  ["Full chain (real pitch worker + FireRedVAD hear the audio), phone level (active −34 dBFS, pink floor −47 dB)", [
    ["full", "lvl34n", "level + noise floor only (no room, no filters)"],
    ["full", "hh-d20-a40-rt06-sh__p", "handheld 0.2 m, 40° below, RT60 0.6 s, moderate body shadow (core)"],
    ["full", "hh-d30-a60-rt06-sh__p", "handheld 0.3 m, 60° below, RT60 0.6 s, moderate shadow"],
    ["full", "hh-d30-a60-rt06-shShand__p", "handheld 0.3 m, 60° below, RT60 0.6 s, strong shadow + hand (worst plausible)"],
    ["full", "far-d60-a20-rt06-sh__p", "0.6 m, 20° below, RT60 0.6 s (3 m + 3 f readers)"],
    ["full", "far-d100-a20-rt06-sh__p", "1.0 m, 20° below, RT60 0.6 s (all 12 readers)"],
    ["full", "far-d100-a20-rt06-sh__q", "1.0 m as above at the physically lower level (−46 dBFS, same absolute floor; 3 + 3)"],
  ]],
  ["Attribution: clean pitch hints (only the resonance worker hears the perturbed audio), clean level, no noise", [
    ["cp", "rm-d20-a40-rt06-omni__c", "room only: 0.2 m, RT60 0.6 s, omni source on the direct path, no shadow"],
    ["cp", "rm-d30-a60-rt06-omni__c", "room only: 0.3 m, RT60 0.6 s, omni direct path"],
    ["cp", "an-a60-dir__c", "off-axis directivity only: 60° below, anechoic"],
    ["cp", "an-d20-a40-sh__c", "direct-path filters only: 40° below + moderate shadow, anechoic"],
    ["cp", "an-d30-a60-shShand__c", "direct-path filters only: 60° below + strong shadow + hand, anechoic"],
    ["cp", "hh-d20-a40-rt06-sh__c", "core handheld (room + filters)"],
    ["cp", "hh-d20-a40-rt03-sh__c", "core handheld in a RT60 0.3 s room"],
    ["cp", "hh-d20-a40-rt06-sh-mrd__c", "core handheld, main-radiation-direction directivity model"],
    ["cp", "hh-d20-a40-rt06-shhand__c", "core handheld + hand"],
    ["cp", "hh-d20-a20-rt06-nosh__c", "phone 0.2 m, 20° below, port NOT shadowed (frontal)"],
    ["cp", "hh-d10-a20-rt06-sh__c", "grid: 0.1 m, 20°"], ["cp", "hh-d10-a60-rt06-sh__c", "grid: 0.1 m, 60°"],
    ["cp", "hh-d30-a20-rt06-sh__c", "grid: 0.3 m, 20°"], ["cp", "hh-d30-a60-rt06-sh__c", "grid: 0.3 m, 60°"],
    ["cp", "hh-d30-a60-rt06-shShand__c", "worst plausible handheld"],
    ["cp", "cover50__c", "core + port partly covered: 2nd-order low-pass 5 kHz"],
    ["cp", "cover35__c", "core + 2nd-order low-pass 3.5 kHz"], ["cp", "cover25__c", "core + 2nd-order low-pass 2.5 kHz"],
    ["cp", "far-d60-a20-rt06-sh__c", "0.6 m, 20°, RT60 0.6 s"], ["cp", "far-d100-a20-rt06-sh__c", "1.0 m, 20°, RT60 0.6 s"],
    ["cp", "boom-a90__c", "BOOM-MIC PROXY: 3 cm at the mouth corner (90° off-axis HF loss), anechoic"],
    ["cp", "ctl-hshelf2k-8", "control: perturb.mjs high shelf −8 dB above ~2 kHz"],
    ["cp", "ctl-lp4k-steep", "control: 8th-order low-pass 4 kHz (\"dull mic\")"],
    ["cp", "ctl-tel", "control: telephone band 300–3400 Hz"],
  ]],
];
for (const [title, list] of groups) {
  console.log(`\n**${title}**\n`);
  console.log("| condition | DRR dB | IR @4 kHz re 250 Hz | sex | Δu bias median [IQR] | sens ratio | exc peak ratio 3 / 5 / 8 s | T50 ↑/↓ s | adm/s | voiced % | hidden % | drawn % | nbF dB |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [mode, cond, label] of list) {
    const x = R[`${mode}|${cond}|on`];
    if (!x) { console.log(`| ${label} (\`${cond}\`) | not run | | | | | | | | | | | |`); continue; }
    const ri = rir(cond);
    for (const sex of ["m", "f"]) {
      const v = x[sex];
      if (!v) continue;
      console.log(`| ${sex === "m" ? `${label} (\`${cond}\`)` : ""} | ${sex === "m" ? (ri?.roomOn ? g(ri.drrDb_0_8k, 1) : "∞") : ""} | ${sex === "m" && ri ? g(ri.totalBandDb[5] - ri.totalBandDb[1], 1) : ""} | ${sex} | ${s(v.bias)} [${s(v.biasQ1)}, ${s(v.biasQ3)}] (${v.nDarker}/${v.n}) | ${g(v.sensRatio)} (${v.nSensBelow09}/${v.n}) | ${g(v.exc3.ratio)} / ${g(v.exc5.ratio)} / ${g(v.exc8.ratio)} | ${tc(v.t50up)}/${tc(v.t50down)} | ${g(v.adm)} | ${pc(v.voiced)} | ${pc(v.hidden)} | ${pc(v.drawn)} | ${g(v.nbF, 1)} |`);
    }
  }
}
