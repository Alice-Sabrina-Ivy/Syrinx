"""Harness candidate: learned-envelope variant ridge_band500_pairs (trained by train_models.py on dev-clean only)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from le_cand import make  # noqa: E402

CANDIDATE = make('ridge_band500_pairs', version='1', desc='ridge, band envelope 500-6000 Hz, target ln1.15*female+ln fs, aug + pair constraints')
