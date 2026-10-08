# infer_r3.py — custom voice detector, round 3 (pre-registration 2026-10-07
# §3; Addendum R3-B): probability files for the round-3 SELECTION, several
# training checkpoints at once, each run as a plain stream (state from zero at
# the stream start, never reset) and as the copies of the two-copy deployment
# rules (A-mean-T / A-old-T: copy "a" resets its GRU state at 2T, 4T, ...,
# copy "b" at T, 3T, ... frames after the stream start, as stagger.py).
#
# Stream groups (selection data only; the sealed set is refused by
# lib/streams.py and tcommon.read_wav):
#   fresh   the round-1/2 validation streams (vvoice, vmix20, vmix0, vneg) and
#           the benchmark's 194-clip tuning split (noise, split == tune)
#   vsess   the round-3 one-room validation sessions (build/vad-train/r3/vsess),
#           each a 300 s stream: the state is carried through the session
#   spl     the round-2 spliced carried sessions (the selection streams
#           concatenated in the seeded order of round 2's sessions.json, seed
#           20261007, >= 10 min; infer_carried.py's construction), cut back
#           into per-stream files
# Each sequence (a stream, a session) is resampled by the pitch worker's
# linear resampler (tcommon.resample_stream) and run through model.Streaming
# in batches (padded at the END only, so no frame of a sequence sees padding),
# time-chunked, the state carried chunk to chunk; resets zero the GRU state at
# the scheduled frames. GPU torch, TF32 off.
#
#   python infer_r3.py --nets=NAME=CKPT[,NAME=CKPT..] --groups=fresh,vsess,spl --variants=plain,c5a,c5b,c10a,c10b
#          [--out=build/vad-train/r3/cand] [--force]
# Output: <out>/<NAME>/<variant>/<set>/<id>.f32 (fresh, vsess) and
#         <out>/<NAME>/<variant>-spl/<set>/<id>.f32 (spliced), float32 per 12.5 ms frame.
import json
import os
import sys
import time

import numpy as np
import torch

import model as M
from tcommon import HOP, OFF, ROOT, args, resample_stream

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import list_streams, load_audio  # noqa: E402

A = args()
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.."))
VAL = os.path.join(ROOT, "val")
BENCH = os.path.join(REPO, "build", "vad")
VSESS = os.path.join(ROOT, "r3", "vsess")
SPL_JSON = os.path.join(ROOT, "cand", "r8ae-s8000-carried", "sessions.json")   # round 2's spliced construction (seed 20261007)
OUT = A.get("out", os.path.join(ROOT, "r3", "cand"))
VARIANTS = {"plain": None, "c5a": (5, 0), "c5b": (5, 1), "c10a": (10, 0), "c10b": (10, 1)}
FRAME_BUDGET = int(A.get("budget", "300000"))   # batch x chunk frames on the GPU at once
DEV = "cuda"
torch.backends.cudnn.allow_tf32 = False
torch.backends.cuda.matmul.allow_tf32 = False


def resets(n, var):
    if VARIANTS[var] is None:
        return []
    T, ph = VARIANTS[var]
    Tf = int(round(T * 1000 / 12.5))
    first = 2 * Tf if ph == 0 else Tf
    return list(range(first, n, 2 * Tf))


