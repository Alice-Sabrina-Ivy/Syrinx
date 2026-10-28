// distance-spec.mjs â€” the impulse-response spec (for distance-rir.py) and the
// chain conditions (for distance-run.mjs) of the distance / room area.
//
//   node scripts/resonance/mobile/distance-spec.mjs [--root=build/resonance-mobile/distance]
// writes <root>/rir-spec.json and <root>/conds.json ({ name: { pert: [...], ir: <name>|null, note } }).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const root = path.resolve(repo, arg("root", "build/resonance-mobile/distance"));
mkdirSync(root, { recursive: true });

// office 4 x 5 x 2.7 m, seated talker's mouth at 1.25 m, facing +y
const ROOM = [4.0, 5.0, 2.7], SRC = [1.7, 1.6, 1.25];
// phone-body shadow on the direct path (Brown & Duda 1998 form; radius ~ half the phone's
// width / length; theta = angle between the bottom-edge port's outward normal and the mouth)
const SH = { radius: 0.05, theta: 110 };        // moderate: -2 dB @ 2 kHz, -4.4 @ 4 kHz, -5.2 @ 5 kHz
const SHS = { radius: 0.06, theta: 125 };       // strong:   -3 dB @ 2 kHz, -6.7 @ 4 kHz, -7.9 @ 5 kHz
// hand partly cupping the bottom edge: a cavity resonance + an occlusion shelf (assumption)
const HAND = { peak: { fc: 2000, db: 3, q: 1.4 }, occl: { radius: 0.05, theta: 115 } };

const rir = [];
const add = (name, o) => rir.push({ name, room: ROOM, src: SRC, dir: "hf", room_on: true, ...o });
// handheld grid, RT60 0.6 s, moderate shadow
for (const d of [10, 20, 30]) for (const a of [20, 40, 60]) add(`hh-d${d}-a${a}-rt06-sh`, { dist: d / 100, angle: a, rt60: 0.6, shadow: SH });
// RT60 0.3 s diagonal
for (const [d, a] of [[10, 20], [20, 40], [30, 60]]) add(`hh-d${d}-a${a}-rt03-sh`, { dist: d / 100, angle: a, rt60: 0.3, shadow: SH });
// hand variants
add("hh-d20-a40-rt06-shhand", { dist: 0.2, angle: 40, rt60: 0.6, shadow: SH, hand: HAND });
add("hh-d30-a60-rt06-shShand", { dist: 0.3, angle: 60, rt60: 0.6, shadow: SHS, hand: HAND });
// the other directivity model (main-radiation-direction shape)
add("hh-d20-a40-rt06-sh-mrd", { dist: 0.2, angle: 40, rt60: 0.6, shadow: SH, dir: "mrd" });
// attribution: direct-path filters alone (anechoic), the room alone (omni, no shadow)
add("an-d20-a40-sh", { dist: 0.2, angle: 40, rt60: 0, room_on: false, shadow: SH });
add("an-d30-a60-shShand", { dist: 0.3, angle: 60, rt60: 0, room_on: false, shadow: SHS, hand: HAND });
add("an-a60-dir", { dist: 0.2, angle: 60, rt60: 0, room_on: false });
add("rm-d20-a40-rt06-omni", { dist: 0.2, angle: 40, rt60: 0.6, dir: "omni" });
add("rm-d30-a60-rt06-omni", { dist: 0.3, angle: 60, rt60: 0.6, dir: "omni" });
// secondary: further away (phone on a stand / desk in front, 20 deg below)
for (const d of [60, 100]) for (const rt of [3, 6]) add(`far-d${d}-a20-rt0${rt}-sh`, { dist: d / 100, angle: 20, rt60: rt / 10, shadow: SH });
// boom-mic proxies (the desktop side): a close mic at the mouth corner sees an off-axis, HF-reduced
// spectrum (Halkosaari et al. 2004); anechoic (DRR huge at 2-4 cm)
add("boom-a90", { dist: 0.03, angle: 90, rt60: 0, room_on: false });
// the phone held up in front of the mouth, port not shadowed (frontal, 20 deg below, no body shadow)
add("hh-d20-a20-rt06-nosh", { dist: 0.2, angle: 20, rt60: 0.6, a_mid: 0.18063149658138222 });
writeFileSync(path.join(root, "rir-spec.json"), JSON.stringify(rir, null, 1));

