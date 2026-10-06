# mktree.py — candidate src trees for the real-noise false-voicing work
# (2026-10-05). build/rnfv-trees/<name>/src = a copy of the repo's src/ with
# the candidate's edits applied (CRLF-safe exact replacements; a replacement
# that does not match aborts). Candidates are listed in CANDS below.
#
#   python scripts/realnoise-fv/mktree.py NAME [NAME ...] [--out=build/rnfv-trees]
import sys, os, shutil

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
NAMES = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = A.get("out", "build/rnfv-trees")

# ---- display: pitch-hold bridge ------------------------------------------------
NL = chr(10)
GATE = "audio/pitchGate.js"
HOLD_STATE_OLD = """    quietFrames: 0,       // consecutive frames below both gate arms
    lastFreshPitchAt: null, // frame time (ms) of the last accepted pitch
  };"""
HOLD_STATE_NEW = """    quietFrames: 0,       // consecutive frames below both gate arms
    lastFreshPitchAt: null, // frame time (ms) of the last accepted pitch
    runFresh: 0,          // fresh frames that earned the current hold (see HOLD_RUN_RATIO)
    gapFrames: 0,         // frames since the last fresh pitch
  };"""
HOLD_EVAL_OLD = """  const hasPitch = typeof effPitch === "number";
  if (hasPitch) state.lastFreshPitchAt = now;
  const holdAllowed =
    !hasPitch &&
    state.lastFreshPitchAt !== null &&
    now - state.lastFreshPitchAt <= PITCH_HOLD_MAX_MS;"""


def hold_eval(mode, ratio):
    # mode "run": the fresh run right before the gap; "seg": fresh frames of the
    # whole bridged segment (reset when a hold expires)
    upd = ("    state.runFresh = state.gapFrames > 0 ? 1 : state.runFresh + 1;" if mode == "run" else
           "    state.runFresh = state.gapFrames > 0 && !state.bridged ? 1 : state.runFresh + 1;")
    return f"""  const hasPitch = typeof effPitch === "number";
  if (hasPitch) {{
{upd}
    state.gapFrames = 0;
    state.lastFreshPitchAt = now;
  }} else if (state.lastFreshPitchAt !== null) {{
    state.gapFrames++;
  }}
  const holdAllowed =
    !hasPitch &&
    state.lastFreshPitchAt !== null &&
    now - state.lastFreshPitchAt <= PITCH_HOLD_MAX_MS &&
    state.gapFrames <= HOLD_RUN_RATIO * state.runFresh;
  state.bridged = holdAllowed || hasPitch;"""


HOLD_CONST_OLD = "export const PITCH_HOLD_MAX_MS = 400;"


def hold_const(ratio, maxms=400):
    return f"export const PITCH_HOLD_MAX_MS = {maxms};\nexport const HOLD_RUN_RATIO = {ratio};"


def hold_cand(mode, ratio, maxms=400):
    return [(GATE, HOLD_CONST_OLD, hold_const(ratio, maxms)), (GATE, HOLD_STATE_OLD, HOLD_STATE_NEW),
            (GATE, HOLD_EVAL_OLD, hold_eval(mode, ratio))]


def holdmax(ms):
    return [(GATE, HOLD_CONST_OLD, f"export const PITCH_HOLD_MAX_MS = {ms};")]


PAINT = "audio/pitchPaintGate.js"


def onset(n):
    return [(PAINT, "export const ONSET_CONFIRM_FRAMES = 3;", f"export const ONSET_CONFIRM_FRAMES = {n};")]


# ---- worker: learned-background voicing veto (cand/noise-floor-guard.js) -----
# Not adopted (measurements/realnoise-false-voicing-attribution-2026-10-05.md);
# the candidate tree copies cand/noise-floor-guard.js into src/dsp and wires it
# into the pitch worker with the edits below.
FLOOR = "dsp/noise-floor-guard.js"
CAND_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cand", "noise-floor-guard.js")
PW = "dsp/pitch-worker.js"
WIRE = [
    (PW, '//   main → worker: { type: "init", inputSampleRate, diag? }',
     '//   main → worker: { type: "init", inputSampleRate, diag?, floorGuard? }' + NL +
     '//                  (floorGuard: false disables the learned-background veto —' + NL +
     '//                  tests / oracles only)'),
    (PW, 'import { createNoiseNotch, isNearNotch } from "./noise-notch.js";',
     'import { createNoiseNotch, isNearNotch } from "./noise-notch.js";' + NL +
     'import { createNoiseFloorGuard } from "./noise-floor-guard.js";'),
    (PW, 'let bufferDelayLine = [];',
     'let bufferDelayLine = [];' + NL + 'let floorGuard = null;' + NL + 'let floorGuardOn = true;'),
    (PW, '  const frameCandidates = detector.candidates(buffer16k);',
     '  const frameCandidates = detector.candidates(buffer16k);' + NL + '  floorGuard.observe(buffer16k);'),
    (PW, '  if (vetoed > 0 && !harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)) {',
     '  const preGuardVoiced = vetoed > 0;' + NL +
     '  if (vetoed > 0 && !harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)) {'),
    (PW, '  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;',
     '  floorGuard.decided(vetoed > 0, !preGuardVoiced);' + NL +
     '  if (vetoed > 0 && floorGuardOn && !floorGuard.check(vetoed)) vetoed = null;' + NL +
     '  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;'),
    (PW, '      harmonicGuard = createHarmonicVoicingGuard();',
     '      harmonicGuard = createHarmonicVoicingGuard();' + NL +
     '      floorGuard = createNoiseFloorGuard(TARGET_SAMPLE_RATE, { lagFrames: tracker.config.lookback });' + NL +
     '      floorGuardOn = msg.floorGuard !== false;'),
]


