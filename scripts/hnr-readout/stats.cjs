// stats.cjs — summarises probe.mjs runs: the HNR readout while the pitch row
// is live (speaking). The readout element also holds an invisible sizing copy
// "HNR -00 dB"; only the visible value is read.
//   node scripts/hnr-readout/stats.cjs <dir with probe JSON files>
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const visible = (t) => {
  if (!t) return null;
  const v = [...t.matchAll(/HNR\s*(—|-?\d+)/g)].map((x) => x[1]).filter((x) => x !== "-00").at(-1);
  return v === undefined || v === "—" ? null : Number(v);
};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const live = j.samples.filter((s) => s.pitch === "live");
  const nums = live.map((s) => visible(s.hnr)).filter((x) => x !== null);
  const srt = [...nums].sort((a, b) => a - b);
  const q = (p) => srt[Math.floor(p * (srt.length - 1))];
  let changes = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1]) changes++;
  console.log(`${f}: n ${nums.length} (+${live.length - nums.length} "—") median ${q(0.5)} q10 ${q(0.1)} q90 ${q(0.9)} ` +
    `negative ${(100 * nums.filter((x) => x < 0).length / nums.length).toFixed(1)} % changes/s ${(changes / (nums.length / 4)).toFixed(2)}`);
}
