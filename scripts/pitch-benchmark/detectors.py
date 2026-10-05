# detectors.py — offline reference pitch trackers for the 2026-10-04 detector
# benchmark. Every detector returns (t_seconds, f0_hz) with f0 = 0 for frames
# it calls unvoiced; t is the centre of the frame the value describes, in the
# detector's own documented convention (the scorer then sweeps a residual
# offset per detector x dataset).
#
# Detectors (all CPU):
#   praat_ac      parselmouth to_pitch_ac, Praat defaults (floor 75, ceiling 600,
#                 15 cand., silence .03, voicing .45, octave .01, jump .35,
#                 v/uv .14, 10 ms step) — full-utterance Viterbi
#   praat_ac_cal  same, floor 100 / ceiling 500 (the session labels' config)
#   praat_cc      parselmouth to_pitch_cc, Praat defaults (75-600)
#   pyin          librosa.pyin fmin 65, fmax 800, 16 kHz, hop 160 (10 ms),
#                 frame 1024 (64 ms), centred frames; voiced_flag as voicing
#   penn          PENN FCNF0++ (penn 1.0.0), the 2026-10-03 session-reference
#                 setup (hop 10 ms, fmin 50, fmax 600, center half-hop,
#                 viterbi). Stored gated at PENN_VOICING 0.065 (README), but
#                 the scorers re-gate from the stored periodicity at 0.10:
#                 in penn 1.0.0 periodicity never drops below ~0.071, so
#                 0.065 voices every frame (measurement section 4)
#   crepe_full / crepe_tiny  torchcrepe, 16 kHz, hop 10 ms, fmin 50, fmax 800,
#                 viterbi decoder, periodicity median-3 filtered, voiced iff
#                 periodicity >= 0.21 (torchcrepe README threshold)
#
# Usage: python detectors.py DET CORPUS[,CORPUS] [--procs=N] [--threads=T]
#        (crepe_* need torchcrepe: a venv with --system-site-packages + torchcrepe)
# Output: <WORK>/out/<DET>/<corpus>.npz  keys "<trackId>|t", "<trackId>|f" (voicing-
#         gated), "<trackId>|r" (raw pitch on every frame) and "|p"
#         (periodicity / voiced probability) where the detector has them, and
#         "__cpu" = [cpu_seconds, audio_seconds].
import sys, os, json, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import DATA, OUT
PENN_VOICING = 0.065
CREPE_VOICING = 0.21


