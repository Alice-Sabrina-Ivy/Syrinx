// sets.mjs — the stream sets of the voice-detector benchmark (2026-10-06).
//
// One STREAM = the exact audio one fresh app session receives (a clip, a
// cropped mix, a corpus file), at its own sample rate. Every set resolves to
// items { id, samples, sr, audio, ref, gender, meta }:
//   audio  where a candidate reads the SAME samples, in place (nothing is
//          copied): { path (absolute), fmt "wav" | "sig16be", sr, start, len }
//          — samples [start, start + len) of that file (len is trimmed to
//          whole 25 ms chunks by dump.mjs)
//   ref    (tSec) -> reference F0 at stream time tSec: > 0 voiced (Hz),
//          0 unvoiced, -1 no reference (noise-only audio / outside every
//          voice layer of a mix)
//
// Data, read in place (public sources only — realdata.mjs isPublic):
//   NOTCHVD_ROOT            build/notchvd of the checkout that built the real
//                           corpora (noise-only clips, voice clips, mixes)
//   NOTCHVD_HELDOUT_ROOT    the second held-out noise set (default
//                           $NOTCHVD_ROOT-heldout: dcaseeval + fsheld)
//   SYRINX_CORPORA_DIR      tests/dsp/data with the gitignored FDA / PTDB-TUG
//                           audio (default: this checkout's tests/dsp/data)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWav, isPublic } from "../../notch-adversarial/realdata/realdata.mjs";
import { NOISE_SOURCES, VOICE_SOURCES, SYNTH_SOURCES, splitOf } from "../../realnoise-fv/lib/sets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

export const SET_NAMES = ["noise", "noiseho", "vin20", "vin0", "fda", "ptdb", "voc", "hil", "vocalset", "pvqd", "voiced"];
// what each set is for (score.py reads the same table)
export const SET_ROLE = {
  noise: "noise-only, 279 public clips (first 90 s); split tune 194 / held 85 by noise source",
  noiseho: "noise-only, second held-out set (dcaseeval 18 + fsheld 101; first 90 s)",
  vin20: "voice in real noise, +10 / 0 dB, mixes as built (20 s noise-only lead, 5 s tail)",
  vin0: "voice in real noise, +10 / 0 dB, cropped so the voice starts with the stream (lead 0)",
  fda: "FDA read speech (20 kHz, laryngograph reference)",
  ptdb: "PTDB-TUG read speech (48 kHz, laryngograph reference, +20 ms offset)",
  voc: "vocadito solo singing (44.1 kHz, annotated F0)",
  hil: "Hillenbrand /hVd/ vowels (16 kHz, vowdata F0 over the central 70 %)",
  vocalset: "VocalSet long tones — held notes (forte / pp / straight / messa; Praat F0)",
  pvqd: "PVQD clinical sustained vowels + CAPE-V sentences (dysphonic / breathy; Praat F0; gender unknown)",
  voiced: "VOICED clinical sustained /a/ (dysphonic; 8 kHz origin; Praat F0)",
};

const env = (k, d) => process.env[k] || d;
function notchvdRoot() {
  const r = process.env.NOTCHVD_ROOT;
  if (!r) throw new Error("set NOTCHVD_ROOT to the real-data corpora root (build/notchvd of the checkout that built them)");
  return resolve(r);
}
const heldoutRoot = () => resolve(env("NOTCHVD_HELDOUT_ROOT", notchvdRoot() + "-heldout"));
const corporaDir = () => resolve(env("SYRINX_CORPORA_DIR", join(REPO, "tests/dsp/data")));

// realdata.mjs loadIndex semantics, for any root (index_<kind>.json, else the
// per-source manifests): public only, exact duplicates dropped
function loadIndex(root, kind, f = {}) {
  const data = join(root, "data");
  const p = join(data, `index_${kind}.json`);
  let recs;
  if (existsSync(p)) recs = JSON.parse(readFileSync(p, "utf8"));
  else {
    recs = [];
    const d = join(data, "manifests");
    for (const fn of readdirSync(d)) if (fn.startsWith(kind + ".") && fn.endsWith(".json")) recs.push(...JSON.parse(readFileSync(join(d, fn), "utf8")));
  }
  return recs.filter((r) => (f.source == null || [].concat(f.source).includes(r.source)) && (f.set == null || r.set === f.set)
    && (f.minDur == null || r.dur >= f.minDur) && (f.noDup === false || !r.dup_of) && isPublic({ kind, ...r }));
}

