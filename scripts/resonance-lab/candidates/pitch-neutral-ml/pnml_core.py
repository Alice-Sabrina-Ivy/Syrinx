"""Pitch-neutralised ML (pitch-neutral-ml family) — shared core.

Idea: the deployed ECAPA 'Perceived voice' model mostly reports pitch. Remove pitch from
its input first: resynthesise the voiced stretches at a FIXED reference F0 while keeping
the spectral envelope (vocal-tract resonance), then let the unchanged model judge.

Resynthesis engines (all driven by the supplied F0 track, as a browser port would be
driven by the Syrinx pitch track):
  tdpsola   own TD-PSOLA: pitch marks from the F0 track (peak-picked on a 1 kHz low-pass),
            grains = 2 local analysis periods, Hann; output marks every sr/F_ref; voiced
            output RMS-matched to the input per 20 ms; unvoiced audio passed through.
            This is the reference for a JS port.
  praat     Praat To Manipulation (its own pulses; range from the track's percentiles)
            -> constant pitch tier -> overlap-add (Praat PSOLA).
  world     pyworld CheapTrick + D4C on the supplied F0 (5 ms) -> synthesise with
            F0 := F_ref on voiced frames (envelope + aperiodicity kept).
  lpc       crude source-filter vocoder: 18-pole autocorrelation LPC per 5 ms block
            (25 ms Hann, pre-emphasis 0.97), excitation = unit-power pulse train at F_ref
            (voiced) or white noise (unvoiced), de-emphasis. Envelope = LPC only.
  none      no resynthesis (= deployed B2 on the raw audio, for reference).

Model windowing follows B2 / src/ml/gender-worker.js: WIN s window, 150 ms hop, causal,
0.75 s zero ring in front and 0.5 s zero tail, voicing-recency gate (voiced frame in the
trailing 500 ms). Raw per-window logit differences (female - male) are cached on disk,
keyed by the audio + F0 bytes and the resynthesis config, so output transforms (prob vs
logit, EMA) and multi-reference averages reuse the expensive part.
"""
import os
import hashlib
import numpy as np
from scipy.signal import butter, sosfiltfilt, lfilter
from scipy.linalg import solve_toeplitz

LAB = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # scripts/resonance-lab
REPO = os.path.dirname(os.path.dirname(LAB))
CACHE = os.path.join(REPO, "build", "resonance-lab", "pitch-neutral-ml", "cache")
SR = 16000
HOP = 2400
PAD_TAIL = 8000
RECENCY_S = 0.5


# ----------------------------------------------------------------------------- F0 helpers
def voiced_runs(f0, min_frames=3):
    """[(i0, i1)] inclusive runs of voiced 10 ms frames (>= min_frames long)."""
    v = np.r_[False, f0 > 0, False]
    d = np.diff(v.astype(int))
    st, en = np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1
    return [(a, b) for a, b in zip(st, en) if b - a + 1 >= min_frames]


def sample_f0(tr, n):
    """Sample-level F0 (linear interp inside voiced runs; 0 elsewhere) and voiced mask."""
    f = np.zeros(n)
    for a, b in voiced_runs(tr.f0):
        s0 = max(0, int(round((tr.t[a] - 0.005) * SR)))
        s1 = min(n, int(round((tr.t[b] + 0.005) * SR)))
        if s1 - s0 < 2:
            continue
        ts = np.arange(s0, s1) / SR
        f[s0:s1] = np.interp(ts, tr.t[a:b + 1], tr.f0[a:b + 1])
    return f


def smooth_mask(v, ramp=80):
    """0/1 sample mask -> raised-cosine edges (ramp samples) for crossfades."""
    k = np.hanning(2 * ramp + 1)
    k /= k.sum()
    return np.clip(np.convolve(v.astype(float), k, mode="same"), 0, 1)


