# train.py — custom voice detector (2026-10-06): train one model on the
# pre-registered TRAINING split (pack.py), with on-the-fly mixtures.
#
# Each example is one crop of L seconds (L cycles over --crops, the batch size
# scales so every batch holds the same audio time):
#   mix    (p_mix)   a training voice segment (1.5 s .. L, placed at a random
#                    offset; 30 % start with the crop = lead 0) inside a
#                    training negative (looped), SNR drawn from --snr (voice
#                    active RMS, 2 %-of-peak rule, over noise RMS — the
#                    benchmark's SNR); 25 % add a second negative
#   voice  (p_voice) a clean training voice crop (+ a -85..-60 dBFS floor)
#   noise  (rest)    negatives only (25 % two of them)
# Negatives: FSD50K machine / room, FSD50K other, fstrain, the synthetic bank
# (--neg weights; machine / room material >= half of the draws, §1.2).
# Voice sources: --vsrc weights (held notes and sustained vowels emphasised).
# Augmentation on the GPU: reverberation (the RIR bank), random EQ (tilt,
# peaks, high- / low-pass incl. telephone band), speed perturbation of the
# voice (pitch and formants together, +-6 %), level (mixture RMS -55..-12
# dBFS), noise floor.
# Labels (pre-registration §1.1, tcommon.voice_labels): a frame is positive
# where its centre lies on a positive Praat frame of the voice layer; in a mix
# every other frame is negative except the boundary margin; in a clean voice
# crop only positives count (the rest is masked); noise crops: all negative.
# Loss: BCE, positives weighted --wpos (missing voice costs more), optional
# hard-negative weight --whard on frames of the "tonal" synthetic families.
#
# Round 2 (pre-registration Addendum D; all default off = the round-1 recipe):
#   --vtag=r2      the voice packs with the round-2 positives (pack.py --tag=r2)
#   --p_rough=P    roughness resynthesis of the voice layer: periodic shimmer
#                  (AM 15-40 Hz, depth 0.3-0.95), half the time followed by a
#                  one-pole low-pass at 0.8-3 kHz (closed lips)
#   --p_breath=P   breathiness: white noise high-passed at 500 Hz, shaped by the
#                  voice layer's 20 ms envelope, at -25..-6 dB re the voice
#   --p_state=P    a crop starts from a GRU state drawn from a bank of the final
#                  states of recent crops (--bank=N, FIFO) instead of zeros
#                  (training on states after histories of any length)
# Labels are unchanged by all three.
#
# Round 3 (pre-registration 2026-10-07 §3.1; Addendum R3-B; default off):
#   cfg "leak_tau": T  the GRU state decays, h <- exp(-12.5 ms / T) * h before
#                  every frame (model.py), in training and in streaming (B-leak)
#   --p_sess=P     a share P of every batch's audio time is ONE-ROOM TRAINING
#                  SESSIONS (B-sess): --sess_len=64,128 s, built as the
#                  pre-registration's §2 from TRAINING sources only - one voice
#                  group (one speaker / participant / singer of a training
#                  source, drawn with the --vsrc weights, then by voiced time),
#                  its recordings in a random order read in episodes of
#                  U(10, 30) s (0.5 s gaps inside an episode), pauses from
#                  {1, 3, 8, 20, 60} s with p {.3, .3, .2, .15, .05}, a lead of
#                  U(0, 30) s, voice fraction 35-65 % (up to 50 draws, else the
#                  last); one negative bed (--neg weights) looped with 1 s
#                  cross-fades; a session SNR from the round-2 mix distribution,
#                  or clean with p --sess_clean (0.2); one augmentation draw
#                  (room, EQ, level, voice quality, speed) for the whole
#                  session. Each session sits in one of P * sec_per_batch /
#                  --tbptt batch slots and is trained in consecutive --tbptt (8)
#                  s chunks, the GRU state carried (detached) from chunk to
#                  chunk, zero at the session start (truncated BPTT); the
#                  convolutions get 4 frames of lead-in audio per chunk. Labels:
#                  the mix rule inside voice placements (clean sessions: only
#                  positives count there), negative in the pauses.
#                  The rest of the batch: the round-2 crops (--p_state 0 = no
#                  state bank for B-sess).
#
#   <venv>/python scripts/voice-detector/train/train.py --name=NAME [--steps=20000] [--cfg=JSON] [--wpos=3] ...
import json
import math
import os
import queue
import threading
import time

import numpy as np
import torch
import torch.nn.functional as F

import model as M
from tcommon import SR, TRAIN, args

