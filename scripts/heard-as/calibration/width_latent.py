"""Step 4b: per-voice coverage corrected for listener-panel sampling noise.
For each held-out natural voice set, the observed count k of n listeners is modelled as
  k ~ Binomial(n, sigmoid(eta_pred + mu + sigma * z)),  z ~ N(0, 1)
(logit-normal-binomial; mu = the set's level offset from the shipped model, sigma = per-voice model
error on the logit scale, both by maximum likelihood with 40-node Gauss-Hermite). Coverage of the TRUE
per-voice share by eta_pred +/- w is then P(|mu + sigma z| <= w). Bootstrap over voices for intervals.
Writes width_latent.txt and width_latent.json."""
import json
import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import norm
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
FIT = json.load(open("fit.json"))
H = set_target(load(), "half")
H = H[H[CUE].notna().all(axis=1)].reset_index(drop=True)
eta_of = lambda d: FIT["a"] + FIT["b_meter"] * d.meter_logit.values + FIT["c_lnf0"] * d.lnf0.values
LO = pd.read_csv("units_loso.csv", index_col=0)
z, wq = np.polynomial.hermite_e.hermegauss(40)
wq = wq / wq.sum()


def nll(par, eta, k, n):
    mu, ls = par
    s = np.exp(ls)
    e = eta[:, None] + mu + s * z[None, :]
    lp = -np.logaddexp(0, -e)
    lq = -np.logaddexp(0, e)
    ll = gammaln(n + 1)[:, None] - gammaln(k + 1)[:, None] - gammaln(n - k + 1)[:, None] + k[:, None] * lp + (n - k)[:, None] * lq
    m = ll.max(1)
    return -(m + np.log((np.exp(ll - m[:, None]) * wq[None, :]).sum(1))).sum()


def fit_ms(eta, y, n):
    k = np.clip(np.asarray(y, float) / 100 * n, 0, n)
    r = minimize(nll, [0.0, np.log(0.8)], args=(np.asarray(eta, float), k, np.asarray(n, float)), method="Nelder-Mead",
                 options=dict(xatol=1e-4, fatol=1e-6, maxiter=4000))
    return r.x[0], np.exp(r.x[1])


cov = lambda mu, s, w: norm.cdf((w - mu) / s) - norm.cdf((-w - mu) / s)


def need(mu, s, target=0.8):
    ws = np.arange(0.05, 8, 0.01)
    c = cov(mu, s, ws)
    return ws[np.argmax(c >= target)] if (c >= target).any() else np.nan


