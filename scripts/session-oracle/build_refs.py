# build_refs.py — independent F0 references for the session oracle, on the
# session-label parquet's 10 ms frame grid (2026-10-03 half-pitch investigation
# conventions, consolidated from the phase-1 scratch compute_refs.py /
# compute_penn.py / export_refs.py / export_arb2.py).
#
# Per session it writes <out>/<session>.npz with, on the parquet grid:
#   t, spk (1 alice, 2 second voice, 3 outside, 0 unknown — session labels)
#   cal     session-label f0_hz (Praat AC 100-500 in the labels' enrollment run; "R1")
#   ac      Praat AC 50-600 (parselmouth defaults)        } independent of
#   shs     Praat SHS (spectral, ceiling 600)              } the detector
#   cc      Praat CC 50-600                                }
#   penn    PENN FCNF0++ (neural) on the PENN spans (0 elsewhere): Alice spans
#           where any reference >= 140 Hz + the first ~150 s of the second voice voiced
#           speech, 10 ms hop, fmax 600 (optional; requires torch + penn)
#   cons    CONSENSUS: majority over the AC family (cal / Praat AC; the family
#           supports a value if either member is within 5 %), SHS and PENN;
#           a value needs >= 2 family votes and no octave-distinct value may
#           tie it (ambiguous -> 0); Praat voicing (AC family) required.
#           ref = geometric mean of the supporting estimates.
#   strict  STRICT: session-label R1 where Praat CC agrees within 5 % (else 0)
#   arb     odd-multiple arbiter odd_rel dB at f = cons (Alice, cons >= 140)
#   arb2o, arb2e  arbiter at f = 2*cons (Alice, 75 <= cons < 200): odd/even
#           rel dB — odd <= 4 & even >= 8 means cons is a spurious HALF
# and <out>/<session>.spk.json ({t0, dt, spk}) for run.mjs --refs (alice-only
# display pass).
#
# Usage: python scripts/session-oracle/build_refs.py [--out=build/session-oracle/refs]
#          [--sessions=2025-09-08,...] [--root=DIR]  (default $SYRINX_SESSIONS_DIR,
#                                          the private session recordings)
#          [--penn] [--threads=4]          compute PENN (~20 min/session on CPU)
#          [--penn-from=DIR]               reuse <DIR>/<session>.penn.npz (t, f0)
#          [--praat-from=DIR]              reuse <DIR>/<session>.praat.npz (the Praat cache
#                                          this script writes; legacy <DIR>/<session>.npz
#                                          with ac_t/ac_f0/... keys also accepted)
#          [--no-arb]
import sys, os, json, time
import numpy as np, pandas as pd, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from subharmonic import shr

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
OUT = A.get("out", "build/session-oracle/refs"); os.makedirs(OUT, exist_ok=True)
ROOT = A.get("root") or os.environ.get("SYRINX_SESSIONS_DIR")  # the private session recordings (see CLAUDE.md)
SESSIONS = A.get("sessions", "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")
PARQ = "acoustic/frames_enrollment-2026-05-07-v2.parquet"
# Raw speaker labels -> codes: alice 1, outside 3, unknown / empty 0; the one
# remaining label in the files is the second voice in the recordings -> 2.
SPK = {"alice": 1, "outside": 3}


def spk_code(v):
    return SPK.get(v, 0 if not isinstance(v, str) or v in ("", "unknown") else 2)


def agree(x, y, tol=0.05):
    return (x > 0) & (y > 0) & (np.abs(x / np.where(y > 0, y, 1) - 1) < tol)


def consensus(cal, ac, shs, penn):
    """Verbatim port of phase-1 session-attribution/analyze.py consensus()."""
    n = len(cal)
    best_v = np.zeros(n); best_c = np.zeros(n, int); tie = np.zeros(n, bool)
    for v in (cal, ac, shs, penn):
        c = (agree(v, cal) | agree(v, ac)).astype(int) + agree(v, shs).astype(int) + agree(v, penn).astype(int)
        c = np.where(v > 0, c, 0)
        newtie = (c == best_c) & (c > 0) & ~agree(v, best_v)
        tie = np.where(c > best_c, False, tie | newtie)
        upd = c > best_c
        best_v = np.where(upd, v, best_v); best_c = np.where(upd, c, best_c)
    ok = (best_c >= 2) & ~tie & ((cal > 0) | (ac > 0))
    logs = np.zeros(n); cnt = np.zeros(n)
    for v in (cal, ac, shs, penn):
        s = agree(v, best_v); logs += np.where(s, np.log(np.where(v > 0, v, 1)), 0); cnt += s
    return np.where(ok & (cnt > 0), np.exp(logs / np.maximum(cnt, 1)), 0)


def on_grid(t, rt, rf):
    idx = np.clip(np.round((t - rt[0]) / 0.01).astype(int), 0, len(rf) - 1)
    return rf[idx]


def praat(x, sr):
    import parselmouth
    snd = parselmouth.Sound(x, sampling_frequency=sr)
    res = {}
    for name, fn in [
        ("ac", lambda: snd.to_pitch_ac(time_step=0.01, pitch_floor=50, pitch_ceiling=600)),
        ("shs", lambda: snd.to_pitch_shs(time_step=0.01, minimum_pitch=50, max_number_of_candidates=15,
                                          maximum_frequency_component=1250, max_number_of_subharmonics=15,
                                          compression_factor=0.84, ceiling=600, number_of_points_per_octave=48)),
        ("cc", lambda: snd.to_pitch_cc(time_step=0.01, pitch_floor=50, pitch_ceiling=600)),
    ]:
        p = fn(); res[name + "_t"] = p.xs(); res[name + "_f0"] = p.selected_array["frequency"]
    return res


