# portcheck_r6.py — custom voice detector, round 6 (pre-registration §2.2): the ported
# validation generators (lfsynth_val, mach5_val, micsim_val, probes5_val) against the round-5
# review's own modules and its saved chain-confirmed probe WAVs x1 / x3 / x4, bit for bit.
# Reads the review scratch folder (absolute paths below). Run with `python -I`.
#   <venv python> -I scripts/voice-detector/r6/portcheck_r6.py [mods|x|all]
# port check: the ported validation generators vs the review modules and the review's saved probe WAVs (bit-exact)
import sys, os, json, ast, importlib.util, hashlib
import numpy as np, soundfile as sf
R6 = "C:/Coding Projects/Syrinx-vad/scripts/voice-detector/r6"
RV = "C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/scratchpad/vad-train-r5/review-voice"
sys.path.insert(0, R6)
sys.path.insert(0, os.path.join(R6, "..", "r5"))
which = sys.argv[1] if len(sys.argv) > 1 else "all"
fails = []
def chk(ok, what):
    print(("PASS " if ok else "FAIL ") + what, flush=True)
    if not ok: fails.append(what)
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
import lfsynth_val, mach5_val, micsim_val, probes5_val
if which in ("all", "mods"):
    lf = load("lfsynth_rev", os.path.join(RV, "lfsynth.py"))
    for args, kw in [((48000, 3.0, 92.0), dict(sex="m", vowel="hum", qual="breathy", seed=11, lead=1.0)),
                     ((44100, 2.0, 215.0), dict(sex="f", vowel="a", qual="pressed", seed=12, vib=(5.4, 45.0), am=(25.0, .85))),
                     ((16000, 6.0, 85.0), dict(sex="m", vowel="u", qual="modal", seed=13, segs=[(0, 2.0), (2.5, 2.0)], glide=lambda t: 1 + 0 * t))]:
        a = lf.synth(*args, **kw); b = lfsynth_val.synth(*args, **kw)
        chk(np.array_equal(a[0], b[0]) and np.array_equal(a[1][2], b[1][2]), f"lfsynth_val == review lfsynth {args}")
    m5 = load("mach5_rev", os.path.join(RV, "mach5.py"))
    for k in m5.SYN + ["144046", "830089"]:
        a = m5.bed(k, 44100, 3.0, seed=5); b = mach5_val.bed(k, 44100, 3.0, seed=5)
        chk(np.array_equal(a, b), f"mach5_val.bed == review mach5.bed ({k})")
    eq = load("eq_rev", os.path.join(RV, "screen5_eq.py"))
    src = open(os.path.join(RV, "screen5.py"), encoding="utf8").read()
    T = ast.parse(src); ns = {"np": np}
    exec("from scipy.signal import butter, sosfilt, lfilter", ns)
    for node in T.body:
        if isinstance(node, ast.FunctionDef) and node.name in ("peak_eq", "phone_eq", "phone2", "agc_only"):
            exec(compile(ast.Module([node], []), "screen5", "exec"), ns)
    x = np.random.default_rng(3).standard_normal(48000 * 3) * 0.05
    chk(np.array_equal(ns["phone_eq"](x, 48000), micsim_val.phone_eq(x, 48000)), "micsim_val.phone_eq == screen5.phone_eq")
    chk(np.array_equal(ns["phone2"](x, 48000, agc=False), micsim_val.phone2(x, 48000, agc=False)), "micsim_val.phone2(agc=False) == screen5")
    chk(np.array_equal(ns["phone2"](x, 48000), micsim_val.phone2(x, 48000)), "micsim_val.phone2 == screen5.phone2")
    chk(np.array_equal(eq.phone2(x, 48000), micsim_val.phone2(x, 48000)), "micsim_val.phone2 == screen5_eq.phone2 (sess5)")
    chk(np.array_equal(eq.phone_eq(x, 44100), micsim_val.phone_eq(x, 44100)), "micsim_val.phone_eq == screen5_eq.phone_eq (sess5)")
    chk(np.array_equal(ns["agc_only"](x, 44100), micsim_val.agc_only(x, 44100)), "micsim_val.agc_only == screen5.agc_only")
if which in ("all", "x"):
    for tag, S in (("x1", "S1"), ("x3", "S3"), ("x4", "S4")):
        P = json.load(open(os.path.join(RV, f"probes-{tag}.json")))
        sp = {s["i"]: s for s in probes5_val.specs(S)}
        bad = 0
        for it in P:
            s = sp[it["meta"]["i"]]
            assert all(s[k] == it["meta"][k] for k in s), it["id"]
            x, (t0, hop, ft), segs, f0v = probes5_val.make(s)
            y, sr = sf.read(it["wav"], dtype="float32")
            R = json.load(open(it["refPath"]))
            ok = sr == s["sr"] and np.array_equal(x, y) and np.allclose(np.round(ft.astype(float), 2), np.asarray(R["f0"]), atol=0.006)
            bad += not ok
        chk(bad == 0, f"{tag}: {len(P)} saved {S} WAVs re-rendered bit-exact by probes5_val ({bad} differ)")
print("portcheck:", "PASS" if not fails else f"FAIL {fails}")