pal = pd.read_csv("palette_loto.csv")
bm = H[(H.src == "bmmb") & H.side.isin(["fem", "masc"]) & (H.cond == "a")]
ltg = H[H.src == "libritts-p"].groupby("talker")
lt = pd.DataFrame({"eta": ltg.apply(lambda d: eta_of(d).mean()), "y": ltg.y_half.first(), "side": ltg.side.first()})
pal_loso = LO[LO.fset == "palette"]
SETS = {
    "Palette natural masc.-presenting talkers, leave-one-talker-out (~49 listeners/voice)":
        (lg(pal.p0.values), pal.y.values, 49, pal.side.values),
    "Palette, leave-one-source-out": (pal_loso.eta.values, pal_loso.y.values, 49, pal_loso.side.values),
    "bmmb natural adults /hid/, 'adult man' (15 listeners, 4AFC)": (eta_of(bm), bm.y_raw.values, 15, bm.side.values),
    "bmmb natural adults /hid/, 'man or boy' (15 listeners, 4AFC)": (eta_of(bm), bm.y_afc.values, 15, bm.side.values),
    "LibriTTS-P natural readers (3 annotators) [validation only]": (lt.eta.values, lt.y.values, 3, lt.side.values),
}
WS = [1.28, 1.5, 1.79, 2.0, 2.25, 2.5, 3.0]
SIGMA_G = FIT["offset_sd"]
rng = np.random.default_rng(11)
RES = {}
say("Per-voice error on the logit scale, corrected for listener-panel sampling (ML logit-normal-binomial).")
say(f"mu = level offset of the set vs the shipped model (+ = listeners said 'man' MORE than predicted); sigma = per-voice scatter.")
say(f"Coverage of the true share by eta +/- w; 'w80' = width for 80 % coverage. 'w80 +groups' adds the between-listener-group")
say(f"offset SD {SIGMA_G:.2f} (fit sources) in quadrature to sigma and sets mu to 0: the width for a new voice AND a new listener group.")
for name, (eta, y, n, side) in SETS.items():
    say(f"\n  {name}")
    for sd in ["all", "fem", "masc"]:
        m = np.ones(len(y), bool) if sd == "all" else (side == sd)
        if m.sum() < 5:
            continue
        nn = np.full(m.sum(), n, float)
        mu, s = fit_ms(eta[m], y[m], nn)
        bs = []
        idx = np.where(m)[0]
        for _ in range(100):
            j = rng.choice(idx, len(idx))
            bs.append(fit_ms(eta[j], y[j], nn))
        bs = np.array(bs)
        w80 = need(mu, s)
        w80b = np.array([need(a, b) for a, b in bs])
        sg = np.sqrt(s ** 2 + SIGMA_G ** 2)
        wg = need(0.0, sg)
        RES[f"{name} | {sd}"] = dict(n=int(m.sum()), mu=mu, sigma=s, w80=w80, w80_ci=list(np.nanpercentile(w80b, [10, 90])),
                                     w80_groups=wg, cov={str(w): cov(mu, s, w) for w in WS})
        say(f"    {sd:4s} n={m.sum():3d}  mu {mu:+.2f} [{np.percentile(bs[:, 0], 10):+.2f},{np.percentile(bs[:, 0], 90):+.2f}]  "
            f"sigma {s:.2f} [{np.percentile(bs[:, 1], 10):.2f},{np.percentile(bs[:, 1], 90):.2f}]  coverage " +
            " ".join(f"{w}:{cov(mu, s, w):.2f}" for w in WS) +
            f"  | w80 {w80:.2f} [80 % boot {np.nanpercentile(w80b, 10):.2f}-{np.nanpercentile(w80b, 90):.2f}]  w80 +groups {wg:.2f}")

# condition-level sources (listener counts large; the residual is mostly group offset + condition error)
say("\n  Condition-level held-out data (LOSO / validation units; residual = logit(heard) - eta, no sampling correction):")
VU = pd.read_csv("units_val.csv", index_col=0)
allr = []
for lab, d in list(LO.groupby("fset")) + list(VU[VU.vset.isin(["hc-syl", "picka-jebens-ls", "picka-jebens-vnt-sent", "picka-nagels-ls"])].groupby("vset")):
    r = lg(d.y.values) - d.eta.values
    allr.append(pd.DataFrame({"src": lab, "r": r}))
    say(f"    {lab:22s} n={len(d):3d} mean residual {r.mean():+.2f}  q80|r| {np.percentile(np.abs(r), 80):.2f}  coverage at w 1.79 {np.mean(np.abs(r) <= 1.79):.2f}, 2.25 {np.mean(np.abs(r) <= 2.25):.2f}, 2.5 {np.mean(np.abs(r) <= 2.5):.2f}")
R = pd.concat(allr)
wsrc = 1 / R.src.map(R.src.value_counts())
for w in [1.79, 2.0, 2.25, 2.5, 3.0]:
    say(f"    source-balanced coverage at w {w}: {np.average(np.abs(R.r) <= w, weights=wsrc):.2f}  "
        f"(min over sources {R.groupby('src').r.apply(lambda r: np.mean(np.abs(r) <= w)).min():.2f})")
json.dump(RES, open("width_latent.json", "w"), indent=1, default=float)
open("width_latent.txt", "w", encoding="utf-8").write("\n".join(OUT))
