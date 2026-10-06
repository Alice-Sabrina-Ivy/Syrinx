"""Run the speaker-wise 5-fold CV sweep over learned-envelope variants (dev-clean only).

  python run_cv.py [group ...]      groups: base, aug, band, model, engine, all (default)
Appends one JSON line per variant to build/resonance-lab/learned-envelope/cv_results.jsonl.
"""
import os
import sys
import json
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import train_eval as T  # noqa: E402

OUT = os.path.join(T.BUILD, "learned-envelope", "cv_results.jsonl")


def F(method="band", **k):
    return dict(method=method, **k)


GROUPS = {
    "proxyval": {
        # re-runs (same configs as earlier rows) to obtain saved held-out scores for the vowel proxy
        "logreg_band": dict(model="logreg", feat=F("band"), alpha=1.0),
        "pairs_band_500_6000": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, alpha=1.0),
        "mlp_band500_h16": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                mlp=dict(hidden=16, epochs=30, threads=2)),
        "mlp_band500_h64": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                mlp=dict(hidden=64, epochs=30, threads=2)),
    },
    "nonlin2": {
        # ablations + leak/robustness variants of the 16-unit MLP
        "mlp_band500_h16_noaug": dict(model="mlp", feat=F("band", flo=500, fhi=6000), mlp=dict(hidden=16, epochs=30)),
        "mlp_band500_h16_augabs": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True,
                                       mlp=dict(hidden=16, epochs=30)),
        "mlp_band500_h16_tilt": dict(model="mlp", feat=F("band", flo=500, fhi=6000, tilt=True), aug_abs=True, pairs=True,
                                     mlp=dict(hidden=16, epochs=30)),
        "mlp_band500_h16_p10": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, lam_p=10.0,
                                    mlp=dict(hidden=16, epochs=30)),
        "mlp_band300_h16": dict(model="mlp", feat=F("band", flo=300, fhi=6000), aug_abs=True, pairs=True,
                                mlp=dict(hidden=16, epochs=30)),
    },
    "hs": {
        "mlp_hs500_h16": dict(model="mlp", feat=F("hs", flo=500, fhi=6000), aug_abs=True, pairs=True, mlp=dict(hidden=16, epochs=30)),
        "pairs_hs500": dict(model="ridge", feat=F("hs", flo=500, fhi=6000), aug_abs=True, pairs=True, alpha=1.0),
    },
    "nonlin": {
        **{f"mlp_band500_h{h}": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                     mlp=dict(hidden=h, epochs=30)) for h in (16, 64)},
        **{f"moe_band500_k{k}": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                     mlp=dict(experts=k, epochs=30)) for k in (4, 16)},
        "mlp_band150_h64": dict(model="mlp", feat=F("band"), aug_abs=True, pairs=True, mlp=dict(hidden=64, epochs=30)),
        "moe_band150_k16": dict(model="mlp", feat=F("band"), aug_abs=True, pairs=True, mlp=dict(experts=16, epochs=30)),
    },
    "tilt": {
        "pairs_band500_tilt": dict(model="ridge", feat=F("band", flo=500, fhi=6000, tilt=True), aug_abs=True, pairs=True, alpha=1.0),
        "pairs_band300_tilt": dict(model="ridge", feat=F("band", flo=300, fhi=6000, tilt=True), aug_abs=True, pairs=True, alpha=1.0),
        "pairs_band500_tilt_p10": dict(model="ridge", feat=F("band", flo=500, fhi=6000, tilt=True), aug_abs=True, pairs=True,
                                       lam_p=10.0, alpha=1.0),
        "pairs_band500_p30": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, lam_p=30.0, alpha=1.0),
        "pairs_band500_p100": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, lam_p=100.0,
                                   alpha=1.0),
        "pairs_band500_tilt_p100": dict(model="ridge", feat=F("band", flo=500, fhi=6000, tilt=True), aug_abs=True, pairs=True,
                                        lam_p=100.0, alpha=1.0),
        "pairs_ct500_tilt": dict(model="ridge", feat=F("ct", flo=500, fhi=6000, tilt=True), aug_abs=True, pairs=True, alpha=1.0),
        "logreg_band500_tilt": dict(model="logreg", feat=F("band", flo=500, fhi=6000, tilt=True), alpha=1.0),
    },
    "feat2": {
        f"pairs_{m}_500": dict(model="ridge", feat=F(m, flo=500, fhi=6000), aug_abs=True, pairs=True, alpha=1.0)
        for m in ("band7", "bandp", "band7p", "ctp")
    },
    "lamv": {
        f"pairs_band500_v{v:g}": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                       alpha=1.0, lam_v=v)
        for v in (0.3, 1, 3, 10, 30)
    },
    "anchor": {
        f"pairs_band500_a{a:.2f}": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                         alpha=1.0, anchor=float(__import__("numpy").log(a)))
        for a in (1.08, 1.11, 1.20)
    },
    "alpha": {
        f"pairs_band500_al{al:g}": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, alpha=al)
        for al in (0.01, 0.1, 10, 100)
    },
    "band": {
        f"pairs_{m}_{lo}_{hi}": dict(model="ridge", feat=F(m, flo=lo, fhi=hi), aug_abs=True, pairs=True, alpha=1.0)
        for m in ("band", "ct") for lo, hi in ((150, 6000), (300, 6000), (500, 6000), (800, 6000), (1500, 6000), (500, 4500))
    },
    "base": {
        # sex classifier, no augmentation (the naive learned baseline)
        "logreg_band": dict(model="logreg", feat=F("band"), alpha=1.0),
        "logreg_ct": dict(model="logreg", feat=F("ct"), alpha=1.0),
        "logreg_cep": dict(model="logreg", feat=F("cep"), alpha=1.0),
        "ridge_band_noaug": dict(model="ridge", feat=F("band"), alpha=1.0),
    },
    "aug": {
        # augmented regression: target = ln1.15*female + ln fs (pitch variants keep the source target)
        "ridge_band_augabs": dict(model="ridge", feat=F("band"), aug_abs=True, alpha=1.0),
        "ridge_ct_augabs": dict(model="ridge", feat=F("ct"), aug_abs=True, alpha=1.0),
        "ridge_cep_augabs": dict(model="ridge", feat=F("cep"), aug_abs=True, alpha=1.0),
        # + explicit pair constraints (variant - reference): d = 0 for pitch, d = ln fs for formant
        "ridge_band_pairs": dict(model="ridge", feat=F("band"), aug_abs=True, pairs=True, alpha=1.0),
        "ridge_ct_pairs": dict(model="ridge", feat=F("ct"), aug_abs=True, pairs=True, alpha=1.0),
        "ridge_cep_pairs": dict(model="ridge", feat=F("cep"), aug_abs=True, pairs=True, alpha=1.0),
        "ridge_band_pairs_p10": dict(model="ridge", feat=F("band"), aug_abs=True, pairs=True, lam_p=10.0, alpha=1.0),
        "ridge_band_pairsonly": dict(model="ridge", feat=F("band"), pairs=True, alpha=1.0),
    },
}


def run(names_cfgs):
    D = T.Data()
    with open(OUT, "a") as fo:
        for name, cfg in names_cfgs:
            t0 = time.time()
            r, s_tr, s_au = T.cv(D, cfg)
            os.makedirs(os.path.join(T.BUILD, "learned-envelope", "cvscores"), exist_ok=True)
            T.np.savez(os.path.join(T.BUILD, "learned-envelope", "cvscores", name + ".npz"), s_tr=s_tr, s_au=s_au)
            r = {k: float(v) for k, v in r.items()}
            print(f"{name:28s} {T.fmt(r)}  ({time.time() - t0:.0f}s)", flush=True)
            fo.write(json.dumps(dict(name=name, cfg=cfg, **r)) + "\n")


if __name__ == "__main__":
    gs = sys.argv[1:] or list(GROUPS)
    items = []
    for g in gs:
        items += list(GROUPS[g].items())
    run(items)
