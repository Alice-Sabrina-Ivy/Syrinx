// pause-validate.mjs — an independent check of pause-row.mjs's hook replay:
// the session oracle's own --voice-gate chain (scripts/session-oracle/lib:
// its own run of the REAL pitch worker with FireRedVAD, waiting for every
// chunk's message; the REAL DSP worker; the REAL hook driven through
// latestPitchRef + handleAnalysisResult, its `style` column = pitchVoiced ? 2
// : pitchHolding ? 1 : 0 per display hop) over the same rebuilt stream,
// compared hop by hop with pause-row.mjs's flags (bits 4 / 8) and intensity.
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/resonance/mobile/pause-validate.mjs --cond=clean --id=dev__174__L
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SR = 48000;
const chain = await import("../../session-oracle/lib/chain.mjs");
const VGm = await import("../../session-oracle/lib/voice-gate.mjs");
const { applyPert } = await import("./perturb.mjs");
const cond = arg("cond", "clean"), id = arg("id", "dev__174__L");
const runsDir = path.join(repo, "build/resonance-mobile/pause/runs", cond);
const rec = readdirSync(runsDir).filter((f) => /^runs-.*\.jsonl$/.test(f)).flatMap((f) => readFileSync(path.join(runsDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .find((r) => r.id === id && r.gate === "on");
const hook = readdirSync(path.join(repo, "build/resonance-mobile/pause/hook")).flatMap((f) => readFileSync(path.join(repo, "build/resonance-mobile/pause/hook", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .find((h) => h.cond === cond && h.id === id);
if (!rec || !hook) throw new Error("run / hook record missing");
const readers = JSON.parse(readFileSync(path.join(repo, "build/resonance-mobile/streams/readers-dev.json"), "utf8")).readers;
const y0 = rec.kind === "long" ? (() => { const b = readFileSync(readers.find((x) => x.id === rec.reader).variants.L); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); })() : new Float32Array(SR * 150);
const { y } = await applyPert(rec.pert, y0, SR, { id: rec.id, reader: rec.reader, sex: rec.sex, kind: rec.kind });

const S = await chain.loadSrc(path.join(repo, "src"));
const VG = await VGm.loadVoiceGate(S);
const W = await VGm.runWorkersVad(S, VG, y, SR);
const frames = VGm.buildFramesVad(W, { gate: true });
const D = await chain.driveHook(S.hookPath, frames, W.n);
// compare
const code = Buffer.from(hook.code, "base64");
let n = 0, same = 0, intenSame = 0, intenN = 0;
const confusion = {};
for (let k = 0; k < W.n; k++) {
  if (!(code[k] & 64)) continue;
  n++;
  const mine = code[k] & 4 ? 2 : code[k] & 8 ? 1 : 0;
  const theirs = D.style[k];
  if (mine === theirs) same++;
  const key = `${mine}>${theirs}`; confusion[key] = (confusion[key] ?? 0) + 1;
  if (Number.isFinite(W.col.inten[k]) || W.col.inten[k] === -Infinity) {
    intenN++;
    const a = hook.inten[k] === -999 ? -Infinity : hook.inten[k];
    const b = Number.isFinite(W.col.inten[k]) ? Math.round(W.col.inten[k] * 100) / 100 : -Infinity;
    if (a === b) intenSame++;
  }
}
// message alignment: the oracle's display messages vs chain.mjs's byChunk (pitch + decision)
const meta = JSON.parse(readFileSync(path.join(runsDir, "pitch", `${id}.json`), "utf8"));
let mN = 0, mSame = 0;
for (let k = 0; k < W.n; k++) {
  if (Number.isNaN(W.msgPitch[k])) continue;
  const c = meta.byChunk[k];
  mN++;
  if (c.length === 1 && Math.fround(c[0][1] ?? 0) === W.msgPitch[k] && (c[0][3]) === W.msgVad[k]) mSame++;
}
const out = { cond, id, hops: n, styleSame: same, confusion, intensity: { n: intenN, same: intenSame }, messages: { n: mN, sameAsRunner: mSame }, oracleStats: W.stats };
console.log(JSON.stringify(out));
mkdirSync(path.join(repo, "build/resonance-mobile/pause/validate"), { recursive: true });
writeFileSync(path.join(repo, "build/resonance-mobile/pause/validate", `${cond}__${id}.json`), JSON.stringify(out, null, 1));
process.exit(0);
