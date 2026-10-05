# timing.py — CPU cost per second of audio, single thread, on this machine,
# for every offline detector, over the same 60 s clip of real session audio
# (2026-05-26, 600-660 s, 16 kHz). One warm-up call (model load / JIT) on
# 2 s first, then 3 timed repetitions; median reported.
# Syrinx is timed separately through the real worker (run.mjs on the same
# clip; meta.json cpu.pitchMsPerChunk x 40 = ms per s of audio).
# Usage (venv python): python scripts/pitch-benchmark/timing.py  -> <WORK>/out/timing.json + <WORK>/tmp/clip60.wav
import os, sys, json, time
import numpy as np, soundfile as sf
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["OMP_NUM_THREADS"] = "1"
import torch; torch.set_num_threads(1)
import detectors as D, swift
from paths import OUT, TMP, sessions_root
x, sr = sf.read(f"{sessions_root()}/2026-05-26/session.wav", dtype="float32", start=600 * 16000, stop=660 * 16000)
os.makedirs(TMP, exist_ok=True); os.makedirs(OUT, exist_ok=True)
sf.write(os.path.join(TMP, "clip60.wav"), x, sr, subtype="PCM_16")
res = {}
dets = sys.argv[1:] or ["praat_ac", "praat_ac_cal", "praat_cc", "pyin", "penn", "crepe_tiny", "crepe_full", "swift_offline", "swift_stream"]
for d in dets:
    fn = (lambda a: swift.offline(a, sr)) if d == "swift_offline" else (lambda a: swift.stream(a, sr)) if d == "swift_stream" else (lambda a: D.run(d, a, sr))
    fn(x[: 2 * sr])
    ts = []
    for _ in range(3):
        c0 = time.process_time(); w0 = time.perf_counter(); fn(x); ts.append((time.process_time() - c0, time.perf_counter() - w0))
    cpu = float(np.median([a for a, _ in ts])); wall = float(np.median([b for _, b in ts]))
    res[d] = {"cpu_ms_per_s": 1000 * cpu / 60, "wall_ms_per_s": 1000 * wall / 60}
    print(d, f"cpu {res[d]['cpu_ms_per_s']:.1f} ms/s audio, wall {res[d]['wall_ms_per_s']:.1f} ms/s", flush=True)
p = os.path.join(OUT, "timing.json")
old = json.load(open(p)) if os.path.exists(p) else {}
old.update(res); json.dump(old, open(p, "w"), indent=1)
