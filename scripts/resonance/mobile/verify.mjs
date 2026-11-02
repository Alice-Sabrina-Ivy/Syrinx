// verify.mjs — chain.mjs (no perturbation, gate on, hint delay 0) against the
// study harness itself: `faster.mjs pitch` + `faster.mjs bins` on the same
// streams. Checks, per common stream id: the pitch worker's per-chunk posts
// (chain.mjs's cache vs faster.mjs's pitch JSON), and the bins run record —
// n, nbResets, every bin and every post, field for field. Also prints the
// real-worker parity counts chain.mjs logged (--worker).
//
//   node scripts/resonance/mobile/verify.mjs --chain=<cond dir of chain.mjs> --faster-root=<faster.mjs --root> \
//        --faster-bins=<faster.mjs bins jsonl,...>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const chainDir = path.resolve(arg("chain", ""));
const fRoot = path.resolve(arg("faster-root", ""));
const readJsonl = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const chain = readdirSync(chainDir).filter((f) => /^runs-.*\.jsonl$/.test(f)).flatMap((f) => readJsonl(path.join(chainDir, f))).filter((r) => r.gate === "on" && r.hintDelay === 0);
const fast = new Map(arg("faster-bins", "").split(",").filter(Boolean).flatMap((f) => readJsonl(f)).map((r) => [r.id, r]));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0, nIds = 0, nPosts = 0, nBins = 0, nHops = 0, wChk = 0, wMis = 0;
for (const c of chain) {
  if (c.pert.length) { console.log(`${c.id}: perturbed run, skipped`); continue; }
  if (c.worker) { wChk += c.worker.checked; wMis += c.worker.mismatch; }
  const f = fast.get(c.id);
  if (!f) { console.log(`${c.id}: no faster.mjs record`); continue; }
  nIds++;
  const errs = [];
  // pitch worker output
  const cp = JSON.parse(readFileSync(path.join(chainDir, "pitch", `${c.id}.json`), "utf8"));
  const fpf = path.join(fRoot, "pitch", `${c.id}.json`);
  if (existsSync(fpf)) {
    const fp = JSON.parse(readFileSync(fpf, "utf8"));
    if (fp.byChunk.length !== cp.byChunk.length) errs.push(`pitch chunks ${cp.byChunk.length} vs ${fp.byChunk.length}`);
    else fp.byChunk.forEach((x, k) => { nHops += x.length; if (!eq(x, cp.byChunk[k])) errs.push(`pitch chunk ${k}`); });
  } else errs.push("faster.mjs pitch JSON missing");
  for (const k of ["n", "nbResets", "kind", "variant", "seq", "joins", "trail"]) if (!eq(c[k], f[k])) errs.push(k);
  if (c.bins.length !== f.bins.length) errs.push(`bins ${c.bins.length} vs ${f.bins.length}`);
  else c.bins.forEach((b, i) => { if (!eq(b, f.bins[i])) errs.push(`bin ${i}`); });
  if (c.posts.length !== f.posts.length) errs.push(`posts ${c.posts.length} vs ${f.posts.length}`);
  else c.posts.forEach((p, i) => p.forEach((v, j) => { if (!Object.is(v, f.posts[i][j])) errs.push(`post ${i} field ${j}: ${v} vs ${f.posts[i][j]}`); }));
  nPosts += c.posts.length; nBins += c.bins.length;
  if (errs.length) bad++;
  console.log(`${c.id}: ${errs.length ? `DIFFERS (${errs.slice(0, 5).join("; ")}${errs.length > 5 ? ` … ${errs.length} total` : ""})` : `equal — ${c.bins.length} bins, ${c.posts.length} posts x 15 fields`}`);
}
console.log(`\nchain.mjs vs faster.mjs: ${nIds - bad}/${nIds} streams equal (${nHops} pitch hops, ${nBins} bins, ${nPosts} posts)`);
if (wChk) console.log(`chain.mjs replica vs the REAL resonance worker: ${wChk - wMis}/${wChk} posts equal`);
process.exit(bad || !nIds ? 1 : 0);
