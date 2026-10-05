"""Harness candidate: learned-envelope variant mlp_band500_h16_s2 (trained by train_models.py on dev-clean only)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from le_cand import make  # noqa: E402

CANDIDATE = make('mlp_band500_h16_s2', version='1', desc='tiny MLP (16 tanh, seed 2) on band envelope 500-6000 Hz, target ln1.15*female+ln fs, aug + pair constraints')
