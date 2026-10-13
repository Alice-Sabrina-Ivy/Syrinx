# selftest_r6.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2
# "Validation-only, enforced"): static and unit checks of the round-6 data code.
#
#   1. No training or packing script imports a validation-only generator
#      (r5/vsynth_val, r5/vbeds, r6/lfsynth_val, r6/mach5_val, r6/micsim_val,
#      r6/probes5_val, r6/sess5_val, r6/sess3_val, r6/hval6, r5/hval) or names a
#      validation folder (build/vad-train/r6/hval, r5/hval). Scanned: every .py
#      under scripts/voice-detector/train/ (except the selection / inference
#      scripts, which read the H rows by design and never train), every .py under
#      scripts/voice-detector/r6a/ and r6b/ (the Track A / Track B code, when it
#      exists) and r5/d7.py. Comment lines and lines marked "# guard: refuses"
#      (which name a folder in order to refuse it) are not scanned.
#   2. The ported validation generators are the review's, bit for bit: output
#      digests of lfsynth_val.synth, mach5_val.bed (six kinds) and the micsim_val
#      microphones, pinned from the round-5 review's own files (lfsynth.py,
#      mach5.py, screen5.py, screen5_eq.py) at port time.
#   3. Validation seeds stay inside the validation ranges (voices [5e9, 6e9),
#      beds [6e9, 7e9)) and never reach the round-6 training ranges (Track A
#      7e9 + [0, 5e7), Track B 7e9 + [5e7, 1e8)).
#   4. The buzz rule and the round-5 topic rule (word-start boundaries).
#   5. hcells' bin merge rule on a toy table.
#
#   python scripts/voice-detector/r6/selftest_r6.py
import hashlib
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VD = os.path.abspath(os.path.join(HERE, ".."))
for p in (HERE, os.path.join(VD, "r5"), os.path.join(VD, "r3"), os.path.join(VD, "r4"), os.path.join(VD, "train")):
    sys.path.insert(0, p)
fails = []


def check(ok, what):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)


VAL_MODS = ("vsynth_val", "vbeds", "lfsynth_val", "mach5_val", "micsim_val", "probes5_val", "sess5_val", "sess3_val", "hval6", "hval")
BAN = re.compile(r"""^\s*(from|import)\s+.*\b(""" + "|".join(VAL_MODS) + r""")\b|["'][^"']*\b(r6[/\\]+hval|r5[/\\]+hval|hval)\b[^"']*["']""")


def code_lines(f):
    return [ln for ln in open(f, encoding="utf8").read().splitlines() if not ln.lstrip().startswith("#") and "# guard: refuses" not in ln]


SELECTION_SIDE = {"infer_r3.py", "opselect_r5.py", "opselect_r6.py", "infer_r6.py"}
files = [os.path.join(VD, "train", f) for f in sorted(os.listdir(os.path.join(VD, "train"))) if f.endswith(".py") and f not in SELECTION_SIDE]
for d in ("r6a", "r6b"):
    dd = os.path.join(VD, d)
    if os.path.isdir(dd):
        for rt, _, fs in os.walk(dd):
            files += [os.path.join(rt, f) for f in sorted(fs) if f.endswith(".py") and f not in SELECTION_SIDE]
files.append(os.path.join(VD, "r5", "d7.py"))
bad = [os.path.relpath(f, VD) for f in files if any(BAN.search(ln) for ln in code_lines(f))]
check(not bad, f"no training / packing script imports a validation generator or names a validation folder ({len(files)} files; offenders {bad})")


def dig(x):
    return hashlib.sha256(np.asarray(x, np.float32).tobytes()).hexdigest()[:16]


import lfsynth_val  # noqa: E402
import mach5_val  # noqa: E402
import micsim_val  # noqa: E402