class Net:
    def __init__(self, name, ckpt):
        self.name = name
        self.net, self.ck = M.load_ckpt(ckpt)
        self.net.to(DEV).eval()
        self.st = M.Streaming(self.net).to(DEV).eval()
        self.ctx0 = self.net.ctx

    @torch.no_grad()
    def run(self, seqs, var):
        """seqs: list of 16 kHz float32 arrays (each starts from zero state). Returns a list of probability arrays."""
        ns = [(len(x) + OFF) // HOP for x in seqs]
        N = max(ns)
        B = len(seqs)
        rs = set(resets(N, var))
        state = [t.to(DEV) for t in self.st.init_state(B)]
        out = np.zeros((B, N), np.float32)
        # each sequence as the runner sees it: ctx0 + OFF zeros in front (OnnxEngine), zeros after its end
        src = [np.concatenate([np.zeros(self.ctx0 + OFF, np.float32), x]) for x in seqs]
        m_max = max(1, FRAME_BUDGET // B)
        i = 0
        while i < N:
            if i in rs:
                state[-1] = torch.zeros_like(state[-1])
            nxt = min([r for r in rs if r > i] + [N])
            m = min(m_max, nxt - i)
            a = self.ctx0 + i * HOP
            buf = np.zeros((B, m * HOP), np.float32)
            for b, x in enumerate(src):
                seg = x[a:a + m * HOP]
                buf[b, :len(seg)] = seg
            r = self.st(torch.from_numpy(buf).to(DEV), *state)
            out[:, i:i + m] = r[0].float().cpu().numpy()
            state = list(r[1:])
            i += m
        return [out[b, :ns[b]] for b in range(B)]


def write(path, p):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    p.astype("<f4").tofile(path + ".tmp")
    os.replace(path + ".tmp", path)


def batches(items, lens, max_b=512, max_audio_s=7200.0):
    """Group sequences of similar length (sorted), bounded batch size and audio per group."""
    order = sorted(range(len(items)), key=lambda k: lens[k])
    cur, tot = [], 0.0
    for k in order:
        if cur and (len(cur) >= max_b or tot + lens[k] > max_audio_s or lens[k] > 1.6 * lens[cur[0]] + 5):
            yield [items[j] for j in cur]
            cur, tot = [], 0.0
        cur.append(k)
        tot += lens[k]
    if cur:
        yield [items[j] for j in cur]


def fresh_metas(group):
    ms = _fresh_metas(group)
    if "limit" in A:                 # a test subset (every k-th stream)
        k = max(1, len(ms) // int(A["limit"]))
        ms = ms[::k]
    return ms


def _fresh_metas(group):
    if group == "fresh":
        ms = [(VAL, m) for m in list_streams(VAL, ["vvoice", "vmix20", "vmix0", "vneg"])]
        ms += [(BENCH, m) for m in list_streams(BENCH, ["noise"]) if m.get("split") == "tune"]
        return ms
    if group == "vsess":
        return [(VSESS, m) for m in list_streams(VSESS, ["vsess"])]
    raise ValueError(group)


def run_fresh(nets, variants, group):
    ms = fresh_metas(group)
    lens = [m["audio"]["len"] / m["audio"]["sr"] for _, m in ms]
    t0, done = time.time(), 0
    for bt in batches(ms, lens):
        todo = [(net, v) for net in nets for v in variants
                if "force" in A or not all(os.path.exists(os.path.join(OUT, net.name, v, m["set"], m["id"] + ".f32")) for _, m in bt)]
        if not todo:
            done += len(bt)
            continue
        xs = []
        for _, m in bt:
            x, sr = load_audio(m)
            xs.append(resample_stream(x, sr))
        for net, v in todo:
            ps = net.run(xs, v)
            for (_, m), p in zip(bt, ps):
                write(os.path.join(OUT, net.name, v, m["set"], m["id"] + ".f32"), p)
        done += len(bt)
        print(f"{group}: {done}/{len(ms)} streams ({time.time() - t0:.0f} s)", flush=True)


def run_spl(nets, variants):
    sj = json.load(open(SPL_JSON, encoding="utf8"))
    assert sj["seed"] == 20261007, sj["seed"]
    idx = {}
    for root, m in _fresh_metas("fresh"):
        idx[f"{m['set']}/{m['id']}"] = m
    sess = sj["sessions"]
    t0 = time.time()
    for k0 in range(0, len(sess), 24):         # 24 sessions per GPU batch
        grp = sess[k0:k0 + 24]
        todo = [(net, v) for net in nets for v in variants
                if "force" in A or not all(os.path.exists(os.path.join(OUT, net.name, v + "-spl", s + ".f32")) for ss in grp for s in ss)]
        if not todo:
            continue
        xs, cuts = [], []
        for ss in grp:
            parts, cs, pos = [], [], 0
            for s in ss:
                m = idx[s]
                x, sr = load_audio(m)
                x16 = resample_stream(x, sr)
                n = (len(x16) + OFF) // HOP
                pad = (-len(x16)) % HOP
                parts.append(np.concatenate([x16, np.zeros(pad, np.float32)]) if pad else x16)
                cs.append((s, pos // HOP, n))
                pos += len(parts[-1])
            xs.append(np.concatenate(parts).astype(np.float32))
            cuts.append(cs)
        for net, v in todo:
            ps = net.run(xs, v)
            for p, cs in zip(ps, cuts):
                for s, o, n in cs:
                    seg = p[o:o + n]
                    assert len(seg) == n, (s, len(seg), n)
                    write(os.path.join(OUT, net.name, v + "-spl", s + ".f32"), seg)
        print(f"spl: sessions {k0 + len(grp)}/{len(sess)} ({time.time() - t0:.0f} s)", flush=True)


def main():
    nets = [Net(*kv.split("=", 1)) for kv in A["nets"].split(",")]
    variants = A.get("variants", "plain").split(",")
    for g in A.get("groups", "fresh,vsess,spl").split(","):
        if g == "spl":
            run_spl(nets, variants)
        else:
            run_fresh(nets, variants, g)
    for net in nets:
        meta = {"name": net.name, "ckpt_step": net.ck.get("step"), "cfg": net.net.cfg, "frame_ms": net.net.frame_ms}
        os.makedirs(os.path.join(OUT, net.name), exist_ok=True)
        json.dump(meta, open(os.path.join(OUT, net.name, "net.json"), "w"), indent=1)
    print("done", flush=True)


if __name__ == "__main__":
    main()
