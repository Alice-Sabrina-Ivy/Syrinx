# custom_v5_score.py — V5 (reported, not a gate): the frozen custom detector
# at its frozen operating point over the private session recordings, laid over
# what the current app paints there (session-oracle run.mjs of this branch's
# src), with score.py's own causal alignment, threshold and hangover; refs =
# a session-oracle build_refs.py cache (cons / strict, speaker labels; display
# alignment of analyze.py). Rows: CORRECTLY painted hops of each labelled voice
# (by band), painted hops labelled outside / unknown, painted hops >= 0.3 s from
# any reference voicing (session_fv.py convention). Evaluation only. Output (JSON
# + table on stdout) stays in the gitignored build/; the results belong in the
# private project, never in measurements/.
#   python scripts/voice-detector/judge/custom_v5_score.py --refs=<session-oracle refs dir> --out=build/vad/v5/v5.json
#          [--run=build/vad/v5/runs/<tag>] [--probs=build/vad/v5/probs] [--points=THR/HANG_MS,...  (post-hoc extras)]
import json
import os
import sys

import numpy as np

REPO = os.getcwd()
sys.path.insert(0, os.path.join(REPO, "scripts", "voice-detector"))
sys.argv = [sys.argv[0], "--worst=0"] + [a for a in sys.argv[1:] if a.startswith("--")]
import score as S  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
RUN = A.get("run", "build/vad/v5/runs/vd_dd92037")
PROBS = A.get("probs", "build/vad/v5/probs")
REFS = A["refs"]
OUT = A["out"]
POINTS = [(None, None)] + [tuple(float(v) for v in p.split("/")) for p in A.get("points", "").split(",") if p]
SESS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
GAP = 0.3
spec0 = S.load_cand("build/vad/cand/custom-vd")


def per_session(s, spec):
    meta = json.load(open(f"{RUN}/{s}.meta.json", encoding="utf8"))
    n, hop, L = meta["nHops"], meta["hopS"], meta["lookback"]
    tbl = np.fromfile(f"{RUN}/{s}.hops.f32", dtype="<f4").reshape(len(meta["cols"]), n)
    paint = tbl[meta["cols"].index("paint")]
    P = np.fromfile(f"{PROBS}/{s}.f32", dtype="<f4").astype(np.float64)
    m = {"n": n, "hop_s": hop, "set": "sessions", "id": s}
    v = S.voice_flags(spec, m, S.hop_probs(spec, m, P))
    painted = paint > 0
    veto = painted & ~v
    z = np.load(f"{REFS}/{s}.npz")
    t0 = z["t"][0]
    k = np.arange(n)
    td = (k + 1) * hop - (0.040 + L * hop + 0.030)          # display content time (analyze.py DELTA_DISP)
    j = np.clip(np.round((td - t0) / 0.01).astype(int), 0, len(z["t"]) - 1)
    spk = z["spk"][j]
    out = {}
    for rn in ("cons", "strict"):
        ref = z[rn][j]
        corr = painted & (ref > 0) & (np.abs(paint / np.where(ref > 0, ref, 1) - 1) < 0.05)
        for sp, code in (("alice", 1), ("second", 2)):
            msk = corr & (spk == code)
            out[f"correct_{rn}_{sp}"] = (int(msk.sum()), int((msk & veto).sum()))
            # by band of the reference (low 75-160 / target 160-400)
            for bn, lo, hi in (("75-160", 75, 160), ("160-400", 160, 400)):
                mb = msk & (ref >= lo) & (ref < hi)
                out[f"correct_{rn}_{sp}_{bn}"] = (int(mb.sum()), int((mb & veto).sum()))
    # painted outside every labelled voice: speaker label outside / unknown
    for nm, sel in (("label_outside", spk == 3), ("label_unknown", spk == 0)):
        msk = painted & sel
        out[f"painted_{nm}"] = (int(msk.sum()), int((msk & veto).sum()))
    # painted >= 0.3 s from any reference-voiced frame (session_fv.py convention), per label
    pv = (z["ac"] > 0) | (z["cc"] > 0) | (z["cal"] > 0)
    tv = z["t"][pv]
    jj = np.clip(np.searchsorted(tv, td), 1, len(tv) - 1)
    far = np.minimum(np.abs(tv[jj] - td), np.abs(tv[jj - 1] - td)) >= GAP
    for sp, code in (("alice", 1), ("second", 2), ("outside", 3), ("unknown", 0), ("all", None)):
        msk = painted & far & ((spk == code) if code is not None else True)
        out[f"painted_far_{sp}"] = (int(msk.sum()), int((msk & veto).sum()))
    out["hops"] = (n, int(painted.sum()))
    out["voice_share"] = float(v.mean())
    return out


res = {}
lines = []
for thr, hang in POINTS:
    spec = dict(spec0)
    if thr is not None:
        spec["threshold"], spec["hangover_ms"] = thr, hang
    name = f"{spec['threshold']:g}/{spec['hangover_ms']:g}" + ("" if thr is None else " (post-hoc)")
    per = {s: per_session(s, spec) for s in SESS}
    pooled = {}
    for s in SESS:
        for kk, val in per[s].items():
            if isinstance(val, tuple):
                a, b = pooled.get(kk, (0, 0))
                pooled[kk] = (a + val[0], b + val[1])
    res[name] = {"per_session": per, "pooled": pooled}
    lines.append(f"## point {name}\n")
    keys = [k for k in pooled if k != "hops"]
    lines.append("| row | " + " | ".join(SESS) + " | pooled |")
    lines.append("|---|" + "---|" * (len(SESS) + 1))
    for kk in keys:
        cells = []
        for s in SESS + ["pooled"]:
            a, b = (per[s][kk] if s != "pooled" else pooled[kk])
            cells.append(f"{100 * b / a:.2f} % of {a}" if a else "—")
        lines.append(f"| {kk} | " + " | ".join(cells) + " |")
    lines.append("")
with open(OUT, "w", encoding="utf8") as f:
    json.dump(res, f, indent=1)
print("\n".join(lines))