A = args()
NAME = A["name"]
OUT = os.path.join(TRAIN, "runs", NAME)
os.makedirs(OUT, exist_ok=True)
STEPS = int(A.get("steps", "20000"))
SEC_PER_BATCH = float(A.get("sec_per_batch", "768"))
CROPS = [float(v) for v in A.get("crops", "4,8,16,32").split(",")]
LR = float(A.get("lr", "2e-3"))
WPOS = float(A.get("wpos", "3"))
WHARD = float(A.get("whard", "1"))
WHARD_AC = float(A.get("whard_ac", "1"))     # weight of negative frames whose periodicity > AC_THR
AC_THR = float(A.get("ac_thr", "0.45"))
P_MIX, P_VOICE = float(A.get("p_mix", "0.5")), float(A.get("p_voice", "0.15"))
SEED = int(A.get("seed", "1"))
CFG = json.loads(A.get("cfg", "{}"))
EMA = float(A.get("ema", "0"))   # > 0: keep an exponential moving average of the weights (decay EMA) and save it too
VSRC_W = json.loads(A.get("vsrc", '{"librispeech":0.16,"vctk":0.08,"coswara_counting":0.08,"coswara_vowel":0.26,"mdvr":0.05,"dcs":0.12,"esmuc":0.13,"csd":0.12}'))
NEG_W = json.loads(A.get("neg", '{"fsd_machine":0.25,"fsd_other":0.2,"fstrain":0.22,"synth":0.33}'))
SNR_LO, SNR_HI = (float(v) for v in A.get("snr", "-6,30").split(","))
P_REVERB_V, P_REVERB_N = float(A.get("p_rev_v", "0.35")), float(A.get("p_rev_n", "0.2"))
P_SPEED = float(A.get("p_speed", "0.3"))
VTAG = A.get("vtag", "")
P_ROUGH, P_BREATH = float(A.get("p_rough", "0")), float(A.get("p_breath", "0"))
P_STATE, BANK_N = float(A.get("p_state", "0")), int(A.get("bank", "8192"))
P_SESS = float(A.get("p_sess", "0"))
SESS_LO, SESS_HI = (float(v) for v in A.get("sess_len", "64,128").split(","))
TBPTT = float(A.get("tbptt", "8"))
SESS_CLEAN = float(A.get("sess_clean", "0.2"))
PAUSES = np.array([1.0, 3.0, 8.0, 20.0, 60.0])
PPROB = np.array([0.30, 0.30, 0.20, 0.15, 0.05])
DEV = "cuda"


def _blocking_sync():
    """Make CUDA waits sleep instead of spin (cudaDeviceScheduleBlockingSync):
    the shared machine's CPU is the scarce resource, not the GPU."""
    import ctypes
    import glob
    for dll in glob.glob(os.path.join(os.path.dirname(torch.__file__), "lib", "cudart64_*.dll")):
        try:
            ctypes.CDLL(dll).cudaSetDeviceFlags(4)
            return True
        except OSError:
            pass
    return False


BLOCKING = _blocking_sync()
torch.set_num_threads(1)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True


# ----------------------------------------------------------------------------- data
class Bank:
    def __init__(self, name):
        self.x = np.memmap(os.path.join(TRAIN, name + ".i16"), dtype=np.int16, mode="r")
        self.ix = dict(np.load(os.path.join(TRAIN, name + ".npz")))
        self.n = len(self.ix["off"])

    def crop(self, i, start, n, loop):
        o, ln = int(self.ix["off"][i]), int(self.ix["len"][i])
        if loop:
            if ln >= n + start:
                return self.x[o + start:o + start + n]
            clip = np.asarray(self.x[o:o + ln])
            reps = (start + n + ln - 1) // ln
            return np.tile(clip, reps)[start:start + n]
        a = self.x[o + start:o + min(ln, start + n)]
        return a