def spans_of(t, pad=0.3, gap=0.5):
    sp = []
    for v in t:
        if sp and v - sp[-1][1] < gap: sp[-1][1] = v
        else: sp.append([v, v])
    return [(max(0, a - pad), b + pad) for a, b in sp]


def penn_spans(t, spk, cal, ac, shs):
    ma = (spk == 1) & ((cal >= 140) | (ac >= 140) | ((shs >= 140) & (cal > 0)))
    sp = spans_of(t[ma])
    ssp = spans_of(t[(spk == 2) & (cal > 0)]); acc = 0; keep = []
    for a, b in ssp:
        if acc > 150: break
        keep.append((a, b)); acc += b - a
    return sorted(sp + keep)


def compute_penn(x, sr, spans):
    import torch, penn, warnings
    warnings.filterwarnings("ignore")
    torch.set_num_threads(int(A.get("threads", 4)))
    xf = x.astype(np.float32); T, F = [], []
    for a, b in spans:
        i0, i1 = int(a * sr), min(len(xf), int(b * sr))
        if i1 - i0 < 1600: continue
        p, _ = penn.from_audio(torch.tensor(xf[i0:i1])[None], sr, hopsize=0.01, fmin=50., fmax=600.,
                               batch_size=512, center='half-hop', interp_unvoiced_at=None, gpu=None)
        T.append(a + (np.arange(p.shape[1]) + 0.5) * 0.01); F.append(p[0].numpy())
    return np.concatenate(T), np.concatenate(F)


if not ROOT:
    raise SystemExit("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)")
for s in SESSIONS:
    t0 = time.time()
    df = pd.read_parquet(f"{ROOT}/{s}/{PARQ}")
    t = df.timestamp_s.values
    spk = df.speaker.map(spk_code).values.astype(np.int8)
    cal = df.f0_hz.fillna(0).values.astype(float)
    x, sr = sf.read(f"{ROOT}/{s}/session.wav", dtype="float64")
    if sr != 16000: raise SystemExit(f"{s}: expected 16 kHz session audio")
    if "praat-from" in A:
        # Reuse the cache this script writes (<DIR>/<session>.praat.npz);
        # <DIR>/<session>.npz with ac_t/ac_f0/... keys (the phase-1 scratch
        # cache layout) is still accepted. Before 2026-10-04 only the latter
        # was read, so the script could not reuse its own cache.
        pc = f"{A['praat-from']}/{s}.praat.npz"
        if not os.path.exists(pc): pc = f"{A['praat-from']}/{s}.npz"
        r = np.load(pc); r = {k: r[k] for k in r.files}
        if "ac_t" not in r: raise SystemExit(f"{pc}: not a Praat cache (no ac_t) - pass the dir holding <session>.praat.npz")
    else:
        r = praat(x, sr)
        np.savez_compressed(f"{OUT}/{s}.praat.npz", **r)
    ac, shs, cc = (on_grid(t, r[m + "_t"], r[m + "_f0"]) for m in ("ac", "shs", "cc"))
    penn_f = np.zeros(len(t))
    pt = pf = None
    if "penn-from" in A:
        p = np.load(f"{A['penn-from']}/{s}.penn.npz"); pt, pf = p["t"], p["f0"]
    elif "penn" in A:
        pt, pf = compute_penn(x, sr, penn_spans(t, spk, cal, ac, shs))
        np.savez_compressed(f"{OUT}/{s}.penn.npz", t=pt, f0=pf)
    if pt is not None:
        o = np.argsort(pt); pt, pf = pt[o], pf[o]
        j = np.clip(np.searchsorted(pt, t), 1, len(pt) - 1)
        jj = np.where(np.abs(pt[j - 1] - t) < np.abs(pt[j] - t), j - 1, j)
        ok = np.abs(pt[jj] - t) <= 0.006
        penn_f[ok] = pf[jj[ok]]
    cons = consensus(cal, ac, shs, penn_f)
    strict = np.where(agree(cc, cal), cal, 0)
    arb = np.full(len(t), np.nan); arb2o = np.full(len(t), np.nan); arb2e = np.full(len(t), np.nan)
    if "no-arb" not in A:
        for i in np.nonzero((spk == 1) & (cons >= 140))[0]:
            arb[i] = shr(x, t[i], cons[i])[0]
        for i in np.nonzero((spk == 1) & (cons >= 75) & (cons < 200))[0]:
            o_, e_, _ = shr(x, t[i], 2 * cons[i]); arb2o[i] = o_; arb2e[i] = e_
    np.savez_compressed(f"{OUT}/{s}.npz", t=t, spk=spk, cal=cal, ac=ac, shs=shs, cc=cc, penn=penn_f,
                        cons=cons, strict=strict, arb=arb, arb2o=arb2o, arb2e=arb2e)
    json.dump({"t0": float(t[0]), "dt": 0.01, "spk": spk.astype(int).tolist()}, open(f"{OUT}/{s}.spk.json", "w"))
    a = spk == 1
    print(f"{s}: {len(t)} frames, alice cons>=160 {int((a & (cons >= 160)).sum())}, strict>=160 {int((a & (strict >= 160)).sum())}, "
          f"penn voiced {int((penn_f > 0).sum())}, {time.time() - t0:.0f}s", flush=True)
