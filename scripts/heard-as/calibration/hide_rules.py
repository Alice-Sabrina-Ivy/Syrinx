"""Step 5: hide rules for the live 8 s window.
Data: 40 LibriSpeech readers (resonance-choice r1 set: 20 women, 20 men, 5 utterances each, measured with
run_lab.mjs), each speaker's utterances concatenated into one ~35-45 s reading stream. The display is
simulated every 0.5 s over the trailing 8 s (meter: mean fc7 logit of the windows ending in it; F0: ln of
the median voiced 10 ms F0 in it) and compared with the speaker's own all-speech estimate.
Also: voiced share as a singing discriminator (Kong 3 s vocal stems vs 3 s reading chunks), child voices
(bmmb), and the F0 range of the fit data. Writes hide_rules.txt."""
import json
import numpy as np, pandas as pd
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
FIT = json.load(open("fit.json"))
W = 2.0
eta_f = lambda m, l: FIT["a"] + FIT["b_meter"] * m + FIT["c_lnf0"] * l
r1 = pd.read_csv(C.MEAS + "/r1_utts.csv")
spk_of = dict(zip(r1.key, zip(r1.speaker, r1.sex)))
items = [json.loads(l) for l in open(C.MEAS + "/out_r1.jsonl")]
streams = {}
for r in items:
    s, sex = spk_of[r["key"]]
    st = streams.setdefault(s, dict(sex=sex, win=[], f0=[], t0=0.0))
    for k, te, raw, lgt in r["win"]:
        st["win"].append((st["t0"] + te, lgt))
    g = np.array(r["grid"], float)
    st["f0"].extend(zip(st["t0"] + 0.005 + 0.01 * np.arange(len(g)), g))
    st["t0"] += len(g) * 0.01
word = lambda e: np.where(sig(e - W) > 50, "man", np.where(sig(e + W) < 50, "woman", "split"))
rows, chunk_rows = [], []
for s, st in streams.items():
    wt, wl = np.array(st["win"]).T
    ft, fv = np.array(st["f0"]).T
    ref = eta_f(wl.mean(), np.log(np.median(fv[fv > 0])))
    for t in np.arange(2.0, st["t0"] + 1e-9, 0.5):
        wm = (wt > t - 8) & (wt <= t)
        fm = (ft > t - 8) & (ft <= t) & (fv > 0)
        if wm.sum() == 0 or fm.sum() < 10:
            rows.append(dict(spk=s, sex=st["sex"], t=t, V=fm.sum() * 0.01, nW=wm.sum(), eta=np.nan, ref=ref))
            continue
        rows.append(dict(spk=s, sex=st["sex"], t=t, V=fm.sum() * 0.01, nW=wm.sum(),
                         eta=eta_f(wl[wm].mean(), np.log(np.median(fv[fm]))), ref=ref))
    # contiguous spans holding exactly T voiced seconds
    vt = ft[fv > 0]
    for T in [0.5, 1, 1.5, 2, 3, 4, 6]:
        n = int(round(T / 0.01))
        for i0 in range(0, len(vt) - n, 50):
            t_a, t_b = vt[i0] - 0.005, vt[i0 + n - 1] + 0.005
            wm = (wt > t_a + 0.375) & (wt <= t_b + 0.375)       # windows mostly inside the span
            if wm.sum() == 0:
                continue
            e = eta_f(wl[wm].mean(), np.log(np.median(fv[(ft >= t_a) & (ft <= t_b) & (fv > 0)])))
            chunk_rows.append(dict(spk=s, sex=st["sex"], T=T, d=e - ref, flip=word(np.array([e]))[0] != word(np.array([ref]))[0],
                                   dpts=abs(sig(e) - sig(ref))))
D = pd.DataFrame(rows)
K = pd.DataFrame(chunk_rows)
D["d"] = D.eta - D.ref
D["flip"] = word(D.eta.values) != word(D.ref.values)
say(f"Reading streams: {len(streams)} speakers, {D.groupby('spk').t.max().mean():.0f} s each on average; reference = each speaker's all-speech estimate")
say(f"Voiced seconds in the trailing 8 s of continuous reading (after the first 8 s): median {D[D.t >= 8].V.median():.1f} s, "
    f"q10 {D[D.t >= 8].V.quantile(0.1):.1f}, q90 {D[D.t >= 8].V.quantile(0.9):.1f}")
say("\n== Estimate from a span holding exactly T voiced seconds vs the speaker's all-speech estimate ==")
say("   T (s) | SD of eta error (logit) | q90 |eta error| | median / q90 |share error| (points) | three-way word differs from the all-speech word (w 2.0)")
for T, g in K.groupby("T"):
    say(f"   {T:4.1f}  | {g.d.std():.2f} | {np.percentile(np.abs(g.d), 90):.2f} | {g.dpts.median():.1f} / {np.percentile(g.dpts, 90):.1f} | "
        f"{g.flip.mean():.2f} (women {g[g.sex == 'f'].flip.mean():.2f}, men {g[g.sex == 'm'].flip.mean():.2f})")