REF = {"lf_synth": "64689bac152f6213", "lf_truth": "3ac8d62255334df3", "lf_synth_f": "501ee80c605c2922", "m5_twofan": "d32e6fba95a7346e",
       "m5_aqpump": "4649d37e5a6606a7", "m5_microwave": "216c2f78f92e662d", "m5_caridle": "e3143b27500f5f3b", "m5_washer": "0ae9f414d7e57921",
       "m5_ballast": "5cfc87e7c29e8f80", "mic_phone_eq": "f638c99d83da19df", "mic_phone2": "9a30e32886c31ad2", "mic_phone2agc": "b37c68c330a11abb",
       "mic_agc": "ce48daa6ff264c2d"}
x, (_, _, f) = lfsynth_val.synth(16000, 2.0, 92.0, sex="m", vowel="hum", qual="breathy", seed=5_002_000_001, lead=0.0, tail=0.0, wander_cents=20.0)
D = {"lf_synth": dig(x), "lf_truth": dig(f)}
x, _ = lfsynth_val.synth(44100, 1.5, 215.0, sex="f", vowel="a", qual="pressed", seed=7, lead=0.0, tail=0.0, am=(25.0, 0.85), vib=(5.4, 45.0))
D["lf_synth_f"] = dig(x)
for k in mach5_val.SYN:
    D["m5_" + k] = dig(mach5_val.bed(k, 16000, 2.0, seed=6_001_000_001))
z = np.random.default_rng(3).standard_normal(16000 * 3) * 0.05
D["mic_phone_eq"] = dig(micsim_val.phone_eq(z, 16000))
D["mic_phone2"] = dig(micsim_val.phone2(z, 16000, agc=False))
D["mic_phone2agc"] = dig(micsim_val.phone2(z, 16000))
D["mic_agc"] = dig(micsim_val.agc_only(z, 16000))
if "--print" in sys.argv:
    print(D)
for k in REF:
    check(D.get(k) == REF[k], f"ported generator digest {k}: {D.get(k)}")

sys.argv = [sys.argv[0]]
import hval6  # noqa: E402

vmax = max(hval6.VSYN0, hval6.LSYN0) + max(hval6.VOFF.values()) + 1_000 * len(hval6.EX) + 100_000
bmax = hval6.BSYN0 + max(hval6.BOFF.values()) + 2 * max(hval6.SEXOFF.values()) + 30_000 + 10 * 2_000 + 4 * 10_000
check(5_000_000_000 <= min(hval6.VSYN0, hval6.LSYN0) and vmax < 6_000_000_000, f"validation voice seeds inside [5e9, 6e9) (max {vmax})")
check(6_000_000_000 <= hval6.BSYN0 and bmax < 7_000_000_000, f"validation bed seeds inside [6e9, 7e9), below the round-6 training seeds 7e9+ (max {bmax})")
check(bool(hval6.BUZZ.search("machine room hum")) and bool(hval6.BUZZ.search("Fish tank filter")) and bool(hval6.BUZZ.search("lamp buzz"))
      and not hval6.BUZZ.search("oscillating fan") and not hval6.BUZZ.search("Thump and thud"), "buzz rule (§2.2) with word-start boundaries")
import hval  # noqa: E402

check(not hval.TOPIC.search("Thump and thud") and bool(hval.TOPIC.search("window ac")), "round-5 topic rule as corrected in R5-B.2 (§2.2)")

import hcells  # noqa: E402

C = {"h5|m|clean|vsynth|bin0": 500, "h5|m|clean|vsynth|bin1": 300, "h5|m|clean|vsynth|bin2": 450, "h5|m|clean|vsynth|bin3": 100,
     "h5|m|clean|vsynth|binlast": 420}
mb = hcells.merge_bins(C, "h5|m|clean|vsynth")
check(mb == [(["bin0", "bin1"], 800), (["bin2", "bin3"], 550), (["binlast"], 420)], f"bin merge rule (a bin under 400 joins the bin before): {mb}")

print("selftest_r6:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
