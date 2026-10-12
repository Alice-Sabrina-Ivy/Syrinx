# selftest_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §2.1, §3.3):
# static and unit checks of the round-5 data code.
#
#   1. No training or packing script imports the validation-only generators
#      (r5/vsynth_val.py, r5/vbeds.py) or names the H stream folder (r5/hval):
#      every .py under scripts/voice-detector/train/ and the round-5 training-side
#      scripts (r5/d7.py) is scanned.
#   2. The validation generators are the review's, bit for bit: vsynth_val.synth
#      / vbeds.bed against fixed digests (computed from the review files vsynth2.py /
#      beds4.py at port time; the port was also checked bit-exact against them).
#   3. The training synthesizer (train/vsynth_r5.py) draws from training seeds
#      [4e9, 5e9) only and refuses a validation seed.
#   4. hval's topic rule: word-start boundaries (no "Thump" -> hum).
#
#   python scripts/voice-detector/r5/selftest_r5.py
import hashlib
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN = os.path.join(HERE, "..", "train")
sys.path.insert(0, HERE)
sys.path.insert(0, TRAIN)
fails = []


def check(ok, what):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)


BAN = re.compile(r"""^\s*(from|import)\s+.*\b(vsynth_val|vbeds)\b|["'][^"']*\bhval\b[^"']*["']""")


def code_lines(f):
    """The file's lines without comment lines (comments may name the validation generators to say they are not used) and
    without the refusal guards (lines marked "# guard: refuses ...", which name the H folder in order to refuse it)."""
    return [ln for ln in open(f, encoding="utf8").read().splitlines() if not ln.lstrip().startswith("#") and "# guard: refuses" not in ln]


SELECTION_SIDE = {"infer_r3.py", "opselect_r5.py"}     # selection / inference scripts: they read the H rows by design (§4), never train
files = [os.path.join(TRAIN, f) for f in sorted(os.listdir(TRAIN)) if f.endswith(".py") and f not in SELECTION_SIDE] + [os.path.join(HERE, "d7.py")]
bad = [os.path.basename(f) for f in files if any(BAN.search(ln) for ln in code_lines(f))]
check(not bad, f"no training / packing script imports the validation generators or names r5/hval ({len(files)} files; offenders {bad})")
tr5 = open(os.path.join(TRAIN, "train_r5.py"), encoding="utf8").read()
check("refuse(os.path.join(TRAIN" in tr5 and tr5.count("# guard: refuses") == 2, "train_r5.py refuses the H folder and the sealed set on every bank it opens")

import vbeds  # noqa: E402
import vsynth_val  # noqa: E402


def dig(x):
    return hashlib.sha256(np.asarray(x, np.float32).tobytes()).hexdigest()[:16]


x, (_, _, f) = vsynth_val.synth(16000, 2.0, 110.0, vowel="hum", qual="soft", fscale=1.0, seed=5_000_000_001, lead=0.0, tail=0.0, wander_cents=20.0)
D = {"synth": dig(x), "truth": dig(f), "bed_pcfan": dig(vbeds.bed("pcfan", 16000, 2.0, seed=6_000_000_001)),
     "bed_fridge": dig(vbeds.bed("fridge", 44100, 1.0, seed=7))}
REF = {"synth": "35e8959465ee1745", "truth": "0a6cf9e2d7b5d0c4", "bed_pcfan": "b36a64adf012696d", "bed_fridge": "4514802f641e1162"}
if "--print" in sys.argv:
    print(D)
else:
    for k in REF:
        check(D[k] == REF[k], f"validation generator digest {k}: {D[k]}")

import vsynth_r5  # noqa: E402
try:
    vsynth_r5.draw(5_000_000_000)
    check(False, "vsynth_r5 refuses a validation seed")
except AssertionError:
    check(True, "vsynth_r5 refuses a validation seed (5e9)")
y, _, P = vsynth_r5.synth(vsynth_r5.SEED0 + 3)
check(P["seed"] == vsynth_r5.SEED0 + 3 and len(y) > 0, "vsynth_r5 draws from training seeds")

import hval  # noqa: E402
check(not hval.TOPIC.search("Thump and thud") and hval.TOPIC.search("Mechanical fan") and hval.TOPIC.search("window ac")
      and not hval.TOPIC.search("Accelerating and revving"), "hval topic rule uses word-start boundaries")

print("selftest_r5:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