const genderOf = (g) => (g === "w" || g === "f" ? "f" : g === "m" ? "m" : "unknown");

function praatRef(root, f0Path, which = "praat") {
  const p = join(root, "data", f0Path);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"))[which];
  if (!j) return null;
  return { t0: j.t0 ?? 0, hop: j.hop, f0: Float32Array.from(j.f0) };
}
const atPraat = (r, t) => { const i = Math.round((t - r.t0) / r.hop); return i >= 0 && i < r.f0.length ? r.f0[i] : 0; };

function wavItem(path) {
  const { samples, sampleRate } = readWav(path);
  return { samples, sr: sampleRate, audio: { path, fmt: "wav", sr: sampleRate, start: 0, len: samples.length } };
}

// ---- noise-only -------------------------------------------------------------
function noiseItems(which, maxSec = 90) {
  let recs, root;
  if (which === "noise") {
    root = notchvdRoot();
    recs = loadIndex(root, "noise", { minDur: 10 })
      .filter((r) => NOISE_SOURCES.includes(r.source) && r.label !== "floor" && r.class !== "floor");
  } else {
    root = heldoutRoot();
    recs = loadIndex(root, "noise", { minDur: 10, source: ["dcaseeval", "fsheld"] });
  }
  recs.sort((a, b) => a.id.localeCompare(b.id));
  return recs.map((r) => ({
    id: r.id, gender: "na",
    load() {
      const it = wavItem(join(root, "data", r.path));
      if (it.sr !== 16000) throw new Error(`${r.id}: ${it.sr} Hz`);
      const len = Math.min(it.samples.length, maxSec * it.sr);
      it.samples = it.samples.subarray(0, len); it.audio.len = len;
      return it;
    },
    ref: () => -1,
    meta: { source: r.source, cls: r.class, label: r.label ?? `ho-${r.source}`, split: which === "noise" ? splitOf(r.id) : r.source, dur: r.dur },
  }));
}

// ---- voice in noise (mixes) ---------------------------------------------------
function vinItems(lead) {
  const root = notchvdRoot();
  const voice = loadIndex(root, "voice", { noDup: false });
  const noise = loadIndex(root, "noise", { noDup: false });
  const vp = new Map(voice.map((r) => [r.path, r])), np = new Map(noise.map((r) => [r.path, r]));
  const nid = new Map(noise.map((r) => [r.id, r]));
  const mixes = loadIndex(root, "mix", { set: "voice_in_noise", noDup: false }).filter((m) => m.spec.layers.every((L) => {
    const s = (vp.get(L.clip) ?? np.get(L.clip))?.source;
    return s !== undefined && (VOICE_SOURCES.includes(s) || NOISE_SOURCES.includes(s) || SYNTH_SOURCES.includes(s));
  })).sort((a, b) => a.id.localeCompare(b.id));
  const f0Cache = new Map();
  return mixes.map((m) => {
    const layers = m.spec.layers.filter((L) => vp.has(L.clip)).map((L) => {
      const v = vp.get(L.clip);
      if (!f0Cache.has(v.f0_path)) f0Cache.set(v.f0_path, v.f0_path ? praatRef(root, v.f0_path) : null);
      return { L, f: f0Cache.get(v.f0_path), gender: genderOf(v.gender), source: v.source };
    });
    const genders = [...new Set(layers.map((x) => x.gender))];
    const crop = lead === null ? 0 : Math.max(0, m.voice_t0 - lead);
    const c0 = Math.round(crop * 16000);
    // = vinscore.py truth(): Praat F0 of each voice layer on the mix timeline
    // (a later layer overwrites an earlier one; -1 outside every voice layer)
    const truthMix = (tm) => {
      let out = -1;
      for (const { L, f } of layers) {
        if (!f || tm < L.at || tm > L.at + L.len) continue;
        out = atPraat(f, tm - L.at + (L.from ?? 0));
      }
      return out;
    };
    const nrec = nid.get(m.noise_id);
    return {
      id: m.id, gender: genders.length === 1 ? genders[0] : "unknown",
      load() {
        const it = wavItem(join(root, "data", m.path));
        if (it.sr !== 16000) throw new Error(`${m.id}: ${it.sr} Hz`);
        it.samples = it.samples.subarray(c0); it.audio.start = c0; it.audio.len = it.samples.length;
        return it;
      },
      ref: (t) => truthMix(t + c0 / 16000),
      crop: c0 / 16000,
      holds: (m.holds ?? []).map(([a, b]) => [a - c0 / 16000, b - c0 / 16000]),
      meta: { snr_db: m.snr_db, lead: lead === null ? 20 : lead, crop_s: c0 / 16000, voice: m.voice, voice_kind: m.voice_kind, voice_source: layers[0]?.source,
        voice_t0: m.voice_t0 - c0 / 16000, voice_t1: m.voice_t1 - c0 / 16000, noise_id: m.noise_id, noise_label: m.noise_label,
        noise_source: nrec?.source, noise_class: nrec?.class, split: splitOf(m.noise_id) },
    };
  });
}

