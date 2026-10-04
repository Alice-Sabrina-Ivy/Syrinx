"""private-session session clips (R6 real voices).

Frames: private-session 10 ms parquet with speaker labels (alice / second / ...).
F0: the octave-robust CONSENSUS reference from the 2026-10-03 session-attribution
investigation (AC / SHS / PENN family majority; Praat alone octave-errs on Alice).

Clips = maximal runs of one speaker label (alice or second), >= 0.6 s, split into
<= 8 s chunks, >= 0.3 s consensus-voiced. Group per clip:
  second                                   (second speaker)
  alice_low     median voiced F0 < 165 Hz (private-session VOICE_STATE_SPLIT_DEFAULT)
  alice_mid     165-185 Hz
  alice_raised  >= 185 Hz (private-session BREAK_FLOOR_HZ)      <- the trainee case
Alice clips whose voiced frames are < 60 % inside the clip's own F0 bucket are
labelled alice_mixed (kept, excluded from the ordering metric).
"""
import os
import numpy as np
import pandas as pd
import soundfile as sf
from .paths import SESSIONS_DIR, SESSION_ATTRIB, SR
from .f0 import track_from_frames

CAL = os.path.join(SESSIONS_DIR, "{}", "acoustic", "frames_enrollment-2026-05-07-v2.parquet")
WAV = os.path.join(SESSIONS_DIR, "{}", "session.wav")


def _consensus_fn():
    src = open(os.path.join(SESSION_ATTRIB, "analyze.py")).read()
    ns = {}
    exec(src[src.index("def consensus"):src.index("def stage_index")], {"np": np}, ns)
    return ns["consensus"]


def session_frames(s):
    consensus = _consensus_fn()
    df = pd.read_parquet(CAL.format(s))
    r = np.load(os.path.join(SESSION_ATTRIB, "refs", f"{s}.npz"))
    t = df.timestamp_s.values
    for m in ["ac", "shs", "cc"]:
        rt, rf = r[m + "_t"], r[m + "_f0"]
        df[m] = rf[np.clip(np.round((t - rt[0]) / 0.01).astype(int), 0, len(rf) - 1)]
    df["cal"] = df.f0_hz.fillna(0).values
    p = np.load(os.path.join(SESSION_ATTRIB, "refs", f"{s}.penn.npz"))
    o = np.argsort(p["t"])
    pt, pf = p["t"][o], p["f0"][o]
    j = np.clip(np.searchsorted(pt, t), 1, len(pt) - 1)
    jj = np.where(np.abs(pt[j - 1] - t) < np.abs(pt[j] - t), j - 1, j)
    df["penn"] = np.where(np.abs(pt[jj] - t) <= 0.006, pf[jj], 0.0)
    df["ref"], _, _ = consensus(df)
    return df[["timestamp_s", "speaker", "ref"]].copy()


def bucket(f0):
    return np.where(f0 < 165, 0, np.where(f0 < 185, 1, 2))


def build_clips(s, out_audio_dir, out_f0_dir, min_run=0.6, max_chunk=8.0, min_voiced=0.3):
    fr = session_frames(s)
    x, sr = sf.read(WAV.format(s), dtype="float32")
    assert sr == SR
    spk = fr.speaker.astype(str).values
    t = fr.timestamp_s.values
    ref = fr.ref.values
    rows = []
    i, n = 0, len(fr)
    while i < n:
        j = i
        while j < n and spk[j] == spk[i]:
            j += 1
        if spk[i] in ("alice", "second") and (j - i) * 0.01 >= min_run:
            L = j - i
            k = int(np.ceil(L * 0.01 / max_chunk))
            edges = np.linspace(i, j, k + 1).astype(int)
            for a, b in zip(edges[:-1], edges[1:]):
                f = ref[a:b]
                v = f[f > 0]
                if len(v) * 0.01 < min_voiced:
                    continue
                med = float(np.median(v))
                if spk[i] == "second":
                    grp = "second"
                else:
                    bk = bucket(np.array([med]))[0]
                    frac = float(np.mean(bucket(v) == bk))
                    grp = ["alice_low", "alice_mid", "alice_raised"][bk] if frac >= 0.6 else "alice_mixed"
                t0 = t[a] - 0.005
                s0, s1 = max(0, int(round(t0 * SR))), int(round((t[b - 1] + 0.005) * SR))
                iid = f"cl-{s}-{int(round(t0 * 100)):06d}"
                path = os.path.join(out_audio_dir, iid + ".wav").replace("\\", "/")
                sf.write(path, x[s0:s1], SR, subtype="PCM_16")
                tr = track_from_frames(t[a:b] - s0 / SR, f, (s1 - s0) / SR)
                f0p = os.path.join(out_f0_dir, iid + ".npy").replace("\\", "/")
                tr.save(f0p)
                rows.append(dict(item_id=iid, corpus="sessions", path=path, sr_src=SR, dur_s=(s1 - s0) / SR,
                                 speaker="cl-" + spk[i], sex="", group=grp, vowel="",
                                 session=s, t_start=t0, f0_path=f0p, f0_median=med,
                                 voiced_s=float(len(v) * 0.01)))
        i = j
    return rows
