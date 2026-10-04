# swift.py — SwiftF0 (the project's 2026-05-06..06-09 production detector)
# through Python onnxruntime (CPU EP, 1 thread), same model file as the
# Node harness (tests/dsp/data/swift-f0/model.onnx) and the same linear
# resampler (tests/dsp/swift-f0-adapter.js resampleLinear).
#   offline  whole file in one inference, native 16 ms hop, frame i centred
#            at (i*256 + 127.5)/16000 s (adapter convention)
#   stream   the retired production worker (git eded104^ pitch-worker.js):
#            per 25 ms chunk, linear-resample the chunk, append to a rolling
#            1024-sample buffer, infer on the buffer, report output frame 0.
#            Frame 0 is centred at buffer sample 127.5 -> value describes
#            chunk_end - (1024 - 127.5)/16000 s (~56 ms before the newest
#            sample).
# Production config: voiced iff confidence >= 0.5.
# Usage: python swift.py MODE CORPUS[,CORPUS]       -> <WORK>/out/swift_<mode>/<corpus>.npz
#        python swift.py MODE --wav=PATH --name=NAME -> <WORK>/out/swift_<mode>/sess_<name>.npz
import sys, os, json, time
import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import DATA, OUT, SWIFT_MODEL as MODEL
GATE = 0.5
so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
S = ort.InferenceSession(MODEL, sess_options=so, providers=["CPUExecutionProvider"])
IN = S.get_inputs()[0].name


def resample_linear(x, sr_in, sr_out=16000):
    if sr_in == sr_out: return x.astype(np.float32)
    ratio = sr_out / sr_in
    n = int(np.floor(len(x) * ratio))
    src = np.arange(n) / ratio
    i0 = np.floor(src).astype(np.int64); i1 = np.minimum(i0 + 1, len(x) - 1); fr = src - i0
    return (x[i0] * (1 - fr) + x[i1] * fr).astype(np.float32)


def offline(x, sr):
    y = resample_linear(x, sr)
    if len(y) < 256: y = np.pad(y, (0, 256 - len(y)))
    p, c = S.run(None, {IN: y[None]})
    p, c = p[0].astype(float), c[0].astype(float)
    t = (np.arange(len(p)) * 256 + 127.5) / 16000
    return t, np.where(c >= GATE, p, 0.0), p, c


def stream(x, sr, chunk_ms=25):
    C = round(sr * chunk_ms / 1000); n = len(x) // C
    buf = np.zeros(1024, np.float32); fill = 0
    T, P, Cf = [], [], []
    for k in range(n):
        r = resample_linear(x[k * C:(k + 1) * C], sr)  # per-chunk, as the retired worker did
        m = len(r)
        if m >= 1024: buf[:] = r[-1024:]; fill = 1024
        else:
            buf[:1024 - m] = buf[m:]; buf[1024 - m:] = r; fill = min(1024, fill + m)
        if fill < 1024: continue
        p, c = S.run(None, {IN: buf[None]})
        T.append((k + 1) * C / sr - (1024 - 127.5) / 16000); P.append(float(p[0, 0])); Cf.append(float(c[0, 0]))
    T, P, Cf = np.array(T), np.array(P), np.array(Cf)
    return T, np.where(Cf >= GATE, P, 0.0), P, Cf


if __name__ == "__main__":
    A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    mode = pos[0]; fn = offline if mode == "offline" else stream
    od = os.path.join(OUT, f"swift_{mode}"); os.makedirs(od, exist_ok=True)
    if "wav" in A:
        import soundfile as sf
        x, sr = sf.read(A["wav"], dtype="float32")
        t0 = time.process_time(); t, f, r, c = fn(x, sr); cpu = time.process_time() - t0
        np.savez_compressed(os.path.join(od, f"sess_{A['name']}.npz"), t=t, f=f, r=r, p=c, __cpu=np.array([cpu, len(x) / sr]))
        print(mode, A["name"], f"cpu {cpu:.0f}s for {len(x)/sr/60:.1f} min", flush=True)
        sys.exit(0)
    index = json.load(open(os.path.join(DATA, "index.json")))
    for corp in pos[1].split(","):
        res = {}; cpu = dur = 0.0
        for tr in [t for t in index if t["corpus"] == corp]:
            x = np.fromfile(os.path.join(DATA, corp, tr["trackId"] + ".f32"), dtype=np.float32)
            t0 = time.process_time(); t, f, r, c = fn(x, tr["sr"]); cpu += time.process_time() - t0; dur += len(x) / tr["sr"]
            k = tr["trackId"]; res[k + "|t"] = t; res[k + "|f"] = f; res[k + "|r"] = r; res[k + "|p"] = c
        res["__cpu"] = np.array([cpu, dur, cpu])
        np.savez_compressed(os.path.join(od, f"{corp}.npz"), **res)
        print(mode, corp, f"cpu {cpu:.0f}s for {dur/60:.1f} min", flush=True)
