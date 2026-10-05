# make_tree.py [REV] — build the parametric display tree used by replay.mjs /
# drills.mjs / sweep.sh (2026-10-04 re-acquisition pass,
# measurements/pitch-display-reacquire-2026-10-04.md):
#   build/trees/reacq-var/src = `git archive REV src` (default 5ebe609, the
#   measured baseline) + pitchPaintGate.param.js as audio/pitchPaintGate.js +
#   four observation/knob edits to audio/useAudioPipeline.js (resetSegment
#   reason, gate inputs conf/inten/amb/raw, and the smResetGap median-restart
#   knob, all inert with an empty config). Restart sub-knobs (review fix,
#   §10 of the measurement file): smSeed = a restart, or any fresh value
#   arriving on an empty buffer, starts the buffer as [x1], so the next
#   medians are x1 and median(x1,x1,x2) = x1 (odd length, a real detection,
#   never the mean of two); smCondSemi = restart only when the fresh value is
#   >= that many semitones from the buffer median.
import os, sys, shutil, subprocess, io, tarfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
REV = sys.argv[1] if len(sys.argv) > 1 else "5ebe609"
OUT = os.path.join(ROOT, "build", "trees", "reacq-var")
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
tar = subprocess.run(["git", "-C", ROOT, "archive", REV, "src"], check=True, capture_output=True).stdout
tarfile.open(fileobj=io.BytesIO(tar)).extractall(OUT)
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pitchPaintGate.param.js"), os.path.join(OUT, "src", "audio", "pitchPaintGate.js"))
p = os.path.join(OUT, "src", "audio", "useAudioPipeline.js")
s = open(p, encoding="utf8").read()
def sub(old, new, count=1):
    global s
    assert s.count(old) >= count, f"anchor missing: {old[:70]!r}"
    i = s.index(old); s = s[:i] + new + s[i + len(old):]
sub("paintGateRef.current.resetSegment();", 'paintGateRef.current.resetSegment("quiet");')  # first = quiet branch
sub("displayPitched = paintGateRef.current.push(smoothedPitch, { fresh: hasPitch });",
    "displayPitched = paintGateRef.current.push(smoothedPitch, { fresh: hasPitch, conf: latestPitch.confidence, inten: intensity, amb: latestPitch.amb ?? null, raw: hasPitch ? pitch : null });")
sub("    const { pitch, hasPitch, isQuiet } = gate;\n",
    "    const { pitch, hasPitch, isQuiet } = gate;\n    globalThis.__SMPREV = globalThis.__SMGAP || 0;\n    globalThis.__SMGAP = hasPitch ? 0 : (globalThis.__SMGAP || 0) + 1;\n")
sub("    let smoothedPitch = null;\n    if (effectivePitch !== null) {",
    "    let smoothedPitch = null;\n    {\n      const __P = globalThis.__PGV || {};\n      const __g = __P.smResetGap;\n      if (hasPitch && (__g || __P.smSeed)) {\n        const __m = median(pitchSmoothRef.current);\n        const __armed = __g && globalThis.__SMPREV >= __g;\n        const __off = __m === null || !__P.smCondSemi || Math.abs(12 * Math.log2(pitch / __m)) >= __P.smCondSemi;\n        if (__P.smSeed && __m === null) pitchSmoothRef.current = [pitch];\n        else if (__armed && __off) pitchSmoothRef.current = __P.smSeed ? [pitch] : [];\n      }\n    }\n    if (effectivePitch !== null) {")
open(p, "w", encoding="utf8").write(s)
print("built", OUT, "from", REV)