// ---- ground-truth corpora (tests/dsp/data/corpora.js conventions) ------------
async function corpusItems(set) {
  const dir = corporaDir();
  process.env.SYRINX_CORPORA_DIR = dir;
  const C = await import("../../../tests/dsp/data/corpora.js");
  const [loader, off] = { fda: [C.loadFda, 0], ptdb: [C.loadPtdbTug, 20], hil: [C.loadHillenbrand, 0], voc: [C.loadVocadito, 0] }[set];
  const tracks = loader();
  if (!tracks.length) throw new Error(`${set}: no tracks under ${dir} (set SYRINX_CORPORA_DIR to a checkout with the corpus audio)`);
  return tracks.map((t) => {
    let path, fmt = "wav";
    if (set === "fda") { path = join(dir, "fda", t.gender === "m" ? "rl" : "sb", `${t.trackId}.sig`); fmt = "sig16be"; }
    else if (set === "ptdb") path = join(dir, "ptdb-tug", t.gender === "f" ? "FEMALE" : "MALE", "MIC", t.trackId.split("_")[1], `${t.trackId}.wav`);
    else if (set === "hil") path = join(dir, t.gender === "m" ? "men" : "women", `${t.trackId}.wav`);
    else path = join(dir, "vocadito", "Audio", `${t.trackId}.wav`);
    if (!existsSync(path)) throw new Error(`${set}/${t.trackId}: audio path ${path} not found`);
    const { f0, hopMs } = t.ref;
    return {
      id: t.trackId, gender: genderOf(t.gender),
      load() { return { samples: t.samples, sr: t.sampleRate, audio: { path, fmt, sr: t.sampleRate, start: 0, len: t.samples.length } }; },
      ref: (tSec) => { const i = Math.round((tSec * 1000 - off) / hopMs); return i >= 0 && i < f0.length ? f0[i] : 0; },
      meta: { corpus: set, ref_offset_ms: off },
    };
  });
}

// ---- real voice clips of the notchvd corpora (Praat F0, held segments) -------
function voiceClipItems(source) {
  const root = notchvdRoot();
  const recs = loadIndex(root, "voice", { source }).sort((a, b) => a.id.localeCompare(b.id));
  return recs.map((r) => {
    const f = r.f0_path ? praatRef(root, r.f0_path) : null;
    if (!f) throw new Error(`${r.id}: no Praat F0`);
    return {
      id: r.id, gender: genderOf(r.gender),
      load() { const it = wavItem(join(root, "data", r.path)); if (it.sr !== 16000) throw new Error(`${r.id}: ${it.sr} Hz`); return it; },
      ref: (t) => atPraat(f, t),
      holds: (r.held ?? []).map((h) => [h[0], h[1]]),
      meta: { source: r.source, cls: r.class, singer: r.singer, diagnosis: r.diagnosis, capev_severity: r.capev_severity, f0_median: r.f0_median },
    };
  });
}

export async function setItems(set) {
  if (set === "noise" || set === "noiseho") return noiseItems(set);
  if (set === "vin20") return vinItems(null);
  if (set === "vin0") return vinItems(0);
  if (["fda", "ptdb", "hil", "voc"].includes(set)) return corpusItems(set);
  if (["vocalset", "pvqd", "voiced"].includes(set)) return voiceClipItems(set);
  throw new Error(`unknown set ${set} (${SET_NAMES.join(", ")})`);
}
