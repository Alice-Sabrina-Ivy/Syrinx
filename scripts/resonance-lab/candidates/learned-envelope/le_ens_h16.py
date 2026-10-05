"""Harness candidate: mean of the 3 seeds of the band500 h16 MLP (each trained on all 40 dev-clean speakers)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from le_cand import make_ensemble  # noqa: E402

CANDIDATE = make_ensemble("ens_h16", ["mlp_band500_h16", "mlp_band500_h16_s1", "mlp_band500_h16_s2"],
                          desc="mean of 3 seeds: tiny MLP (16 tanh) on band envelope 500-6000 Hz, aug + pair constraints")
