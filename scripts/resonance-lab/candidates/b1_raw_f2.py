"""B1 — mean raw F2 over voiced frames: the current UI's resonance signal, computed
by the app's own extractor (src/dsp/formants.js) through a Node bridge that
emulates 48 kHz capture, the 150 ms formant cadence, the pitch-hint routing and
the 7-sample gated median display smoothing (see node/app_formants_f2.mjs).
Score = F2 in Hz (higher = 'brighter'); readout = mean over emitted frames.
"""
import os
from rlab.candidate import NodeBridgeCandidate

HERE = os.path.dirname(os.path.abspath(__file__))


class B1RawF2(NodeBridgeCandidate):
    name = "b1_raw_f2"
    version = "1"
    description = "Current UI signal: app LPC F2 (src/dsp/formants.js, 48 k emulation), gated median-7, mean"
    cadence_s = 0.15
    uses_f0 = True
    aggregate = "mean"
    model_bytes = 0
    js_portability = "deployed (dsp-worker.js); ~0.3 ms per 150 ms frame"
    node_script = os.path.join(os.path.dirname(HERE), "node", "app_formants_f2.mjs")
    shards = 12


CANDIDATE = B1RawF2