def rms_match(y, x, mask, frame=320):
    """Scale y per 20 ms frame so its RMS matches x (only where mask)."""
    n = len(x)
    g = np.ones(n)
    nf = int(np.ceil(n / frame))
    gf = np.ones(nf)
    for i in range(nf):
        a, b = i * frame, min(n, (i + 1) * frame)
        if mask[a:b].mean() < 0.5:
            continue
        ry = np.sqrt(np.mean(y[a:b] ** 2) + 1e-12)
        rx = np.sqrt(np.mean(x[a:b] ** 2) + 1e-12)
        gf[i] = np.clip(rx / ry, 0.05, 20)
    centers = (np.arange(nf) + 0.5) * frame
    g = np.interp(np.arange(n), centers, gf)
    return y * g


# ----------------------------------------------------------------------------- TD-PSOLA
_LP = butter(4, 1000, "low", fs=SR, output="sos")


def pitch_marks(x, fs_):
    """Analysis marks for voiced samples (fs_ = sample-level F0, 0 = unvoiced)."""
    xl = sosfiltfilt(_LP, x)
    n = len(x)
    v = fs_ > 0
    d = np.diff(np.r_[0, v.astype(int), 0])
    runs = zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1))
    marks = []
    for s0, s1 in runs:
        T = SR / fs_[s0]
        m = s0 + int(np.argmax(xl[s0:min(s1, s0 + int(T) + 1)]))
        run = []
        while m < s1:
            run.append(m)
            T = SR / max(fs_[m], 40.0)
            lo, hi = int(m + 0.75 * T), int(m + 1.25 * T) + 1
            if lo >= s1 or hi > n:
                break
            m = lo + int(np.argmax(xl[lo:hi]))
        marks.append(np.array(run, int))
    return marks


def tdpsola(x, tr, fref, grain_periods=2.0, grain_ms=None):
    x = np.asarray(x, np.float64)
    n = len(x)
    fs_ = sample_f0(tr, n)
    v = (fs_ > 0).astype(float)
    y = np.zeros(n)
    Tref = SR / fref
    for A in pitch_marks(x, fs_):
        if len(A) < 2:
            continue
        s = float(A[0])
        while s <= A[-1]:
            k = int(np.argmin(np.abs(A - s)))
            m = A[k]
            if grain_ms is None:
                P = int(round(grain_periods * 0.5 * SR / max(fs_[m], 40.0)))
            else:                       # fixed grain: same envelope resolution for every source F0
                P = int(round(0.5 * grain_ms * SR / 1000.0))
            a, b = m - P, m + P + 1
            if a >= 0 and b <= n:
                o = int(round(s)) - P
                if o >= 0 and o + 2 * P + 1 <= n:
                    y[o:o + 2 * P + 1] += x[a:b] * np.hanning(2 * P + 1)
            s += Tref
    y = rms_match(y, x, v)
    vm = smooth_mask(v)
    return (1 - vm) * x + vm * y


# ----------------------------------------------------------------------------- Praat PSOLA
def praat_flat(x, tr, fref):
    import parselmouth
    from parselmouth.praat import call
    vv = tr.f0[tr.f0 > 0]
    if len(vv) < 5:
        return np.asarray(x, np.float64)
    floor = float(max(50.0, 0.7 * np.percentile(vv, 10)))
    ceil = float(min(800.0, max(1.6 * np.percentile(vv, 90), floor * 2.5)))
    snd = parselmouth.Sound(np.asarray(x, np.float64), SR)
    man = call(snd, "To Manipulation", 0.01, floor, ceil)
    pt = call("Create PitchTier", "flat", snd.xmin, snd.xmax)
    call(pt, "Add point", (snd.xmin + snd.xmax) / 2, float(fref))
    call([pt, man], "Replace pitch tier")
    y = call(man, "Get resynthesis (overlap-add)").values[0]
    y = y[:len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))
    return y