// chain conditions
const irPath = (n) => path.relative(repo, path.join(root, "rir", `${n}.f32`)).split(path.sep).join("/");
const mod = path.relative(repo, path.join(repo, "scripts/resonance/mobile/distance-mod.mjs")).split(path.sep).join("/");
const PHONE = { level: -34, noiseRelDb: -47 };  // voiced-hop RMS ~ -35.5 dBFS, pink floor 47 dB below the active level
const CLEANLVL = { level: "clean", noiseRelDb: null };
const conds = {};
const c = (name, ir, lv, note) => { conds[name] = { ir, note, pert: [{ type: "mod", path: mod, params: { ir: ir ? irPath(ir) : null, ...lv } }] }; };
c("lvl34n", null, PHONE, "level only: active -34 dBFS + pink floor -47 dB, no IR");
for (const r of rir) c(`${r.name}__p`, r.name, PHONE, "IR + phone level + noise floor");
for (const r of rir) c(`${r.name}__c`, r.name, CLEANLVL, "IR at the reader's clean level, no noise");
// far set at a physically lower level (no AGC): -34 dBFS at 0.25 m -> 20 log10(0.25 / d)
c("far-d100-a20-rt06-sh__q", "far-d100-a20-rt06-sh", { level: -34 + 20 * Math.log10(0.25 / 1.0), noiseRelDb: -47 + 20 * Math.log10(1.0 / 0.25) }, "1 m at the physically lower level (-46 dBFS), the same absolute noise floor");
// a finger / palm partly over the bottom-edge port: the core handheld position plus a 2nd-order
// low-pass (RBJ, Q 0.707; perturb.mjs "lp") — the "muffled" end of the hand variants (assumption)
for (const fc of [2500, 3500, 5000]) {
  conds[`cover${fc / 100}__c`] = { ir: "hh-d20-a40-rt06-sh", note: `core IR + lp ${fc} Hz (port partly covered), clean level`,
    pert: [conds["hh-d20-a40-rt06-sh__c"].pert[0], { type: "lp", fc, q: Math.SQRT1_2, n: 1 }] };
  conds[`cover${fc / 100}__p`] = { ir: "hh-d20-a40-rt06-sh", note: `core IR + lp ${fc} Hz (port partly covered), phone level`,
    pert: [{ ...conds["hh-d20-a40-rt06-sh__p"].pert[0], params: { ...conds["hh-d20-a40-rt06-sh__p"].pert[0].params, noiseRelDb: null } }, { type: "lp", fc, q: Math.SQRT1_2, n: 1 },
      { type: "mod", path: mod, params: { ir: null, level: null, noiseRelDb: null, noiseAbsDb: -34 - 47 } }] };
}
// harness controls with perturb.mjs's own filters (independent of distance-rir.py / distance-mod.mjs):
// a gentle HF shelf (the sign check) and the steep cuts the narrowband study found darker
conds["ctl-hshelf2k-8"] = { ir: null, note: "RBJ high shelf -8 dB above ~2 kHz (S 1)", pert: [{ type: "hshelf", fc: 2000, db: -8, s: 1 }] };
conds["ctl-lp4k-steep"] = { ir: null, note: "8th-order low-pass at 4 kHz (4 cascaded RBJ sections, Q 0.707)", pert: [{ type: "lp", fc: 4000, q: Math.SQRT1_2, n: 4 }] };
conds["ctl-tel"] = { ir: null, note: "telephone band 300-3400 Hz (hp 300 x2, lp 3400 x4)", pert: [{ type: "hp", fc: 300, q: Math.SQRT1_2, n: 2 }, { type: "lp", fc: 3400, q: Math.SQRT1_2, n: 4 }] };
writeFileSync(path.join(root, "conds.json"), JSON.stringify(conds, null, 1));
console.log(`${rir.length} impulse responses, ${Object.keys(conds).length} conditions -> ${root}`);
