"""build_streams.py -- the streams of measurements/heard-as-voiced-windows-2026-10-08.md.

  python build_streams.py --out=<dir> --pwhis=<probe dir> --r1=<jobs_r1.json> --r1dev=<jobs_r1dev.json>
         --pov=<jobs_pov.json> --chanx=<jobs+meta dir> --palone=<probe dir> --smoke=<build/cue-strip-smoke>

Writes <out>/jobs.json: [{ id, set, f32, sr, sex, ... }] (float32 mono files,
16 kHz unless sr says 48000) and the mixed / concatenated audio under <out>/f32/.
Sets:
  whis    speech + whisper per pwhis talker: 6 s pieces of the talker's regular
          reading alternating with 3 s pieces of the same talker's whisper (natural
          relative level; whisper pieces cycle), starting and ending with regular;
          `whisper` = [[startMs, endMs], ...] of the whisper pieces.
  whissil the same streams with each whisper piece replaced by digital silence.
  r1, r1dev  each reader's five utterances joined with 0.3 s gaps (hop-study.mjs).
  pov     the 240 Palette stimuli as they are (48 kHz).
  chanx   the frozen low-voice evaluator's 38 talkers x 12 conditions (lead 2 s).
  palone  MUSDB18 instrumental (mi) / full mix (mv) at 0 / -10 / -20 dB, nobody at the mic.
  synth   held vowel, pink noise, digital silence (48 kHz WAVs of scripts/cue-strip-smoke-wavs.mjs).
Public data only (LibriSpeech, Palette, EARS / Expresso via the probe set, MUSDB18).
"""
import argparse, json, os, struct
import numpy as np

ap = argparse.ArgumentParser()
for k in ["out", "pwhis", "r1", "r1dev", "pov", "chanx", "palone", "smoke"]:
    ap.add_argument(f"--{k}", required=True)
a = ap.parse_args()
SR = 16000
os.makedirs(os.path.join(a.out, "f32"), exist_ok=True)
rd = lambda p: np.fromfile(p, dtype="<f4")
def wr(name, x):
    p = os.path.join(a.out, "f32", name + ".f32")
    np.asarray(x, dtype="<f4").tofile(p)
    return p
jobs = []

# --- whisper mixes -------------------------------------------------------
meta = json.load(open(os.path.join(a.pwhis, "sets", "meta_pwhis.json")))
f32dir = os.path.join(a.pwhis, "f32", "pwhis")
PHONATED = {"p027", "p033", "p062", "p064", "p104"}
DEV = {"p002", "p011", "p033", "p061", "p064", "p084", "p007", "p031", "p087", "ex02", "ex01"}
by = {}
for m in meta:
    by.setdefault((m["corpus"], m["speaker"], m["sex"]), {}).setdefault(m["style"], []).append(m)
gap = np.zeros(int(0.3 * SR), dtype=np.float32)
for (corpus, spk, sex), styles in sorted(by.items()):
    def joined(style):
        parts = []
        for m in sorted(styles[style], key=lambda m: m["id"]):
            x = rd(os.path.join(f32dir, m["id"] + ".f32"))
            t0 = min(s for s, e in m["act"]); t1 = max(e for s, e in m["act"])
            parts += [x[int(t0 * SR):int(t1 * SR)], gap]
        return np.concatenate(parts[:-1])
    reg, whi = joined("regular"), joined("whisper")
    R, W = 6 * SR, 3 * SR
    out_w, out_s, spans, i, j, t = [], [], [], 0, 0, 0
    while i < len(reg):
        piece = reg[i:i + R]; i += R
        if len(reg) - i < 2 * SR:          # end with regular: absorb a short tail
            piece = np.concatenate([piece, reg[i:]]); i = len(reg)
        out_w.append(piece); out_s.append(piece); t += len(piece)
        if i >= len(reg):
            break
        if j + W > len(whi):
            j = 0
        wp = whi[j:j + W]; j += W
        spans.append([1000 * t / SR, 1000 * (t + len(wp)) / SR])
        out_w.append(wp); out_s.append(np.zeros_like(wp)); t += len(wp)
    base = dict(sex=sex, speaker=spk, corpus=corpus, phonated=spk in PHONATED, split="dev" if spk in DEV else "test", whisper=spans, sr=SR)
    jobs.append(dict(id=f"whis.{spk}", set="whis", f32=wr(f"whis.{spk}", np.concatenate(out_w)), **base))
    jobs.append(dict(id=f"whissil.{spk}", set="whissil", f32=wr(f"whissil.{spk}", np.concatenate(out_s)), **base))

# --- readers -----------------------------------------------------------
for setname, path in [("r1", a.r1), ("r1dev", a.r1dev)]:
    rs = {}
    for jb in json.load(open(path)):
        rs.setdefault(jb["speaker"], []).append(jb)
    for spk, js in sorted(rs.items()):
        parts = []
        for jb in js:
            parts += [rd(jb["audio"]), gap]
        jobs.append(dict(id=f"{setname}.{spk}", set=setname, f32=wr(f"{setname}.{spk}", np.concatenate(parts)), sr=SR, sex=js[0]["sex"], speaker=spk))

# --- Palette -----------------------------------------------------------
for jb in json.load(open(a.pov)):
    jobs.append(dict(id=f"pov.{jb['key']}", set="pov", key=jb["key"], f32=jb["audio"], sr=jb["sr"]))

# --- chanx -------------------------------------------------------------
cm = {m["id"]: m for m in json.load(open(os.path.join(a.chanx, "meta_chanx.json")))}
for jb in json.load(open(os.path.join(a.chanx, "jobs_chanx.json"))):
    m = cm[jb["id"]]
    jobs.append(dict(id=f"chanx.{jb['id']}", set="chanx", f32=jb["f32"], sr=SR, sex=m["sex"], speaker=m["speaker"], cond=m["cond"], lead_s=m["lead_s"], voice_s=m["voice_s"], f0_median=m["f0_median"]))

# --- music alone -------------------------------------------------------
pm = {m["id"]: m for m in json.load(open(os.path.join(a.palone, "sets", "meta_palone.json")))}
for jb in json.load(open(os.path.join(a.palone, "sets", "jobs_palone.json"))):
    m = pm[jb["id"]]
    if m["kind"] in ("mi", "mv"):
        jobs.append(dict(id=f"palone.{jb['id']}", set="palone", f32=jb["f32"], sr=SR, kind=m["kind"], db=m["db"]))

# --- synthetic ---------------------------------------------------------
def wav48(p):
    b = open(p, "rb").read()
    off = 12
    while off < len(b):
        cid = b[off:off + 4]; ln = struct.unpack("<I", b[off + 4:off + 8])[0]
        if cid == b"fmt ":
            sr = struct.unpack("<I", b[off + 12:off + 16])[0]
        if cid == b"data":
            return sr, np.frombuffer(b[off + 8:off + 8 + ln], dtype="<i2").astype(np.float32) / 32768
        off += 8 + ln + (ln & 1)
for n in ["held", "noise", "silence"]:
    sr, x = wav48(os.path.join(a.smoke, n + ".wav"))
    assert sr == 48000
    jobs.append(dict(id=f"synth.{n}", set="synth", f32=wr(f"synth.{n}", x), sr=48000))

json.dump(jobs, open(os.path.join(a.out, "jobs.json"), "w"), indent=0)
from collections import Counter
print(Counter(j["set"] for j in jobs))
