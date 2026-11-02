// audit-chain.mjs — phone-vs-desktop audit (resonance cue), step 2: the REAL
// resonance worker (src/resonance/resonance-worker.js, fake self, diag on)
// fed a stream's audio chunks and the pitch posts of audit-pitch.mjs, relayed
// as the hook relays them (voice gate on: voiced:false where the detector
// said no voice), under a DELIVERY SCHEDULE for the relayed hints — the part
// of the chain that depends on thread timing (main-thread relay, async voice
// detector, bursty MSTP delivery).
//
//   node scripts/resonance/mobile/audit-chain.mjs --cond=c0 --streams=L,N,U10,NUN
//        --scheds=imm,d4,d20 [--gate=on|off] [--readers=...] [--shard=i/n]
//
// Schedules (k = the chunk whose pitch-worker step posted the hints; one chunk
// = 25 ms of audio; the worker's audio chunks are always delivered in order):
//   imm      hints delivered right after chunk k (the Node harnesses' order;
//            what a desktop with an idle main thread approximates)
//   dN       every hint N chunks late (after chunk k + N): a steady relay lag
//            of N x 25 ms (pitch worker / voice detector queue, main thread)
//   jN       a random 0..N-chunk lag per step, order kept (seeded per stream)
//   stM:P    a main-thread stall of M ms every P s: the stall's chunks reach
//            the worker in one burst at its end and their hints one chunk
//            after the burst (MSTP reader and relay both on the main thread)
// Per stream one JSON line: every state post (k, u, uPlain, fill, voicedS,
// verdict, sinceResumeS, startU, shownStartU, nb.on, nb.decided, nb.f,
// framesDropped, binsAdmitted, binsDropped, gridForcedUnvoiced) plus the
// cue-strip row state (cueStripModel.resonanceRowState) with the display's
// voiced / holding flags approximated from the delivered gated hints
// (voiced: a gated voiced hint within 0.4 s of the newest delivered hint —
// the hook's pitch hold; holding: within 5 s — its silence hold).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyCond, streamsFor } from "./audit-pitch.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const SR = 48000, CH = 1200;
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/audit"));
const turn = () => new Promise((r) => setImmediate(r));
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const ROWS = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hashStr(t) { let h = 2166136261; for (const c of t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** -> deliverAfter[k]: the chunk index after which step k's hints are delivered. */
function schedule(spec, nC, seedStr) {
  const d = new Int32Array(nC);
  let m;
  if (spec === "imm") { for (let k = 0; k < nC; k++) d[k] = k; }
  else if ((m = /^d(\d+)$/.exec(spec))) { const N = +m[1]; for (let k = 0; k < nC; k++) d[k] = k + N; }
  else if ((m = /^j(\d+)$/.exec(spec))) {
    const N = +m[1], r = rng(hashStr(seedStr + spec));
    let prev = 0;
    for (let k = 0; k < nC; k++) { const v = Math.max(prev, k + Math.floor(r() * (N + 1))); d[k] = v; prev = v; }
  } else if ((m = /^st(\d+):([\d.]+)$/.exec(spec))) {
    const M = Math.round(+m[1] / 25), P = Math.round(+m[2] * 40);
    for (let k = 0; k < nC; k++) {
      const ph = k % P; // stall covers chunks with phase in [P - M, P)
      d[k] = ph >= P - M ? (k - ph + P - 1) + 1 : k;
    }
  } else throw new Error(`unknown schedule ${spec}`);
  return d;
}

const cond = arg("cond", "c0");
const scheds = arg("scheds", "imm").split(",").filter(Boolean);
const gate = arg("gate", "on");
const streams = arg("streams", "L,N,U10,NUN").split(",").filter(Boolean);
const readersJson = path.resolve(repo, arg("readers", "build/resonance-mobile/streams/readers-dev.json"));
let items = streamsFor(readersJson, streams);
const only = new Set(arg("only", "").split(",").filter(Boolean));
if (only.size) items = items.filter((it) => only.has(it.reader) || only.has(it.id));
const [si, sn] = arg("shard", "0/1").split("/").map(Number);
let jobs = [];
for (const s of scheds) for (const it of items) jobs.push({ ...it, sched: s });
jobs = jobs.filter((_, i) => i % sn === si);

const frozen = { now: () => 0, timeOrigin: 0, mark() {}, measure() {} };
Object.defineProperty(globalThis, "performance", { value: frozen, configurable: true, writable: true });
const resDir = path.join(repo, "public/resonance-lab");
let wposts = [];
globalThis.self = { postMessage: (m) => wposts.push(m) };
globalThis.fetch = async (url) => {
  const file = path.join(resDir, String(url).split("resonance-lab/").pop());
  if (!existsSync(file)) return { ok: false, status: 404 };
  const txt = readFileSync(file, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
await imp("src/resonance/resonance-worker.js");
const resOn = self.onmessage;
const { resonanceRowState } = await imp("src/components/cueStripModel.js");

const outDir = path.join(OUT, "chain");
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
let audioS = 0;
for (const it of jobs) {
  const out = path.join(outDir, `${cond}__${it.sched}__g${gate}.jsonl`);
  if (existsSync(out) && readFileSync(out, "utf8").split("\n").some((l) => l.startsWith(`{"id":"${it.id}"`))) continue;
  const pf = path.join(path.resolve(repo, arg("pitch", path.join(OUT, "pitch"))), cond, `${it.id}.json`);
  if (!existsSync(pf)) { console.log(`skip ${cond}/${it.id}: no pitch run`); continue; }
  const meta = JSON.parse(readFileSync(pf, "utf8"));
  const y = applyCond(it.load(), cond);
  const nC = meta.byChunk.length;
  const del = schedule(it.sched, nC, it.id);
  // delivery lists: after chunk j, the steps whose deliverAfter == j (in order)
  const after = new Map();
  for (let k = 0; k < nC; k++) { const j = Math.min(del[k], nC - 1 + 1000); if (!after.has(j)) after.set(j, []); after.get(j).push(k); }
  wposts = [];
  resOn({ data: { type: "init", sampleRate: SR, assetBase: "/", diag: true } });
  for (let i = 0; i < 200 && !wposts.some((m) => m.type === "status" && m.status !== "loading"); i++) await turn();
  if (!wposts.some((m) => m.type === "status" && m.status === "ready")) throw new Error("resonance worker not ready");
  const port = {};
  resOn({ data: { type: "audioPort", port } });
  let newestCt = -Infinity, lastGV = -Infinity, nHints = 0, nVoicedPosted = 0, nHidden = 0;
  const posts = [];
  const deliver = (k) => {
    for (const m of meta.byChunk[k]) {
      const hid = gate === "on" && m[3] === 0;
      const h = { type: "pitch-hint", voiced: hid ? false : !!m[0], pitch: m[1], contextTime: m[2] };
      if (m[0]) { nVoicedPosted++; if (hid) nHidden++; }
      resOn({ data: h });
      nHints++;
      if (typeof m[2] === "number") { newestCt = Math.max(newestCt, m[2]); if (h.voiced) lastGV = m[2]; }
    }
  };
  for (let k = 0; k < nC; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = Math.min(y.length, (k + 1) * CH) / SR;
    const before = wposts.length;
    port.onmessage({ data: { buffer: x.buffer, contextTime: ct } });
    for (const m of wposts.slice(before)) {
      if (m.type === "status") posts.push([k, "status:" + m.status]);
      if (m.type !== "state") continue;
      const voiced = newestCt - lastGV <= 0.4;
      const holding = !voiced && newestCt - lastGV <= 5;
      const row = resonanceRowState({ workerStatus: "ready", snap: m, voiced, holding });
      posts.push([k, m.u, m.uPlain, m.fill, m.voicedS, VERD.indexOf(m.verdict), m.sinceResumeS, m.startU, m.shownStartU,
        m.narrowband.on ? 1 : 0, m.narrowband.decided ? 1 : 0, m.narrowband.f === null ? null : +m.narrowband.f.toFixed(2),
        m.framesDropped, m.perf?.binsAdmitted ?? null, m.perf?.binsDropped ?? null, m.perf?.gridForcedUnvoiced ?? null, ROWS.indexOf(row),
        newestCt === -Infinity ? null : +(ct - newestCt).toFixed(3)]);
    }
    for (const kk of after.get(k) ?? []) deliver(kk);
  }
  for (const [j, ks] of [...after.entries()].sort((a, b) => a[0] - b[0])) if (j >= nC) for (const kk of ks) deliver(kk);
  const rec = { id: it.id, reader: it.reader, sex: it.sex, stream: it.stream, cond, sched: it.sched, gate, nC,
    hidden: { voicedPosted: nVoicedPosted, hidden: nHidden }, posts };
  appendFileSync(out, JSON.stringify(rec) + "\n");
  audioS += nC * CH / SR;
  console.log(`${cond}/${it.sched}/g${gate} ${it.id} posts ${posts.length} [${(audioS / ((Date.now() - t0) / 1000)).toFixed(1)}x]`);
}
process.exit(0);