def fg(**kw):
    ed = [("COPY", CAND_MODULE, FLOOR)] + list(WIRE)
    for k, v in kw.items():
        pat = {"excessDb": "  excessDb: 14,", "minHarmonics": "  minHarmonics: 1,", "debounce": "  debounce: 4,",
               "windowFrames": "  windowFrames: 2400,", "smoothFrames": "  smoothFrames: 16,",
               "warmFrames": "  warmFrames: 80,"}[k]
        new = pat.split(":")[0] + ": " + (f'"{v}"' if isinstance(v, str) else str(v)) + ","
        ed.append((FLOOR, pat, new))
    return ed


NOFLOOR = fg() + [(PW, "      floorGuardOn = msg.floorGuard !== false;", "      floorGuardOn = false;")]

# fg + observation-only counters (globalThis.__FGI, armed.mjs): how often
# check() is past its warm-up and anchored ("armed"), and the best harmonic
# excess over the floor of every armed check. Verdicts are unchanged.
ARMED = [
    (FLOOR, "    if (fr < cfg.warmFrames || !(f0 > 0) || !blkAnchor.some((v) => v)) { return pass(); }",
     "    const G = globalThis.__FGI; if (G) G.calls++;" + NL +
     "    if (fr < cfg.warmFrames) { if (G) G.warm++; return pass(); }" + NL +
     "    if (!(f0 > 0) || !blkAnchor.some((v) => v)) { if (G) G.noanchor++; return pass(); }" + NL +
     "    if (G) G.armed++;"),
    (FLOOR, "    let count = 0;" + NL + "    for (let h = 1; h <= cfg.harmonics; h++) {",
     "    let count = 0;" + NL +
     "    if (G) { let best = -Infinity; for (let h = 1; h <= cfg.harmonics; h++) { const f = h * f0; if (f > cfg.maxHarmHz) break; const half = Math.min(0.03 * f, 0.2 * f0);" + NL +
     "      const lo = Math.max(1, Math.floor((f - half) / binHz)), hi = Math.min(NB - 1, Math.ceil((f + half) / binHz));" + NL +
     "      for (let b = lo; b <= hi; b++) if (floor[b] < Infinity) best = Math.max(best, 10 * Math.log10(p[b] / floor[b])); } G.best.push(best); }" + NL +
     "    for (let h = 1; h <= cfg.harmonics; h++) {"),
    (FLOOR, "    streak++;" + NL + "    return streak < cfg.debounce;",
     "    streak++;" + NL + "    if (G) { G.armedFail++; if (streak >= cfg.debounce) G.vetoes++; }" + NL + "    return streak < cfg.debounce;"),
]

CANDS = {
    "src": [],
    "h_run1": hold_cand("run", 1),
    "h_run05": hold_cand("run", 0.5),
    "h_run2": hold_cand("run", 2),
    "h_seg1": hold_cand("seg", 1),
    "h_max200": holdmax(200),
    "h_max0": holdmax(0),   # no pitch-hold bridge (mechanism check of the tail FV increase, §4.3)
    "h_max150": holdmax(150),
    "on4": onset(4),
    "on5": onset(5),
    "fg": fg(),             # = src: excessDb 14, minHarmonics 1, debounce 4, 60 s,
                            #   anchor-gated (see noise-floor-guard.js)
    "fg_w20": fg(windowFrames=800),
    "fg_w40": fg(windowFrames=1600),
    "fg_x12": fg(excessDb=12),
    "fg_x16": fg(excessDb=16),
    "fg_d6": fg(debounce=6),
    # sticky anchor: once ANY anchor window occurred since the stream started
    "fg_sticky": fg() + [(FLOOR, "    if (anchor) blkAnchor[blkPos] = 1;", "    if (anchor) anchoredEver = true;"),
                         (FLOOR, "  let streak = 0;", "  let streak = 0;" + NL + "  let anchoredEver = false;"),
                         (FLOOR, "!blkAnchor.some((v) => v)", "!(anchoredEver && blkFed.some((v) => v))")],
    # no anchor rule: every background window anchors (= the 60 s variant
    # measured before the anchor rule)
    "fg_noanchor": fg() + [(PW, "  floorGuard.decided(vetoed > 0, !preGuardVoiced);", "  floorGuard.decided(vetoed > 0);")],
    # the worker's floor guard switched off (= base behaviour, same code)
    "fg_off": NOFLOOR,
    # fg with observation-only counters (armed.mjs; review fix, §4.2)
    "fg_armed": fg() + ARMED,
    # Measured on earlier revisions of the module (not rebuildable from this
    # src; see the measurement file §3.5): no anchor rule; background learned
    # from (a) every frame ("all" mode), (b) every frame unvoiced before this
    # guard, (c) only tracker-unvoiced frames, (d) all but ghost-vetoed
    # frames, (e) all but harmonic-guard-vetoed frames; a 200 ms guard
    # interval before background windows; 20 s windows without the
    # self-teaching / empty-window fixes.
}


def build(name):
    edits = CANDS[name]
    dst = os.path.join(OUT, name, "src")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree("src", dst)
    for rel, old, new in edits:
        if rel == "COPY":
            shutil.copyfile(old, os.path.join(dst, new))
            continue
        p = os.path.join(dst, rel)
        b = open(p, "rb").read()
        crlf = b"\r\n" in b
        s = b.decode("utf8").replace("\r\n", "\n")
        if s.count(old) != 1:
            raise SystemExit(f"{name}: {rel}: pattern found {s.count(old)} times:\n{old[:200]}")
        s = s.replace(old, new)
        if crlf:
            s = s.replace("\n", "\r\n")
        open(p, "wb").write(s.encode("utf8"))
    print(f"{name}: {len(edits)} edits -> {dst}")


for n in NAMES:
    build(n)
