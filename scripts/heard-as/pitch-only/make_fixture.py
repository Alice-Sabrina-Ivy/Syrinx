"""Golden replay fixture for tests/ml/pitch-only-warning-test.js (public data only).

Run in the study's output directory (features.pkl from features.py, the session
outputs out/*.jsonl from session.mjs):

    python <repo>/scripts/heard-as/pitch-only/make_fixture.py out/*.jsonl

Writes <repo>/tests/ml/fixtures/pitch-only-golden.json: for a few LibriSpeech-based
sessions (natural readers and the Hillenbrand & Clark 2009 sentence-proxy
manipulations; no NC-licensed material), every 2 s panel tick (the panel's ln F0
or null when hidden, the resonance snapshot fields the rule reads) and the posted
pitch frames up to 4 s after the cue's start was set (later frames cannot change
the pitch start). The expected warning timelines come from this study's own
offline rule (rules.condition, K = 1 and K = 2) — an independent implementation
the JS module must reproduce tick for tick.
"""
import os, sys, json, glob
import numpy as np
import rules as R

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.."))
KEYS = [
    "hcs_908_PO", "hcs_4970_PO",     # pitch only, man raised / woman lowered (test split)
    "hcs_908_PE", "hcs_237_PE",      # pitch + resonance together (K = 1 flashes, K = 2 does not)
    "hcs_908_EO", "hcs_2961_EO",     # resonance only
    "nat_61", "nat_1995",            # natural readers with a few warnings (K = 2: 4.2 % / 2.4 %)
]
P = dict(X=4, Y=0.6, pitch="P8")

raw = {}
for pat in sys.argv[1:]:
    for g in glob.glob(pat):
        for line in open(g):
            if line.strip():
                r = json.loads(line)
                if r["key"] in KEYS:
                    raw[r["key"]] = r

out = []
for k in KEYS:
    r, f = raw[k], R.F[k]
    pitch = np.array(r["pitch"], dtype=float).reshape(-1, 2)
    steps = np.unique(np.round(np.diff(pitch[:, 0]), 3))
    assert len(steps) == 1 and steps[0] == 25.0, (k, steps)
    t_end = (f["t_start"] + 4) * 1000
    keep = pitch[pitch[:, 0] <= t_end]
    ticks = []
    for x in r["ticks"]:
        e, s = x["e"], x["r"]
        ticks.append([round(x["t"] * 1000, 3), e.get("f"), s["u"], s["su"], s["fill"], s["vd"], s["sr"]])
    on1 = R.condition(f, "a", dict(P, K=1))
    on2 = R.condition(f, "a", dict(P, K=2))
    out.append(dict(
        key=k, sex=r["meta"]["sex"], kind=R.kind(r["meta"]),
        tShiftMs=None if f["tshift"] is None else round(f["tshift"] * 1000, 3),
        pitch=dict(t0Ms=keep[0, 0], stepMs=25, f0=[round(v, 2) for v in keep[:, 1]]),
        ticks=ticks,
        expect=dict(p0=None if np.isnan(f["P0"]) else f["P0"],
                    elig="".join("1" if v else "0" for v in f["elig"]),
                    on1="".join("1" if v else "0" for v in on1),
                    on2="".join("1" if v else "0" for v in on2)),
    ))

dst = os.path.join(REPO, "tests/ml/fixtures/pitch-only-golden.json")
with open(dst, "w", newline="\n") as fh:
    fh.write('{"rule": ' + json.dumps(P) + ', "sessions": [\n')
    fh.write(",\n".join(json.dumps(s, separators=(",", ":")) for s in out))
    fh.write("\n]}\n")
print(dst, os.path.getsize(dst), "bytes")
