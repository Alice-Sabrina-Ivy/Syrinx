// level-decomp.mjs — how much of each condition's change comes from the voice
// gate vs from everything else (pitch voicing loss, the audio itself):
//   rest = gate off - clean (gate off);   gate = gate on - gate off (same condition)
// from level-summarize.mjs --json output.
//   node scripts/resonance/mobile/level-decomp.mjs build/resonance-mobile/level/level-summary.json
import { readFileSync } from "node:fs";
const S = JSON.parse(readFileSync(process.argv[2], "utf8"));
const conds = [...new Set(Object.values(S).map((x) => x.cond))].filter((c) => c !== "clean");
const ex = (o, sex, D) => o.excTable[`${sex}|${D}`];
const get = (o, sex) => ({
  vo: o.per[sex].voicedShare * 100, hid: o.per[sex].hiddenShare * 100, adm: o.per[sex].admPerS, fd: o.per[sex].firstDrawn, dr: o.per[sex].drawnShare * 100,
  t50: (o.per[sex].t50up.med + o.per[sex].t50down.med) / 2, e3: ex(o, sex, 3).peak, e5: ex(o, sex, 5).peak, sens: o.per[sex].sensRatio, bias: o.per[sex].bias,
});
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
console.log("| cond | sex | part | voiced % | adm/s | first drawn s | drawn % | T50 mean ↑↓ s | 3 s exc peak u | 5 s exc peak u | sens ratio | bias u |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
const c0 = { on: S["clean|on"], off: S["clean|off"] };
for (const c of conds) for (const sex of ["m", "f"]) {
  const on = S[`${c}|on`], off = S[`${c}|off`];
  if (!on || !off) continue;
  const a = get(c0.off, sex), b = get(off, sex), d = get(on, sex);
  const row = (label, x, y) => console.log(`| ${c} | ${sex} | ${label} | ${f(y.vo - x.vo, 1)} | ${f(y.adm - x.adm)} | ${f(y.fd - x.fd, 1)} | ${f(y.dr - x.dr, 1)} | ${f(y.t50 - x.t50, 1)} | ${f(y.e3 - x.e3)} | ${f(y.e5 - x.e5)} | ${f(y.sens - x.sens)} | ${f(y.bias - x.bias)} |`);
  row("rest (off − clean)", a, b);
  row("gate (on − off)", b, d);
}