class Sampler:
    """CPU side: picks files and crops, builds frame labels (numpy)."""

    def __init__(self, split, seed):
        self.rng = np.random.default_rng(seed)
        sfx = f"_{VTAG}" if VTAG else ""
        self.V = Bank(f"voice_{split}{sfx}")
        self.N = Bank(f"nonvoice_{split}")
        self.S = Bank(f"synth_{split}")
        self.rir = np.load(os.path.join(TRAIN, f"rir_{split}.npy"))
        v = self.V.ix
        meta = json.load(open(os.path.join(TRAIN, f"voice_{split}{sfx}.json"), encoding="utf8"))
        srcs, kinds = meta["sources"], meta["kinds"]
        # voiced seconds per file = positive label frames * 10 ms
        pos = np.add.reduceat((v["lab"] == 1).astype(np.int64), v["loff"]) if len(v["loff"]) else np.zeros(0)
        pos = np.where(v["llen"] > 0, pos, 0)
        self.vpools = {}
        for key, w in VSRC_W.items():
            if key.startswith("coswara_"):
                sel = (v["src"] == srcs.index("coswara")) & (v["kind"] == kinds.index(key.split("_")[1]))
            else:
                if key not in srcs:
                    continue
                sel = v["src"] == srcs.index(key)
            ids = np.nonzero(sel & (pos > 50))[0]
            if len(ids):
                p = pos[ids].astype(np.float64)
                self.vpools[key] = (ids, np.cumsum(p) / p.sum(), w)
        tot = sum(w for _, _, w in self.vpools.values())
        self.vkeys = list(self.vpools)
        self.vw = np.cumsum([self.vpools[k][2] / tot for k in self.vkeys])
        n = self.N.ix
        nsrc = json.load(open(os.path.join(TRAIN, f"nonvoice_{split}.json"), encoding="utf8"))["sources"]
        self.npools = {
            "fsd_machine": np.nonzero((n["src"] == nsrc.index("fsd50k")) & n["machine"])[0],
            "fsd_other": np.nonzero((n["src"] == nsrc.index("fsd50k")) & ~n["machine"])[0],
            "fstrain": np.nonzero(n["src"] == nsrc.index("fstrain"))[0],
        }
        self.nkeys = [k for k in NEG_W if k == "synth" or len(self.npools.get(k, []))]
        self.nw = np.array([NEG_W[k] for k in self.nkeys])
        self.nw = np.cumsum(self.nw / self.nw.sum())
        self.stonal = self.S.ix["tonal"]
        self.sec = SEC_PER_BATCH * (1 - P_SESS)      # crop audio per batch (the rest: session chunks)
        # round 3: voice groups per source key (sessions draw one group, weighted by voiced time)
        self.gpools = {}
        for key, (ids, _, _) in self.vpools.items():
            grp = v["group"][ids]
            ug, inv = np.unique(grp, return_inverse=True)
            w = np.bincount(inv, weights=pos[ids].astype(np.float64))
            self.gpools[key] = ([ids[inv == k] for k in range(len(ug))], np.cumsum(w) / w.sum())

    def neg(self, n):
        r = self.rng
        key = self.nkeys[min(int(np.searchsorted(self.nw, r.random())), len(self.nkeys) - 1)]
        if key == "synth":
            i = int(r.integers(self.S.n))
            ln = int(self.S.ix["len"][i])
            x = self.S.crop(i, int(r.integers(ln)), n, True)
            return x, key, bool(self.stonal[i])
        ids = self.npools[key]
        # long clips more often (time-uniform over the pool, capped at 60 s)
        i = int(ids[r.integers(len(ids))])
        ln = int(self.N.ix["len"][i])
        x = self.N.crop(i, int(r.integers(max(1, ln - n))) if ln > n else 0, n, True)
        return x, key, False

    def voice(self, maxlen):
        r = self.rng
        key = self.vkeys[min(int(np.searchsorted(self.vw, r.random())), len(self.vkeys) - 1)]
        ids, cdf, _ = self.vpools[key]
        i = int(ids[min(int(np.searchsorted(cdf, r.random())), len(ids) - 1)])
        ln = int(self.V.ix["len"][i])
        n = min(ln, maxlen)
        st = int(r.integers(0, ln - n + 1))
        x = self.V.crop(i, st, n, False)
        lab = self.V.ix["lab"][self.V.ix["loff"][i]:self.V.ix["loff"][i] + self.V.ix["llen"][i]]
        return x, lab, float(self.V.ix["t0"][i]), st, key

    def batch(self, L):
        r = self.rng
        n = int(L * SR)
        B = max(8, int(round(self.sec / L)))
        T = (n + M.OFF) // M.HOP
        cen = ((np.arange(T) + 1) * M.HOP - M.OFF - CFG.get("win", M.WIN) / 2)   # frame centres (samples, in crop)
        V = np.zeros((B, n), np.int16)
        N1 = np.zeros((B, n), np.int16)
        N2 = np.zeros((B, n), np.int16)
        Y = np.zeros((B, T), np.float32)
        W = np.zeros((B, T), np.float32)
        info = np.zeros((B, 6), np.float32)   # kind, snr, has2, n2 rel dB, tonal, voice-segment start
        for b in range(B):
            u = r.random()
            kind = 0 if u < P_MIX else (1 if u < P_MIX + P_VOICE else 2)
            tonal = False
            if kind in (0, 2):
                x, key, tonal = self.neg(n)
                N1[b] = x
                if r.random() < 0.25:
                    x2, _, t2 = self.neg(n)
                    N2[b] = x2
                    info[b, 2] = 1
                    info[b, 3] = r.uniform(-15, 5)
                    tonal = tonal or t2
            if kind in (0, 1):
                if kind == 0:
                    lv = int(r.uniform(1.5, L) * SR)
                    x, lab, t0, st, key = self.voice(lv)
                    o = 0 if r.random() < 0.3 else int(r.integers(0, n - len(x) + 1))
                else:
                    x, lab, t0, st, key = self.voice(n)
                    o = 0
                V[b, o:o + len(x)] = x
                # labels at frame centres
                ft = (st + cen - o) / SR                                  # file time of each frame centre
                inside = (cen >= o) & (cen < o + len(x))
                j = np.round((ft - t0) / 0.01).astype(np.int64)
                ok = inside & (j >= 0) & (j < len(lab))
                code = np.zeros(T, np.int8)                                # 0 outside the segment
                code[ok] = lab[j[ok]]
                code[inside & ~ok] = 0
                if kind == 0:
                    Y[b] = code == 1
                    W[b] = np.where(code == 2, 0.0, np.where(code == 1, WPOS, 1.0))
                else:
                    Y[b] = code == 1
                    W[b] = np.where(code == 1, WPOS, 0.0)
                info[b, 5] = o
            else:
                W[b] = 1.0
            if kind == 0:
                u = r.random()
                info[b, 1] = r.uniform(SNR_LO, 12) if u < 0.5 else r.uniform(5, SNR_HI)
            info[b, 0] = kind
            info[b, 4] = tonal
        W[:, :2] = 0   # windows reaching before the crop
        if WHARD != 1:
            W *= np.where((info[:, 4:5] > 0) & (Y == 0), WHARD, 1.0)
        return V, N1, N2, Y, W, info


    def session(self):
        """Round 3 (B-sess): one one-room training session (numpy). Returns V, N1 (int16 [n]), Y, W ([T]), info [6]."""
        r = self.rng
        Ls = float(r.uniform(SESS_LO, SESS_HI))
        n = int(Ls * SR)
        T = (n + M.OFF) // M.HOP
        key = self.vkeys[min(int(np.searchsorted(self.vw, r.random())), len(self.vkeys) - 1)]
        gl, gcdf = self.gpools[key]
        files = gl[min(int(np.searchsorted(gcdf, r.random())), len(gl) - 1)].copy()
        r.shuffle(files)
        durs = [int(self.V.ix["len"][i]) / SR for i in files]
        pl = None
        for _ in range(50):
            t = float(r.uniform(0.0, 30.0))
            k, cur, pl = 0, 0.0, []
            while t < Ls - 0.5:
                target, el = float(r.uniform(10.0, 30.0)), 0.0
                while True:
                    df = durs[k % len(files)]
                    d = min(df - cur, target - el, Ls - t)
                    pl.append((k % len(files), cur, t, d))
                    cur += d
                    if cur >= df - 0.05:
                        k, cur = k + 1, 0.0
                    t += d
                    el += d
                    if el >= target - 1e-6 or t >= Ls - 0.5:
                        break
                    t += 0.5
                    if t >= Ls - 0.5:
                        break
                t += float(r.choice(PAUSES, p=PPROB))
            if 0.35 <= sum(q[3] for q in pl) / Ls <= 0.65:
                break
        cen = ((np.arange(T) + 1) * M.HOP - M.OFF - CFG.get("win", M.WIN) / 2)
        V = np.zeros(n, np.float32)
        code = np.zeros(T, np.int8)
        inside = np.zeros(T, bool)
        fade = int(0.01 * SR)
        for fi, fr, at, d in pl:
            i = int(files[fi])
            a, f0 = int(round(at * SR)), int(round(fr * SR))
            ln = int(self.V.ix["len"][i])
            m = min(int(round(d * SR)), ln - f0, n - a)
            if m <= 0:
                continue
            seg = np.asarray(self.V.crop(i, f0, m, False), np.float32)
            m = len(seg)
            e = np.minimum(np.minimum(1.0, (np.arange(m) + 1) / fade), (m - np.arange(m)) / fade).astype(np.float32)
            V[a:a + m] += seg * e
            lab = self.V.ix["lab"][self.V.ix["loff"][i]:self.V.ix["loff"][i] + self.V.ix["llen"][i]]
            t0 = float(self.V.ix["t0"][i])
            ins = (cen >= a) & (cen < a + m)
            j = np.round(((f0 + cen - a) / SR - t0) / 0.01).astype(np.int64)
            ok = ins & (j >= 0) & (j < len(lab))
            code[ok] = lab[j[ok]]
            inside |= ins
        clean = r.random() < SESS_CLEAN
        N1 = np.zeros(n, np.float32)
        tonal = False
        if not clean:
            nk = self.nkeys[min(int(np.searchsorted(self.nw, r.random())), len(self.nkeys) - 1)]
            if nk == "synth":
                i = int(r.integers(self.S.n))
                clip = np.asarray(self.S.crop(i, 0, int(self.S.ix["len"][i]), False), np.float32)
                tonal = bool(self.stonal[i])
            else:
                ids = self.npools[nk]
                i = int(ids[r.integers(len(ids))])
                clip = np.asarray(self.N.crop(i, 0, int(self.N.ix["len"][i]), False), np.float32)
            N1 = loop_bed(clip, n)
        Y = (code == 1).astype(np.float32)
        if clean:
            W = np.where(inside, np.where(code == 1, WPOS, 0.0), 1.0).astype(np.float32)
        else:
            W = np.where(inside & (code == 2), 0.0, np.where(code == 1, WPOS, 1.0)).astype(np.float32)
        W[:2] = 0
        info = np.zeros(6, np.float32)
        info[0] = 1 if clean else 0
        u = r.random()
        info[1] = r.uniform(SNR_LO, 12) if u < 0.5 else r.uniform(5, SNR_HI)
        info[4] = tonal
        return (np.clip(np.round(V), -32768, 32767).astype(np.int16), np.clip(np.round(N1), -32768, 32767).astype(np.int16), Y, W, info)


