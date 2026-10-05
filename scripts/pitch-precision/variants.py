# variants.py NAME MODE — precision-pass variant trees (scratch).
#   MODE sinc|sub40 : post-decode refinement of the posted value (pitch-refine.js)
#   MODE m1         : PITCH_SMOOTH_LEN 3 -> 1 (display unsmoothed)
#   MODE m5         : PITCH_SMOOTH_LEN 3 -> 5
import sys, os, shutil
name, mode = sys.argv[1], sys.argv[2]
dst = f"build/prec/trees/{name}/src"
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree("src", dst)


def sub1(path, old, new):
    p = f"{dst}/{path}"; s = open(p, encoding="utf8").read()
    assert s.count(old) == 1, (path, old[:50], s.count(old))
    open(p, "w", encoding="utf8").write(s.replace(old, new))


if mode in ("sinc", "sub40"):
    shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pitch-refine.js"), f"{dst}/dsp/pitch-refine.js")
    sub1("dsp/pitch-worker.js", 'import { createNoiseNotch, isNearNotch } from "./noise-notch.js";',
         'import { createNoiseNotch, isNearNotch } from "./noise-notch.js";\nimport { createRefiner } from "./pitch-refine.js";\nlet refiner = null;')
    sub1("dsp/pitch-worker.js", "  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;\n",
         "  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;\n"
         "  if (voiced) vetoed = Math.min(PITCH_DISPLAY_RANGE.high, refiner(bufferDelayLine[0], vetoed));\n")
    sub1("dsp/pitch-worker.js", "      harmonicGuard = createHarmonicVoicingGuard();\n",
         f"      harmonicGuard = createHarmonicVoicingGuard();\n      refiner = createRefiner(TARGET_SAMPLE_RATE, FRAME_LENGTH, \"{mode}\");\n")
elif mode in ("m1", "m5"):
    sub1("audio/pitchSmoothing.js", "export const PITCH_SMOOTH_LEN = 3;", f"export const PITCH_SMOOTH_LEN = {mode[1]};")
else:
    raise SystemExit("mode?")
print("tree", dst)
