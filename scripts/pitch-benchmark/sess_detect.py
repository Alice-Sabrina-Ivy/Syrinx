# sess_detect.py — offline detectors on the user sessions.
#   Praat rows run on the whole session file (cheap, full-utterance Viterbi).
#   Slow rows (pyin, penn, crepe_*, swift_offline) run on the speaker-labelled
#   spans only: contiguous private-session alice/second frames, gaps < 0.5 s merged,
#   padded 0.3 s each side (the build_refs.py spans_of convention) — every
#   scored frame lies inside a span, with >= 0.3 s of context.
# Usage: python sess_detect.py DET [--sessions=a,b] [--procs=N] [--threads=T]
# Output: <WORK>/out/sess/<DET>/<session>.npz  t, f (voicing-gated), r (raw), p, cpu, dur
import sys, os, json, time
import numpy as np, pandas as pd, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import detectors as D
from paths import OUT, SESSIONS_ROOT, PARQ
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
POS = [a for a in sys.argv[1:] if not a.startswith("--")]
DET = POS[0] if POS else ""
ROOT = SESSIONS_ROOT
SESSIONS = A.get("sessions", "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")
FULL = DET.startswith("praat")


def spans(s):
    df = pd.read_parquet(f"{ROOT}/{s}/{PARQ}", columns=["timestamp_s", "speaker"])
    t = df.timestamp_s.values[df.speaker.isin(["alice", "second"]).values]
    sp = []
    for v in t:
        if sp and v - sp[-1][1] < 0.5: sp[-1][1] = v
        else: sp.append([v, v])
    return [(max(0.0, a - 0.3), b + 0.3) for a, b in sp]


def _one(args):
    det, x, sr, a, threads = args
    if det.startswith(("penn", "crepe")):
        import torch; torch.set_num_threads(threads)
    if det == "swift_offline":
        import swift; t, f, r, p = swift.offline(x, sr)
    else:
        t, f, r, p = D.run(det, x, sr)
    if r is None: r = f
    if p is None: p = np.zeros(len(t))
    return a, np.asarray(t) + a, np.asarray(f, float), np.asarray(r, float), np.asarray(p, float)


if __name__ == "__main__":
    procs = int(A.get("procs", 4)); threads = int(A.get("threads", 1))
    od = os.path.join(OUT, "sess", DET); os.makedirs(od, exist_ok=True)
    for s in SESSIONS:
        x, sr = sf.read(f"{ROOT}/{s}/session.wav", dtype="float32")
        t0 = time.time(); c0 = time.process_time()
        if FULL:
            a, t, f, r, p = _one((DET, x, sr, 0.0, threads)); cpu = time.process_time() - c0; dur = len(x) / sr
        else:
            sp = spans(s)
            jobs = [(DET, x[int(a * sr):min(len(x), int(b * sr))], sr, int(a * sr) / sr, threads) for a, b in sp if (b - a) * sr >= 1600]
            dur = sum(len(j[1]) for j in jobs) / sr
            from multiprocessing import Pool
            with Pool(procs) as pool:
                out = sorted(pool.map(_one, jobs, chunksize=1), key=lambda z: z[0])
            t = np.concatenate([o[1] for o in out]); f = np.concatenate([o[2] for o in out])
            r = np.concatenate([o[3] for o in out]); p = np.concatenate([o[4] for o in out])
            cpu = float("nan")
        np.savez_compressed(os.path.join(od, f"{s}.npz"), t=t, f=f, r=r, p=p, cpu=cpu, dur=dur)
        print(f"{DET} {s}: {dur/60:.1f} min audio, {len(t)} frames, {time.time()-t0:.0f}s elapsed", flush=True)
