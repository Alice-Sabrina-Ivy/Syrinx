"""Run a list of formant-vtl variants through the lab evaluator; append summaries to
build/resonance-lab/formant-vtl/variants_<split>.jsonl (every variant tried is logged).

  python sweep.py <split> <variant-group>[,<group>...]
"""
import os
import sys
import json
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lab  # noqa: E402

A = dict(extractor="app", order=12)
A14 = dict(extractor="app", order=14)
P = dict(extractor="praat", ceiling=5500)


def V(name, cfg, corr=None, agg="median"):
    return dict(name=name, cfg=cfg, corr=corr, agg=agg)


GROUPS = {
    "base": [V(f"app12_{e}", dict(A, est=e)) for e in ("dF1234", "dF234", "dF34", "gm1234", "gm34", "f3", "f4", "dF123")]
            + [V(f"app14_{e}", dict(A14, est=e)) for e in ("dF1234", "gm1234", "f4")]
            + [V(f"praat5500_{e}", dict(P, est=e)) for e in ("dF1234", "gm1234", "f4")],
    "agg": [V("app12_gm1234_mean", dict(A, est="gm1234"), agg="mean"),
            V("app12_gm1234_tmean_mean", dict(A, est="gm1234", stat="tmean"), agg="mean"),
            V("app12_gm1234_mean_mean", dict(A, est="gm1234", stat="mean"), agg="mean"),
            V("app14_gm1234_mean", dict(A14, est="gm1234"), agg="mean"),
            V("app12_dF1234_mean", dict(A, est="dF1234"), agg="mean")],
    "corr": [V(f"app12_gm1234_K{K}", dict(A, est="gm1234"), dict(kind="kmeans", K=K)) for K in (8, 16, 32)]
            + [V("app12_dF1234_K16", dict(A, est="dF1234"), dict(kind="kmeans", K=16)),
               V("app12_f4_K16", dict(A, est="f4"), dict(kind="kmeans", K=16)),
               V("app12_gm1234_ridge2", dict(A, est="gm1234"), dict(kind="ridge", deg=2)),
               V("app14_gm1234_K16", dict(A14, est="gm1234"), dict(kind="kmeans", K=16)),
               V("praat5500_gm1234_K16", dict(P, est="gm1234"), dict(kind="kmeans", K=16))],
    "tm": [V("app12_tm_K16", dict(A, est="tmatch"), dict(kind="tmatch", K=16, lam=1.0, mu=2.0)),
           V("app12_tm_K8", dict(A, est="tmatch"), dict(kind="tmatch", K=8, lam=1.0, mu=2.0)),
           V("app12_tm_K32", dict(A, est="tmatch"), dict(kind="tmatch", K=32, lam=1.0, mu=2.0)),
           V("app12_tm_K16_lam0.3", dict(A, est="tmatch"), dict(kind="tmatch", K=16, lam=0.3, mu=2.0)),
           V("app12_tm_K16_lam3", dict(A, est="tmatch"), dict(kind="tmatch", K=16, lam=3.0, mu=2.0)),
           V("app12_tm_K16_mu0.5", dict(A, est="tmatch"), dict(kind="tmatch", K=16, lam=1.0, mu=0.5)),
           V("app12_tm_K16_no3", dict(A, est="tmatch"), dict(kind="tmatch", K=16, lam=1.0, mu=2.0, use3=False)),
           V("app14_tm_K16", dict(A14, est="tmatch"), dict(kind="tmatch", K=16, lam=1.0, mu=2.0))],
    "ridge": [V("app12_gm1234_ridge3", dict(A, est="gm1234"), dict(kind="ridge", deg=3)),
              V("app12_gm1234_ridge2_a100", dict(A, est="gm1234"), dict(kind="ridge", deg=2, alpha=100.0)),
              V("app12_dF1234_ridge2", dict(A, est="dF1234"), dict(kind="ridge", deg=2)),
              V("app12_f4_ridge2", dict(A, est="f4"), dict(kind="ridge", deg=2)),
              V("app12_gm34_ridge2", dict(A, est="gm34"), dict(kind="ridge", deg=2)),
              V("app14_gm1234_ridge2", dict(A14, est="gm1234"), dict(kind="ridge", deg=2)),
              V("app1214_gm1234_ridge2", dict(A, est="gm1234", orders=[12, 14]), dict(kind="ridge", deg=2)),
              V("app101214_gm1234_ridge2", dict(A, est="gm1234", orders=[10, 12, 14]), dict(kind="ridge", deg=2)),
              V("praat5500_gm1234_ridge2", dict(P, est="gm1234"), dict(kind="ridge", deg=2))],
    "gates": [V("app12_gm1234_ridge2_hp0.8", dict(A, est="gm1234", hprox=0.8), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_f43", dict(A, est="gm1234", f43=(1.08, 1.6)), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_bw400", dict(A, est="gm1234", bw34max=400), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_bwmax400", dict(A, est="gm1234", bwmax=400), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_bwmax800", dict(A, est="gm1234", bwmax=800), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_fmax5000", dict(A, est="gm1234", fmax=5000), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_fmin200", dict(A, est="gm1234", fmin=200), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_rms30", dict(A, est="gm1234", rms_rel=-30), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_bin05", dict(A, est="gm1234", binw=0.05, min_n=1), dict(kind="ridge", deg=2)),
              V("app12_gm1234_ridge2_bin30", dict(A, est="gm1234", binw=0.30, min_n=3), dict(kind="ridge", deg=2))],
    "ens": [V("app12_ens3_ridge3", dict(A, est=["gm1234", "dF1234", "f4"]), dict(kind="ridge", deg=3)),
            V("app1214_ens3_ridge3", dict(A, est=["gm1234", "dF1234", "f4"], orders=[12, 14]), dict(kind="ridge", deg=3)),
            V("app1214_gm1234_ridge3", dict(A, est="gm1234", orders=[12, 14]), dict(kind="ridge", deg=3)),
            V("app12_gmf4_ridge3", dict(A, est=["gm1234", "f4"]), dict(kind="ridge", deg=3))],
    "gmm": [V("app12_gm1234_ridge2_g02", dict(A, est="gm1234", gmm_q=0.02), dict(kind="ridge", deg=2, gmm=8)),
            V("app12_gm1234_ridge2_g05", dict(A, est="gm1234", gmm_q=0.05), dict(kind="ridge", deg=2, gmm=8)),
            V("app12_gm1234_ridge2_g10", dict(A, est="gm1234", gmm_q=0.1), dict(kind="ridge", deg=2, gmm=8)),
            V("app12_gm1234_none_g05", dict(A, est="gm1234", gmm_q=0.05), dict(kind="none", gmm=8)),
            V("sel101214_gm1234_ridge2", dict(A, est="gm1234", sel_orders=[10, 12, 14]), dict(kind="ridge", deg=2, gmm=8)),
            V("sel101214_gm1234_ridge2_g05", dict(A, est="gm1234", sel_orders=[10, 12, 14], gmm_q=0.05), dict(kind="ridge", deg=2, gmm=8)),
            V("sel1214_gm1234_ridge2_g05", dict(A, est="gm1234", sel_orders=[12, 14], gmm_q=0.05), dict(kind="ridge", deg=2, gmm=8)),
            V("app12_gm1234_ridge2_bw800_fx5000", dict(A, est="gm1234", bwmax=800, fmax=5000), dict(kind="ridge", deg=2)),
            V("sel101214_gm1234_ridge2_bw800_g05", dict(A, est="gm1234", sel_orders=[10, 12, 14], bwmax=800, gmm_q=0.05), dict(kind="ridge", deg=2, gmm=8))],
    "hp": [V("app12_gm1234_ridge2_hp12", dict(A, est="gm1234", hprox=0.8, hprox_idx=(0, 1)), dict(kind="ridge", deg=2)),
           V("app12_gm1234_ridge2_f0max250", dict(A, est="gm1234", f0max=250), dict(kind="ridge", deg=2))],
    "combo": [V("app101214_gm1234_ridge2_bw800", dict(A, est="gm1234", orders=[10, 12, 14], bwmax=800), dict(kind="ridge", deg=2)),
              V("app1214_gm1234_ridge2_bw800", dict(A, est="gm1234", orders=[12, 14], bwmax=800), dict(kind="ridge", deg=2)),
              V("app101214_gm1234_ridge2_bw800_fx5000", dict(A, est="gm1234", orders=[10, 12, 14], bwmax=800, fmax=5000), dict(kind="ridge", deg=2)),
              V("app101214_gm1234_ridge3_bw800", dict(A, est="gm1234", orders=[10, 12, 14], bwmax=800), dict(kind="ridge", deg=3)),
              V("app101214_dF1234_ridge2_bw800", dict(A, est="dF1234", orders=[10, 12, 14], bwmax=800), dict(kind="ridge", deg=2)),
              V("app101214_gm1234_ridge2_bw800_bin30", dict(A, est="gm1234", orders=[10, 12, 14], bwmax=800, binw=0.3, min_n=3), dict(kind="ridge", deg=2))],
    "prod": [V("app101214_gm1234_ridge2_bw800_prodf0", dict(A, est="gm1234", orders=[10, 12, 14], bwmax=800, f0src="prod"), dict(kind="ridge", deg=2)),
             V("app101214_gm1234_ridge2_prodf0", dict(A, est="gm1234", orders=[10, 12, 14], f0src="prod"), dict(kind="ridge", deg=2)),
             V("app12_gm1234_prodf0", dict(A, est="gm1234", f0src="prod"))],
}


def main():
    split, groups = sys.argv[1], sys.argv[2].split(",")
    out = os.path.join(lab.OUT, f"variants_{split}.jsonl")
    for group in groups:
        for v in GROUPS[group]:
            t0 = time.time()
            res, sm, _ = lab.run(v["cfg"], split, v["corr"], name=v["name"], agg=v["agg"], verbose=False)
            rec = dict(name=v["name"], group=group, split=split, cfg=v["cfg"], corr=v["corr"], agg=v["agg"],
                       summary=sm, secs=round(time.time() - t0))
            open(out, "a").write(json.dumps(rec) + "\n")
            print(json.dumps(rec), flush=True)
            json.dump(res, open(os.path.join(lab.OUT, "results", f"{v['name']}.{split}.json"), "w"), default=float)


if __name__ == "__main__":
    os.makedirs(os.path.join(lab.OUT, "results"), exist_ok=True)
    main()