# ----------------------------------------------------------------------------- WORLD
def world_flat(x, tr, fref):
    import pyworld as pw
    x = np.asarray(x, np.float64)
    n = len(x)
    t5 = np.arange(int(n / SR / 0.005) + 1) * 0.005
    f0 = np.zeros(len(t5))
    idx = np.clip(np.round((t5 - tr.t[0]) / 0.01).astype(int), 0, len(tr.t) - 1) if len(tr.t) else None
    if idx is not None:
        fi = np.interp(t5, tr.t, tr.f0)
        f0 = np.where(tr.f0[idx] > 0, np.maximum(fi, 40.0), 0.0)
    if not np.any(f0 > 0):
        return x
    sp = pw.cheaptrick(x, f0, t5, SR)
    ap = pw.d4c(x, f0, t5, SR)
    f1 = np.where(f0 > 0, float(fref), 0.0)
    y = pw.synthesize(np.ascontiguousarray(f1), sp, ap, SR, 5.0)
    y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    v = (sample_f0(tr, n) > 0).astype(float)
    return rms_match(y, x, v)


# ----------------------------------------------------------------------------- LPC vocoder
def lpc_flat(x, tr, fref, order=18, hop=80, win=400):
    x = np.asarray(x, np.float64)
    n = len(x)
    xp = lfilter([1, -0.97], [1], x)
    fs_ = sample_f0(tr, n)
    w = np.hanning(win)
    rng = np.random.default_rng(12345)
    e_all = np.zeros(n)
    y = np.zeros(n)
    zi = np.zeros(order)
    Tref = SR / fref
    nextp = 0.0
    for s in range(0, n, hop):
        c = s + hop // 2
        a0 = c - win // 2
        seg = np.zeros(win)
        lo, hi = max(0, a0), min(n, a0 + win)
        seg[lo - a0:hi - a0] = xp[lo:hi]
        seg *= w
        r = np.correlate(seg, seg, "full")[win - 1:win + order]
        if r[0] <= 1e-10:
            a = np.zeros(order)
            g = 0.0
        else:
            r[0] *= 1.0 + 1e-6
            a = solve_toeplitz(r[:order], r[1:order + 1])
            err = r[0] - np.dot(a, r[1:order + 1])
            g = np.sqrt(max(err, 0) / np.sum(w ** 2))
        blk = min(hop, n - s)
        if fs_[min(c, n - 1)] > 0:
            ex = np.zeros(blk)
            while nextp < s + blk:
                if nextp >= s:
                    ex[int(nextp) - s] = np.sqrt(Tref)
                nextp += Tref
        else:
            ex = rng.standard_normal(blk)
            nextp = s + blk
        out, zi = lfilter([g], np.r_[1.0, -a], ex, zi=zi * 1.0)
        y[s:s + blk] = out
    y = lfilter([1], [1, -0.97], y)
    v = (fs_ > 0).astype(float)
    return rms_match(y, x, np.ones(n))  # whole signal re-levelled


ENGINES = {"tdpsola": tdpsola,
           "tdpsolaG67": lambda x, tr, fref: tdpsola(x, tr, fref, grain_ms=6.67),
           "tdpsolaG10": lambda x, tr, fref: tdpsola(x, tr, fref, grain_ms=10.0), "praat": praat_flat, "world": world_flat, "lpc": lpc_flat,
           "none": lambda x, tr, fref: np.asarray(x, np.float64)}


# ----------------------------------------------------------------------------- ECAPA
class Ecapa:
    def __init__(self):
        import onnxruntime as ort
        path = os.path.join(REPO, "node_modules", "@huggingface", "transformers", ".cache", "Alice-Sabrina-Ivy",
                            "voice-gender-classifier-onnx-q8-v2", "onnx", "model_quantized.onnx")
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name

    def logit(self, w):
        lg = self.sess.run(None, {self.inp: w[None, :].astype(np.float32)})[0][0]
        return float(lg[1] - lg[0])        # id2label {0: male, 1: female}


def window_logits(model, y, tr, win_s=0.75):
    """B2-style causal windows over y; returns times and raw logit diffs (NaN where gated)."""
    WIN = int(round(win_s * SR))
    lead = int(0.75 * SR)
    yp = np.concatenate([np.zeros(lead, np.float32), np.asarray(y, np.float32), np.zeros(PAD_TAIL, np.float32)])
    vt = tr.t[tr.f0 > 0] if tr is not None else np.array([])
    ts, ls = [], []
    for end in range(lead + HOP, len(yp) + 1, HOP):
        te = (end - lead) / SR
        if te <= 0:
            continue
        ts.append(te)
        voiced = len(vt) and np.any((vt > te - RECENCY_S) & (vt <= te))
        if not voiced:
            ls.append(np.nan)
            continue
        a = end - WIN
        w = yp[max(0, a):end]
        if a < 0:
            w = np.concatenate([np.zeros(-a, np.float32), w])
        ls.append(model.logit(w))
    return np.array(ts), np.array(ls)


