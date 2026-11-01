// ft-clips.mjs — the G-FT foreground-talker clips of the narrower resonance-row
// hold round (measurements/resonance-row-hold-narrow-2026-11-01.md §4.5).
//
//   python -P scripts/resonance/faster-prep.py --libri="C:/Coding Projects/Syrinx-cache/resonance-lab/data" \
//     --split=dev-clean --tag=ft --n=9 --fill --out=build/resonance-mobile/narrow/ft-prep
//   node scripts/resonance/mobile/ft-clips.mjs [--prep=build/resonance-mobile/narrow/ft-prep]
//        [--out=build/resonance-mobile/narrow/ft-clips] [--dev=build/resonance-mobile/streams/readers-dev.json]
//
// The talkers: the readers of faster-prep's ft list (the first 9 men and 9
// women of dev-clean by numeric id that pass its 54 s / 150 s rule) that are
// not dev readers — 3 men and 3 women (planned: men 2078, 2086, 2428; women
// 2035, 2277, 2412). From each talker's 150 s 16 kHz long stream (utterances
// with their 0.3 s exact-zero gaps), two clips: [0, 60) s and [60, 120) s,
// ids ft__<spk>__0 and ft__<spk>__1, mono PCM16 WAV at 16 kHz in
// <out>/clips/<id>.wav (LibriSpeech's samples are int16 / 32768, so the PCM16
// copy is exact; checked). List: <out>/ft-list.json (id, speaker, sex,
// family "talker", sha256 of each WAV). Public data only (LibriSpeech, CC BY 4.0).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const PREP = path.resolve(repo, arg("prep", "build/resonance-mobile/narrow/ft-prep"));
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/narrow/ft-clips"));
const DEV = path.resolve(repo, arg("dev", "build/resonance-mobile/streams/readers-dev.json"));
const SR = 16000, CLIP_S = 60;
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };

export function wavPcm16Mono(x, sr) {
  const n = x.length, b = Buffer.alloc(44 + 2 * n);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + 2 * n, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(2 * sr, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(2 * n, 40);
  let inexact = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768)));
    if (v / 32768 !== x[i]) inexact++;
    b.writeInt16LE(v, 44 + 2 * i);
  }
  return { buf: b, inexact };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const devSpk = new Set(JSON.parse(readFileSync(DEV, "utf8")).readers.map((r) => String(r.speaker)));
  const ft = JSON.parse(readFileSync(path.join(PREP, "src-ft.json"), "utf8")).filter((r) => !devSpk.has(String(r.speaker)));
  for (const s of ["m", "f"]) if (ft.filter((r) => r.sex === s).length !== 3) throw new Error(`expected 3 talkers of sex ${s}, got ${ft.filter((r) => r.sex === s).map((r) => r.speaker)}`);
  mkdirSync(path.join(OUT, "clips"), { recursive: true });
  const clips = [];
  for (const r of ft) {
    const long16 = readF32(r.long);
    if (long16.length < 120 * SR) throw new Error(`${r.id}: long stream ${long16.length / SR} s`);
    for (const j of [0, 1]) {
      const id = `ft__${r.speaker}__${j}`;
      const { buf, inexact } = wavPcm16Mono(long16.subarray(j * CLIP_S * SR, (j + 1) * CLIP_S * SR), SR);
      if (inexact) throw new Error(`${id}: ${inexact} samples not exactly int16 / 32768`);
      writeFileSync(path.join(OUT, "clips", `${id}.wav`), buf);
      clips.push({ id, source: "ft", cls: "foreground talker", sub: `dev-clean ${r.speaker}`, family: "talker", speaker: String(r.speaker), sex: r.sex,
        offsetS: j * CLIP_S, durS: CLIP_S, sr: SR, clipSha256: createHash("sha256").update(buf).digest("hex") });
      console.log(`${id} (${r.sex})`);
    }
  }
  writeFileSync(path.join(OUT, "ft-list.json"), JSON.stringify({ note: "G-FT talker clips (measurements/resonance-row-hold-narrow-2026-11-01.md §4.5); LibriSpeech dev-clean, CC BY 4.0", clips }, null, 1));
  console.log(`${clips.length} clips -> ${path.join(OUT, "ft-list.json")}`);
}