say("\n== Live 8 s display, by voiced seconds in the window ==")
D["Vb"] = pd.cut(D.V, [-0.01, 1, 2, 3, 4, 5, 99])
for b, g in D[D.eta.notna()].groupby("Vb", observed=True):
    say(f"   V {str(b):12s} ticks {len(g):4d}  SD eta error {g.d.std():.2f}  q90 |share error| {np.percentile(np.abs(sig(g.eta) - sig(g.ref)), 90):5.1f}  word flips {g.flip.mean():.2f}")
say("\n== Effect of a minimum-voiced-seconds rule (hide when the trailing 8 s holds less voiced speech than Vmin) ==")
first = D.groupby("spk").apply(lambda g: g.t.min())
for vmin in [1, 2, 3, 4]:
    shown = D[D.V >= vmin]
    lat = D[D.V >= vmin].groupby("spk").t.min() - first + 2.0
    say(f"   Vmin {vmin} s: hidden {np.mean(D.V < vmin):.2f} of all ticks ({np.mean(D[D.t >= 8].V < vmin):.2f} in steady reading); "
        f"first number after {lat.median():.1f} s of reading (median); shown ticks: word flips {shown.flip.mean():.2f}, "
        f"q90 |share error| {np.percentile(np.abs(sig(shown.eta) - sig(shown.ref)), 90):.1f} points")

# ---------------------------------------------------------------- singing: voiced share
kong = pd.read_csv(C.FE + "/kong-strada/stimuli.csv", low_memory=False)
kong = kong[(kong.audio_ok == True)]
kshare = (kong.voiced_prod / kong.dur).dropna()
sp = []
for s, st in streams.items():
    ft, fv = np.array(st["f0"]).T
    for t0 in np.arange(0, st["t0"] - 3, 1.5):
        m = (ft >= t0) & (ft < t0 + 3)
        sp.append(np.mean(fv[m] > 0))
sp = np.array(sp)
sp8 = D[D.t >= 8].V.values / 8
say("\n== Singing: voiced share of a 3 s span (production pitch replica) ==")
say(f"   reading (LibriSpeech, 3 s spans): median {np.median(sp):.2f}, q90 {np.percentile(sp, 90):.2f}, q99 {np.percentile(sp, 99):.2f}")
say(f"   singing (Kong vocal stems, 3 s): median {kshare.median():.2f}, q10 {kshare.quantile(0.1):.2f}")
for thr in [0.75, 0.8, 0.85, 0.9]:
    say(f"   rule 'hide if voiced share > {thr}': hides {np.mean(kshare > thr):.2f} of sung spans, {np.mean(sp > thr):.3f} of 3 s reading spans, "
        f"{np.mean(sp8 > thr):.3f} of 8 s reading windows")

# ---------------------------------------------------------------- children, F0 range
H = set_target(load(), "half")
bm = H[H.src == "bmmb"]
f0 = np.exp(bm.lnf0)
FS = ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695"]
Fit = H[H.fset.isin(FS) & H[CUE].notna().all(axis=1)]
ff = np.exp(Fit.lnf0)
say("\n== Children and the F0 range ==")
say(f"   fit-set F0 range {ff.min():.0f}-{ff.max():.0f} Hz (q99 {ff.quantile(0.99):.0f}); Palette max {np.exp(C.PAL.lnf0.max()):.0f} Hz")
for side in ["fem", "masc", "child-f", "child-m"]:
    v = f0[bm.side == side]
    say(f"   bmmb {side:8s} /hid/ F0 median {v.median():.0f} Hz (q10 {v.quantile(0.1):.0f}, q90 {v.quantile(0.9):.0f}); share above 250 Hz {np.mean(v > 250):.2f}")
lt = H[(H.src == "libritts-p") & (H.side == "fem")]
say(f"   LibriTTS-P women (running speech) F0 share above 250 Hz {np.mean(np.exp(lt.lnf0) > 250):.3f}, above 230 Hz {np.mean(np.exp(lt.lnf0) > 230):.3f}")
pc = sig(eta_f(bm.meter_logit.values, bm.lnf0.values))
for side in ["child-f", "child-m"]:
    m = (bm.side == side).values
    say(f"   bmmb {side}: predicted % man median {np.median(pc[m]):.0f} vs heard as male (man or boy) {bm[m].y_afc.mean():.0f} %, as adult man {bm[m].y_raw.mean():.1f} %")
open("hide_rules.txt", "w", encoding="utf-8").write("\n".join(OUT))