def cache_key(x, tr):
    h = hashlib.sha1()
    h.update(np.ascontiguousarray(x, np.float32).tobytes())
    if tr is not None:
        h.update(np.ascontiguousarray(tr.f0, np.float32).tobytes())
    return h.hexdigest()


def raw_logits(model, x, tr, engine, fref, win_s=0.75):
    """Cached per-window raw logits for one (engine, fref, window) config."""
    cfg = f"{engine}_{int(fref)}_w{int(round(win_s * 1000))}"
    d = os.path.join(CACHE, cfg)
    key = cache_key(x, tr)
    p = os.path.join(d, key[:2], key + ".npy")
    if os.path.exists(p):
        a = np.load(p)
        return a[0], a[1]
    y = ENGINES[engine](x, tr, fref)
    t, l = window_logits(model, y, tr, win_s)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + f".{os.getpid()}.tmp.npy"
    np.save(tmp, np.stack([t, l]))
    os.replace(tmp, p)
    return t, l


def ema_gated(l, alpha=0.2, reset_after=14):
    out = np.full(len(l), np.nan)
    ema, silent = None, 0
    for i, v in enumerate(l):
        if not np.isfinite(v):
            silent += 1
            if silent >= reset_after:
                ema = None
            continue
        silent = 0
        ema = v if ema is None else ema + alpha * (v - ema)
        out[i] = ema
    return out


# ----------------------------------------------------------------------------- embedding head variant
class EcapaEmb:
    """Same q8-v2 graph with the fc6 embedding (relu_33, 192-d) exposed as a 2nd output
    (build/resonance-lab/pitch-neutral-ml/ecapa_q8v2_emb.onnx; weights unchanged)."""
    def __init__(self):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(os.path.join(os.path.dirname(CACHE), "ecapa_q8v2_emb.onnx"), so,
                                         providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name

    def emb(self, w):
        lg, e = self.sess.run(None, {self.inp: w[None, :].astype(np.float32)})
        return e[0]


def window_embs(model, y, tr, win_s=0.75):
    WIN = int(round(win_s * SR))
    lead = int(0.75 * SR)
    yp = np.concatenate([np.zeros(lead, np.float32), np.asarray(y, np.float32), np.zeros(PAD_TAIL, np.float32)])
    vt = tr.t[tr.f0 > 0] if tr is not None else np.array([])
    ts, es = [], []
    for end in range(lead + HOP, len(yp) + 1, HOP):
        te = (end - lead) / SR
        if te <= 0:
            continue
        ts.append(te)
        voiced = len(vt) and np.any((vt > te - RECENCY_S) & (vt <= te))
        if not voiced:
            es.append(np.full(192, np.nan, np.float32))
            continue
        a = end - WIN
        w = yp[max(0, a):end]
        if a < 0:
            w = np.concatenate([np.zeros(-a, np.float32), w])
        es.append(model.emb(w))
    return np.array(ts), np.array(es, np.float32).reshape(len(ts), 192)


def raw_embs(model, x, tr, engine, fref, win_s=0.75):
    cfg = f"emb_{engine}_{int(fref)}_w{int(round(win_s * 1000))}"
    key = cache_key(x, tr)
    p = os.path.join(CACHE, cfg, key[:2], key + ".npz")
    if os.path.exists(p):
        z = np.load(p)
        return z["t"], z["e"].astype(np.float32)
    y = ENGINES[engine](x, tr, fref)
    t, e = window_embs(model, y, tr, win_s)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + f".{os.getpid()}.tmp.npz"
    np.savez(tmp, t=t, e=e.astype(np.float16))
    os.replace(tmp, p)
    return t, e.astype(np.float16).astype(np.float32)