def loop_bed(x, n, fade_s=1.0):
    """A negative looped with linear cross-fades of fade_s to n samples (as r3/sessions.loop_bed)."""
    x = np.asarray(x, np.float32)
    if len(x) >= n:
        return x[:n].copy()
    nf = max(1, min(int(round(fade_s * SR)), len(x) // 2))
    out = x.copy()
    w = np.linspace(0, 1, nf, dtype=np.float32)
    while len(out) < n:
        out[-nf:] = out[-nf:] * (1 - w) + x[:nf] * w
        out = np.concatenate([out, x[nf:]])
    return out[:n]


# ----------------------------------------------------------------------------- GPU augmentation
def rand_eq(B, nfft, g):
    """Random zero-phase EQ magnitude per example on rfft bins (torch, GPU)."""
    f = torch.linspace(0, SR / 2, nfft // 2 + 1, device=DEV)[None]
    lf = torch.log2(torch.clamp(f, 20) / 1000.0)
    db = torch.zeros(B, f.shape[1], device=DEV)
    tilt = (torch.rand(B, 1, device=DEV, generator=g) * 2 - 1) * 3.0
    db += tilt * lf
    for _ in range(2):
        fc = torch.exp(torch.rand(B, 1, device=DEV, generator=g) * (math.log(5000) - math.log(150)) + math.log(150))
        gain = (torch.rand(B, 1, device=DEV, generator=g) * 2 - 1) * 9.0
        bw = torch.rand(B, 1, device=DEV, generator=g) * 1.5 + 0.3
        on = (torch.rand(B, 1, device=DEV, generator=g) < 0.6).float()
        db += on * gain * torch.exp(-0.5 * ((lf - torch.log2(fc / 1000)) / bw) ** 2)
    hp = (torch.rand(B, 1, device=DEV, generator=g) < 0.3).float()
    fhp = torch.rand(B, 1, device=DEV, generator=g) * 240 + 60
    db += hp * (-40 * torch.log10(1 + (fhp / torch.clamp(f, 1)) ** 2) / 2)
    lp = (torch.rand(B, 1, device=DEV, generator=g) < 0.3).float()
    flp = torch.rand(B, 1, device=DEV, generator=g) * 4000 + 3400
    order = torch.where(torch.rand(B, 1, device=DEV, generator=g) < 0.5, 4.0, 16.0)   # gentle / near-brickwall (8 kHz origin)
    db += lp * (-10 * torch.log10(1 + (f / flp) ** order))
    return 10 ** (db / 20)


def fft_conv(x, h):
    n = x.shape[1] + h.shape[1]
    nf = 1 << (n - 1).bit_length()
    y = torch.fft.irfft(torch.fft.rfft(x, nf) * torch.fft.rfft(h, nf), nf)
    return y[:, :x.shape[1]]


def speed(x, fac):
    """Resample each row by its factor (linear interpolation; pitch + formants together)."""
    B, n = x.shape
    pos = torch.arange(n, device=DEV)[None].float() * fac[:, None]
    i0 = torch.clamp(pos.floor().long(), 0, n - 2)
    fr = pos - i0
    y = x.gather(1, i0) * (1 - fr) + x.gather(1, i0 + 1) * fr
    return torch.where(pos < n - 1, y, torch.zeros_like(y))


def voice_quality(V, g):
    """Round 2: roughness (periodic shimmer + optional lip low-pass) and
    breathiness (envelope-shaped aspiration noise) of the voice layer."""
    B, n = V.shape
    nfft = 1 << (n - 1).bit_length()
    f = torch.linspace(0, SR / 2, nfft // 2 + 1, device=DEV)[None]
    if P_ROUGH > 0:
        on = torch.rand(B, 1, device=DEV, generator=g) < P_ROUGH
        if on.any():
            t = torch.arange(n, device=DEV)[None].float() / SR
            fam = torch.rand(B, 1, device=DEV, generator=g) * 25 + 15
            dep = torch.rand(B, 1, device=DEV, generator=g) * 0.65 + 0.3
            ph = torch.rand(B, 1, device=DEV, generator=g) * 6.283
            m = 1 - dep * (0.5 + 0.5 * torch.sin(2 * math.pi * fam * t + ph))
            Vr = V * m
            lp = torch.rand(B, 1, device=DEV, generator=g) < 0.5
            fc = torch.rand(B, 1, device=DEV, generator=g) * 2200 + 800
            H = torch.where(lp, 1 / torch.sqrt(1 + (f / fc) ** 2), torch.ones_like(f))
            Vr = torch.fft.irfft(torch.fft.rfft(Vr, nfft) * H, nfft)[:, :n]
            V = torch.where(on, Vr, V)
    if P_BREATH > 0:
        on = torch.rand(B, 1, device=DEV, generator=g) < P_BREATH
        if on.any():
            env = F.avg_pool1d(V.abs()[:, None], 321, stride=1, padding=160)[:, 0]
            w = torch.randn(B, n, device=DEV, generator=g)
            Hh = torch.clamp((f - 400) / 200, 0, 1)
            w = torch.fft.irfft(torch.fft.rfft(w, nfft) * Hh, nfft)[:, :n] * env
            pk = V.abs().amax(1, keepdim=True)
            act = (V.abs() > 0.02 * pk).float()
            vr = torch.sqrt((V * V * act).sum(1, keepdim=True) / act.sum(1, keepdim=True).clamp(min=1)).clamp(min=1e-7)
            wr = torch.sqrt((w * w).mean(1, keepdim=True)).clamp(min=1e-9)
            lev = 10 ** ((torch.rand(B, 1, device=DEV, generator=g) * 19 - 25) / 20)
            V = torch.where(on, V + w / wr * vr * lev, V)
    return V


def augment(V, N1, N2, Y, W, info, rir, g):
    V, N1, N2 = (z.float() / 32768 for z in (V, N1, N2))
    B, n = V.shape
    kind = info[:, 0]
    if P_ROUGH > 0 or P_BREATH > 0:
        V = voice_quality(V, g)
    # voice: speed perturbation (labels follow: the frame grid is resampled too)
    if P_SPEED > 0:
        sp = torch.rand(B, device=DEV, generator=g) < P_SPEED
        fac = torch.where(sp, 1 + (torch.rand(B, device=DEV, generator=g) * 2 - 1) * 0.06, torch.ones(B, device=DEV))
        V = speed(V, fac)
        T = Y.shape[1]
        tp = torch.arange(T, device=DEV)[None].float() * fac[:, None]
        j = torch.clamp(tp.round().long(), 0, T - 1)
        vk = (kind < 2)[:, None]
        Y = torch.where(vk, Y.gather(1, j), Y)
        W = torch.where(vk & (tp > T - 1), torch.zeros_like(W), torch.where(vk, W.gather(1, j), W))
        W[:, :2] = 0
    # reverberation
    def rev(x, p):
        on = torch.rand(B, device=DEV, generator=g) < p
        if not on.any():
            return x
        h = rir[torch.randint(0, rir.shape[0], (B,), device=DEV, generator=g)]
        return torch.where(on[:, None], fft_conv(x, h), x)
    V = rev(V, P_REVERB_V)
    N1 = rev(N1, P_REVERB_N)
    # levels: voice active RMS (2 % of peak) vs noise RMS
    pk = V.abs().amax(1, keepdim=True)
    act = (V.abs() > 0.02 * pk).float()
    vrms = torch.sqrt((V * V * act).sum(1) / act.sum(1).clamp(min=1)).clamp(min=1e-6)
    n2 = torch.sqrt((N2 * N2).mean(1)).clamp(min=1e-7)
    n1 = torch.sqrt((N1 * N1).mean(1)).clamp(min=1e-7)
    N = N1 / n1[:, None] + (info[:, 2] > 0).float()[:, None] * N2 / n2[:, None] * (10 ** (info[:, 3] / 20))[:, None]
    nr = torch.sqrt((N * N).mean(1)).clamp(min=1e-7)
    snr = info[:, 1]
    is_mix, is_voice = kind == 0, kind == 1
    ng = torch.where(is_mix, 1.0 / (10 ** (snr / 20)) / nr, torch.where(is_voice, torch.zeros_like(nr), 1.0 / nr))
    vg = torch.where(kind < 2, 1.0 / vrms, torch.zeros_like(vrms))
    x = V * (vg * 0.1)[:, None] + N * (ng * 0.1)[:, None]
    # EQ on the mixture
    nfft = 1 << (n - 1).bit_length()
    eq = torch.rand(B, device=DEV, generator=g) < 0.6
    X = torch.fft.rfft(x, nfft)
    x = torch.where(eq[:, None], torch.fft.irfft(X * rand_eq(B, nfft, g), nfft)[:, :n], x)
    # overall level + floor
    rms = torch.sqrt((x * x).mean(1)).clamp(min=1e-7)
    lev = 10 ** ((torch.rand(B, device=DEV, generator=g) * 43 - 55) / 20)
    x = x * (lev / rms)[:, None]
    floor = 10 ** ((torch.rand(B, device=DEV, generator=g) * 25 - 85) / 20)
    x = x + floor[:, None] * torch.randn(x.shape, device=DEV, generator=g)
    return x.clamp(-1, 1), Y, W


# ----------------------------------------------------------------------------- eval
def periodicity(x, T):
    """Per model frame: Boersma-style normalised autocorrelation peak over lags
    of 75-400 Hz (40 ms Hann window ending with the frame) — a cheap stand-in
    for "the pitch detector would call this voiced" (hard-negative weight)."""
    B, n = x.shape
    L = 640
    ends = (torch.arange(T, device=DEV) + 1) * M.HOP - M.OFF
    xp = F.pad(x, (L, 0))
    idx = (ends[:, None] + torch.arange(L, device=DEV)[None]).clamp(max=n + L - 1)   # padded coords: frame [end-L, end)
    fr = xp[:, idx]                                                  # [B, T, L]
    w = torch.hann_window(L, periodic=False, device=DEV)
    fr = (fr - fr.mean(-1, keepdim=True)) * w
    nf = 2048
    r = torch.fft.irfft(torch.fft.rfft(fr, nf).abs() ** 2, nf)[..., :L]
    rw = torch.fft.irfft(torch.fft.rfft(w, nf).abs() ** 2, nf)[:L]
    r = r / r[..., :1].clamp(min=1e-12) / (rw / rw[0]).clamp(min=1e-3)
    lo, hi = SR // 400, SR // 75 + 1
    return r[..., lo:hi].amax(-1)                                     # [B, T]


def frame_metrics(p, y, w):
    """AUC over weighted frames + recall at the thresholds giving 10 % / 30 % FPR on negatives."""
    m = w > 0
    p, y = p[m], y[m]
    pos, neg = p[y > 0.5], p[y < 0.5]
    if not len(pos) or not len(neg):
        return {}
    allp = np.concatenate([pos, neg])
    ranks = allp.argsort().argsort().astype(np.float64)
    auc = (ranks[:len(pos)].sum() - len(pos) * (len(pos) - 1) / 2) / (len(pos) * len(neg))
    out = {"auc": float(auc)}
    for fpr in (0.1, 0.3):
        thr = np.quantile(neg, 1 - fpr)
        out[f"tpr@fpr{int(fpr * 100)}"] = float((pos > thr).mean())
    # negatives' rejection at the threshold keeping 99 % of positives
    thr = np.quantile(pos, 0.01)
    out["tnr@tpr99"] = float((neg < thr).mean())
    return out


def main():
    torch.manual_seed(SEED)
    net = M.build(CFG).to(DEV) if CFG else M.VoiceNet().to(DEV)
    print(f"{NAME}: {net.n_params()} parameters, rf {net.rf} frames = frame_ms {net.frame_ms}", flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=LR, weight_decay=1e-4)
    ema = None
    if EMA > 0:
        import copy
        ema = copy.deepcopy(net).eval()
        for q_ in ema.parameters():
            q_.requires_grad_(False)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 500) * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * min(s, STEPS) / STEPS))))
    rir_tr = torch.from_numpy(np.load(os.path.join(TRAIN, "rir_train.npy"))).to(DEV)
    rir_va = torch.from_numpy(np.load(os.path.join(TRAIN, "rir_val.npy"))).to(DEV)
    # fixed validation batches (val split + val banks, fixed seeds)
    vs = Sampler("val", 1_000_000_123)
    gv = torch.Generator(device=DEV)
    gv.manual_seed(1_000_000_007)
    valb = []
    for k in range(12):
        V, N1, N2, Y, W, info = vs.batch(8.0)
        t = [torch.from_numpy(a).to(DEV) for a in (V, N1, N2, Y, W, info)]
        x, Yv, Wv = augment(*t, rir_va, gv)
        valb.append((x.cpu(), Yv.cpu(), Wv.cpu(), t[5].cpu()))
    del vs
    NTH = int(A.get("threads", "2"))
    trs = [Sampler("train", SEED * 1000 + i) for i in range(NTH)]
    q = queue.Queue(maxsize=6)
    stop = threading.Event()

    def producer(i):
        k = i
        while not stop.is_set():
            L = CROPS[k % len(CROPS)]
            k += NTH
            q.put(trs[i].batch(L))
    ths = [threading.Thread(target=producer, args=(i,), daemon=True) for i in range(NTH)]
    # round 3 (B-sess): session slots, trained in TBPTT chunks with the GRU state carried
    NS = int(round(SEC_PER_BATCH * P_SESS / TBPTT)) if P_SESS > 0 else 0
    CH = int(round(TBPTT * SR)) // M.HOP
    KLI = net.rf - 1
    if NS:
        sss = [Sampler("train", SEED * 1000 + 500 + i) for i in range(2)]
        sq = queue.Queue(maxsize=24)

        def sproducer(i):
            while not stop.is_set():
                sq.put(sss[i].session())
        ths += [threading.Thread(target=sproducer, args=(i,), daemon=True) for i in range(len(sss))]
        print(f"sessions: {NS} slots x {CH} frames (+{KLI} lead-in), crops {trs[0].sec:.0f} s per batch", flush=True)
    for t in ths:
        t.start()
    g = torch.Generator(device=DEV)
    g.manual_seed(SEED)
    bank = torch.zeros(net.cfg["gru_layers"], BANK_N, net.cfg["gru"], device=DEV) if P_STATE > 0 else None
    slots = [None] * NS
    hs = torch.zeros(net.cfg["gru_layers"], max(NS, 1), net.cfg["gru"], device=DEV)
    XLEN = (CH + KLI - 1) * M.HOP + CFG.get("win", M.WIN)

    def new_slot():
        Vs, N1s, Ys_, Ws_, infs = sq.get()
        t_ = [torch.from_numpy(a_).to(DEV)[None] for a_ in (Vs, N1s, np.zeros_like(N1s), Ys_, Ws_, infs)]
        with torch.no_grad():
            x_, Y_, W_ = augment(*t_, rir_tr, g)
            if WHARD_AC != 1:
                per_ = periodicity(x_, Y_.shape[1])
                W_ = W_ * torch.where((Y_ < 0.5) & (per_ > AC_THR), WHARD_AC, 1.0)
        z0 = torch.zeros(net.pad + KLI * M.HOP, device=DEV)
        z1 = torch.zeros(CH * M.HOP, device=DEV)
        return {"x": torch.cat([z0, x_[0], z1]), "Y": Y_[0], "W": W_[0], "n": Y_.shape[1], "pos": 0}
    bank_fill, bank_pos = 0, 0
    log = open(os.path.join(OUT, "log.jsonl"), "a", encoding="utf8")
    json.dump({"args": A, "cfg": net.cfg, "params": net.n_params()}, open(os.path.join(OUT, "config.json"), "w"), indent=1)
    t0 = time.time()
    run_loss = 0.0
    run_loss_t = torch.zeros((), device=DEV)
    print(f"blocking sync: {BLOCKING}", flush=True)
    start = 0
    last = os.path.join(OUT, "last.pt")
    if "resume" in A and os.path.exists(last):   # continue after a crash (GPU driver reset on the shared machine)
        st = torch.load(last, map_location=DEV, weights_only=False)
        net.load_state_dict(st["model"]); opt.load_state_dict(st["opt"]); sched.load_state_dict(st["sched"])
        if ema is not None and st.get("ema") is not None:
            ema.load_state_dict(st["ema"])
        g.set_state(st["gstate"])
        start = st["step"] + 1
        print(f"resumed at step {start}", flush=True)
    for step in range(start, STEPS + 1):
        if step % 1000 == 0 or step == STEPS:
            net.eval()
            P, Yl, Wl, K = [], [], [], []
            with torch.no_grad():
                for x, Yv, Wv, info in valb:
                    xp = F.pad(x.to(DEV), (net.pad, 0))[:, :net.pad + Yv.shape[1] * M.HOP - M.OFF]
                    P.append(torch.sigmoid(net(xp)).cpu().numpy())
                    Yl.append(Yv.numpy()); Wl.append(Wv.numpy()); K.append(np.repeat(info[:, 0:1].numpy(), Yv.shape[1], 1))
            P, Yl, Wl, K = (np.concatenate([a.ravel() for a in Z]) for Z in (P, Yl, Wl, K))
            met = frame_metrics(P, Yl, Wl)
            met_noise = {"noise_p_mean": float(P[(K == 2) & (Wl > 0)].mean()), "noise_p_p99": float(np.quantile(P[(K == 2) & (Wl > 0)], 0.99))}
            run_loss = float(run_loss_t)
            run_loss_t = torch.zeros((), device=DEV)
            rec = {"step": step, "time": round(time.time() - t0, 1), "loss": run_loss / max(1, min(step, 1000) if step else 1), "lr": sched.get_last_lr()[0], **met, **met_noise}
            print(json.dumps(rec), flush=True)
            log.write(json.dumps(rec) + "\n")
            log.flush()
            run_loss = 0.0
            torch.save({"model": net.state_dict(), "cfg": net.cfg, "step": step, "args": A}, os.path.join(OUT, f"ckpt_{step:06d}.pt"))
            if ema is not None:
                with torch.no_grad():
                    for be, bn in zip(ema.buffers(), net.buffers()):
                        be.copy_(bn)       # BatchNorm running statistics from the live model
                    P2 = []
                    for x, Yv, Wv, info in valb:
                        xp = F.pad(x.to(DEV), (net.pad, 0))[:, :net.pad + Yv.shape[1] * M.HOP - M.OFF]
                        P2.append(torch.sigmoid(ema(xp)).cpu().numpy())
                    P2 = np.concatenate([a_.ravel() for a_ in P2])
                    me = frame_metrics(P2, Yl, Wl)
                    rec_e = {"step": step, "ema": True, **me, "noise_p_mean": float(P2[(K == 2) & (Wl > 0)].mean())}
                    print(json.dumps(rec_e), flush=True)
                    log.write(json.dumps(rec_e) + "\n")
                    log.flush()
                torch.save({"model": ema.state_dict(), "cfg": net.cfg, "step": step, "args": A, "ema": EMA}, os.path.join(OUT, f"ckpt_ema_{step:06d}.pt"))
            torch.save({"model": net.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "step": step,
                        "ema": ema.state_dict() if ema is not None else None, "gstate": g.get_state()}, last + ".tmp")
            os.replace(last + ".tmp", last)
            net.train()
            if step == STEPS:
                break
        V, N1, N2, Y, W, info = q.get()
        t = [torch.from_numpy(a).to(DEV, non_blocking=True) for a in (V, N1, N2, Y, W, info)]
        with torch.no_grad():
            x, Yb, Wb = augment(*t, rir_tr, g)
            xp = F.pad(x, (net.pad, 0))[:, :net.pad + Yb.shape[1] * M.HOP - M.OFF]
            if WHARD_AC != 1:
                per = periodicity(x, Yb.shape[1])
                Wb = Wb * torch.where((Yb < 0.5) & (per > AC_THR), WHARD_AC, 1.0)
        if NS:
            Xs = torch.empty(NS, XLEN, device=DEV)
            Ys = torch.zeros(NS, CH, device=DEV)
            Ws = torch.zeros(NS, CH, device=DEV)
            with torch.no_grad():
                for i_, sl in enumerate(slots):
                    if sl is None or sl["pos"] >= sl["n"]:
                        slots[i_] = sl = new_slot()
                        hs[:, i_] = 0
                    a_ = sl["pos"]
                    Xs[i_] = sl["x"][a_ * M.HOP:a_ * M.HOP + XLEN]
                    m_ = min(CH, sl["n"] - a_)
                    Ys[i_, :m_] = sl["Y"][a_:a_ + m_]
                    Ws[i_, :m_] = sl["W"][a_:a_ + m_]
                    sl["pos"] += CH
            logits_s, _, hT_s = net.body(net.front(Xs), None, hs, skip=KLI)
            hs = hT_s.detach()
        if bank is not None:
            Bn = xp.shape[0]
            h0 = torch.zeros(net.cfg["gru_layers"], Bn, net.cfg["gru"], device=DEV)
            if bank_fill:
                use = torch.rand(Bn, device=DEV, generator=g) < P_STATE
                pick = torch.randint(0, bank_fill, (Bn,), device=DEV, generator=g)
                h0 = torch.where(use[None, :, None], bank[:, pick], h0)
            logits, _, hT = net.body(net.front(xp), None, h0)
            with torch.no_grad():
                idx = (bank_pos + torch.arange(Bn, device=DEV)) % BANK_N
                bank[:, idx] = hT.detach()
                bank_pos = (bank_pos + Bn) % BANK_N
                bank_fill = min(BANK_N, bank_fill + Bn)
        else:
            logits = net(xp)
        if NS:
            loss = ((F.binary_cross_entropy_with_logits(logits, Yb, reduction="none") * Wb).sum()
                    + (F.binary_cross_entropy_with_logits(logits_s, Ys, reduction="none") * Ws).sum()) / (Wb.sum() + Ws.sum()).clamp(min=1)
        else:
            loss = (F.binary_cross_entropy_with_logits(logits, Yb, reduction="none") * Wb).sum() / Wb.sum().clamp(min=1)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        opt.step()
        sched.step()
        if ema is not None:
            with torch.no_grad():
                d = min(EMA, (1 + step) / (10 + step))
                for pe, pn in zip(ema.parameters(), net.parameters()):
                    pe.mul_(d).add_(pn.detach(), alpha=1 - d)
        run_loss_t = run_loss_t + loss.detach()
    stop.set()
    print(f"{NAME}: done in {time.time() - t0:.0f} s", flush=True)
    os._exit(0)


if __name__ == "__main__":
    main()
