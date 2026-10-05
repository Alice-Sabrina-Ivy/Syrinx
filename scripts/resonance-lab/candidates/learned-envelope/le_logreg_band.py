"""Harness candidate: learned-envelope variant logreg_band (trained by train_models.py on dev-clean only)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from le_cand import make  # noqa: E402

CANDIDATE = make('logreg_band', version='1', desc='sex logistic regression on 150 ms log band envelope 150-6000 Hz, no augmentation')