def resample_to(x, sr, sr_out):
    if sr == sr_out:
        return x.astype(np.float32)
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(int(sr), int(sr_out))
    return resample_poly(x.astype(np.float64), sr_out // g, sr // g).astype(np.float32)


def praat_ac(x, sr, floor=75.0, ceiling=600.0):
    import parselmouth
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    p = snd.to_pitch_ac(time_step=0.01, pitch_floor=floor, pitch_ceiling=ceiling)
    return p.xs(), p.selected_array["frequency"]


def praat_cc(x, sr):
    import parselmouth
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    p = snd.to_pitch_cc(time_step=0.01, pitch_floor=75.0, pitch_ceiling=600.0)
    return p.xs(), p.selected_array["frequency"]


def pyin(x, sr):
    import librosa
    y = resample_to(x, sr, 16000)
    f0, vflag, vprob = librosa.pyin(y, fmin=65.0, fmax=800.0, sr=16000, frame_length=1024, hop_length=160, center=True, fill_na=None)
    t = np.arange(len(f0)) * 0.01
    return t, np.where(vflag & np.isfinite(f0), f0, 0.0), np.nan_to_num(f0), vprob


def penn_raw(x, sr, fmin=50.0, fmax=600.0):
    import torch, penn, warnings
    warnings.filterwarnings("ignore")
    xt = torch.tensor(x.astype(np.float32))[None]
    if xt.shape[1] < 1600:
        xt = torch.nn.functional.pad(xt, (0, 1600 - xt.shape[1]))
    p, per = penn.from_audio(xt, sr, hopsize=0.01, fmin=fmin, fmax=fmax, batch_size=512,
                             center='half-hop', interp_unvoiced_at=None, gpu=None)
    n = p.shape[1]
    return (np.arange(n) + 0.5) * 0.01, p[0].numpy().astype(np.float64), per[0].numpy().astype(np.float64)


def penn(x, sr):
    t, f, per = penn_raw(x, sr)
    return t, np.where(per >= PENN_VOICING, f, 0.0), f, per


def crepe(x, sr, model):
    import torch, torchcrepe
    y = resample_to(x, sr, 16000)
    yt = torch.tensor(y)[None]
    f, per = torchcrepe.predict(yt, 16000, hop_length=160, fmin=50.0, fmax=800.0, model=model,
                                decoder=torchcrepe.decode.viterbi, return_periodicity=True,
                                batch_size=1024, device='cpu', pad=True)
    per = torchcrepe.filter.median(per, 3)
    f = f[0].numpy().astype(np.float64); per = per[0].numpy().astype(np.float64)
    t = np.arange(len(f)) * 0.01
    return t, np.where(per >= CREPE_VOICING, f, 0.0), f, per


def run(det, x, sr):
    """-> (t, f_voiced_gated, f_raw_or_None, periodicity_or_None)"""
    if det == "praat_ac": return (*praat_ac(x, sr), None, None)
    if det == "praat_ac_cal": return (*praat_ac(x, sr, 100.0, 500.0), None, None)
    if det == "praat_cc": return (*praat_cc(x, sr), None, None)
    if det == "pyin": return pyin(x, sr)
    if det == "penn": return penn(x, sr)
    if det == "crepe_full": return crepe(x, sr, "full")
    if det == "crepe_tiny": return crepe(x, sr, "tiny")
    raise SystemExit(f"unknown detector {det}")


def _work(args):
    det, c, tr, threads = args
    if det.startswith("penn") or det.startswith("crepe"):
        import torch; torch.set_num_threads(threads)
    x = np.fromfile(os.path.join(DATA, c, tr["trackId"] + ".f32"), dtype=np.float32)
    t0 = time.process_time(); w0 = time.perf_counter()
    t, f, raw, per = run(det, x, tr["sr"])
    return tr["trackId"], np.asarray(t, float), np.asarray(f, float), time.process_time() - t0, time.perf_counter() - w0, len(x) / tr["sr"], raw, per


def _store(res, r, cpu, wall, dur):
    res[r[0] + "|t"] = r[1]; res[r[0] + "|f"] = r[2]
    if r[6] is not None: res[r[0] + "|r"] = np.asarray(r[6], float)
    if r[7] is not None: res[r[0] + "|p"] = np.asarray(r[7], float)
    return cpu + r[3], wall + r[4], dur + r[5]


if __name__ == "__main__":
    A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    det, corpora = pos[0], pos[1].split(",")
    procs = int(A.get("procs", 4)); threads = int(A.get("threads", 1))
    index = json.load(open(os.path.join(DATA, "index.json")))
    os.makedirs(os.path.join(OUT, det), exist_ok=True)
    for c in corpora:
        trs = [t for t in index if t["corpus"] == c]
        res = {}; cpu = wall = dur = 0.0; T0 = time.time()
        jobs = [(det, c, t, threads) for t in trs]
        if procs > 1:
            from multiprocessing import Pool
            with Pool(procs) as pool:
                it = pool.imap_unordered(_work, jobs)
                for r in it:
                    cpu, wall, dur = _store(res, r, cpu, wall, dur)
        else:
            for j in jobs:
                cpu, wall, dur = _store(res, _work(j), cpu, wall, dur)
        res["__cpu"] = np.array([cpu, dur, wall])
        np.savez_compressed(os.path.join(OUT, det, f"{c}.npz"), **res)
        print(f"{det} {c}: {len(trs)} tracks, {dur/60:.1f} min audio, cpu {cpu:.0f}s, wall/track-sum {wall:.0f}s, elapsed {time.time()-T0:.0f}s", flush=True)
