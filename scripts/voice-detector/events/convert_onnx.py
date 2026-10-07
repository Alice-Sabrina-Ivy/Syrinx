# convert_onnx.py — YAMNet -> ONNX for the voice-detector benchmark
# (2026-10-06, audio-event candidate). Runs in a scratch venv with
# tensorflow-cpu + tf-keras + onnx + onnxruntime (YAMNet needs Keras 2):
#
#   <venv>/python scripts/voice-detector/events/convert_onnx.py build/vad/events/model build/vad/events/model
#
# The model dir must hold the OFFICIAL files (README "Provenance"): yamnet.py,
# params.py, features.py (tensorflow/models research/audioset/yamnet) and
# yamnet.h5. The script builds the official Keras model, loads the weights,
# and writes the core network (log-mel patches [N, T, 64] -> 521 sigmoid
# scores; T is dynamic) as ONNX by hand from the Keras weights, BN folded
# into the convs (TF "same" padding = ONNX SAME_UPPER):
#   yamnet_core_fp32.onnx    fp32 weights (14.9 MB; reference)
#   yamnet_core_int8w.onnx   every conv + dense int8 per-channel weight-only
#   yamnet_core_pw8.onnx     pointwise convs + dense int8, the rest fp32
#   yamnet_core_pw8d16.onnx  pointwise convs int8, dense fp16, the rest fp32 (4.47 MB)
# int8 = symmetric per-output-channel weights + DequantizeLinear in front of
# a float Conv / Gemm (activations stay float). It also saves the TF mel
# matrix (mel_257x64.npy) and checks every ONNX file against the Keras model
# (random patches) and the official waveform pipeline (yamnet_frames_model).
import os
import sys

os.environ["TF_USE_LEGACY_KERAS"] = "1"
MD = sys.argv[1]  # model dir with yamnet.py, params.py, features.py, yamnet.h5
OUT = sys.argv[2]
sys.path.insert(0, MD)
import numpy as np  # noqa: E402
import tensorflow as tf  # noqa: E402
import onnx  # noqa: E402
from onnx import helper, TensorProto, numpy_helper  # noqa: E402

import params as yparams  # noqa: E402
import yamnet as ymodel  # noqa: E402

P = yparams.Params()
model = ymodel.yamnet_frames_model(P)
model.load_weights(os.path.join(MD, "yamnet.h5"))
print("keras model loaded; layers:", len(model.layers))

# ---- reference: the official waveform pipeline on a fixed test waveform ----
rng = np.random.default_rng(0)
sr = 16000
t = np.arange(int(3.2 * sr)) / sr
# a harmonic tone + a little noise
wav = (0.2 * sum(np.sin(2 * np.pi * 140 * h * t) / h for h in range(1, 15)) + 0.01 * rng.standard_normal(len(t))).astype(np.float32)
scores, emb, logmel = model(wav)
np.savez(os.path.join(OUT, "ref_official.npz"), wav=wav, scores=scores.numpy(), logmel=logmel.numpy())
print("official scores", scores.shape, "logmel", logmel.shape)

# mel matrix exactly as features.py builds it
mel = tf.signal.linear_to_mel_weight_matrix(num_mel_bins=P.mel_bands, num_spectrogram_bins=257, sample_rate=P.sample_rate,
                                            lower_edge_hertz=P.mel_min_hz, upper_edge_hertz=P.mel_max_hz).numpy()
np.save(os.path.join(OUT, "mel_257x64.npy"), mel.astype(np.float32))

# ---- core Keras model on patches (the layers after feature extraction) ----
import tf_keras  # noqa: E402
inp = tf_keras.layers.Input(shape=(P.patch_frames, P.patch_bands))
pred, _ = ymodel.yamnet(inp, P)
core = tf_keras.Model(inp, pred)
cw = [l for l in core.layers if l.weights]
mw = [l for l in model.layers if l.weights]
assert len(cw) == len(mw), (len(cw), len(mw))
for a, b in zip(cw, mw):
    a.set_weights(b.get_weights())
patches = rng.standard_normal((16, 96, 64)).astype(np.float32) * 2 - 4
ref_core = core(patches).numpy()
np.savez(os.path.join(OUT, "ref_core.npz"), patches=patches, scores=ref_core)

W = {w.name: w.numpy() for w in model.weights}
names = sorted(W)
print(len(names), "weight tensors")


EPS = P.batchnorm_epsilon


def bn_fold(kernel_oihw, bn):
    s = 1.0 / np.sqrt(bn["moving_variance"] + EPS)
    w = kernel_oihw * s[:, None, None, None]
    b = bn.get("beta", np.zeros_like(s)) - bn["moving_mean"] * s
    return w.astype(np.float32), b.astype(np.float32)


def tensor(name):
    m = [k for k in W if k.split(":")[0] == name or k.split(":")[0].endswith("/" + name)]
    if len(m) != 1:
        raise KeyError(f"{name}: {m}")
    return W[m[0]]


def bn_of(prefix):
    return {nm: tensor(f"{prefix}/{nm}") for nm in ("beta", "moving_mean", "moving_variance")}


folded = []  # (kind, w_oihw, b, stride, group)
for i, (fun, k, s, n) in enumerate(ymodel._YAMNET_LAYER_DEFS):
    L = f"layer{i + 1}"
    if fun is ymodel._conv:
        kk = tensor(f"{L}/conv/kernel")  # (kh, kw, in, out)
        w, b = bn_fold(kk.transpose(3, 2, 0, 1), bn_of(f"{L}/conv/bn"))
        folded.append(("conv", w, b, s, 1))
    else:
        dk = tensor(f"{L}/depthwise_conv/depthwise_kernel")  # (kh, kw, C, 1)
        w, b = bn_fold(dk.transpose(2, 3, 0, 1), bn_of(f"{L}/depthwise_conv/bn"))
        folded.append(("dw", w, b, s, w.shape[0]))
        pk = tensor(f"{L}/pointwise_conv/kernel")  # (1, 1, in, out)
        w, b = bn_fold(pk.transpose(3, 2, 0, 1), bn_of(f"{L}/pointwise_conv/bn"))
        folded.append(("pw", w, b, 1, 1))
dense_k = [W[k] for k in W if W[k].shape == (1024, 521)][0]
dense_b = [W[k] for k in W if W[k].shape == (521,)][0]
print("dense", dense_k.shape, dense_b.shape)


def build(quant, path):
    nodes, inits = [], []
    x_in = helper.make_tensor_value_info("patches", TensorProto.FLOAT, ["N", "T", 64])
    y_out = helper.make_tensor_value_info("scores", TensorProto.FLOAT, ["N", 521])
    inits.append(numpy_helper.from_array(np.array([0, 1, -1, 64], np.int64), "shape4"))
    nodes.append(helper.make_node("Reshape", ["patches", "shape4"], ["x0"]))
    cur = "x0"

    def weight(name, w, axis, kind):
        mode = quant.get(kind, "fp32") if quant else "fp32"
        if mode == "fp32":
            inits.append(numpy_helper.from_array(w.astype(np.float32), name))
            return name
        if mode == "fp16":
            inits.append(numpy_helper.from_array(w.astype(np.float16), name + "_h"))
            nodes.append(helper.make_node("Cast", [name + "_h"], [name], to=TensorProto.FLOAT))
            return name
        red = tuple(a for a in range(w.ndim) if a != axis)
        amax = np.abs(w).max(axis=red)
        sc = np.where(amax > 0, amax / 127.0, 1.0).astype(np.float32)
        shp = [1] * w.ndim
        shp[axis] = -1
        q = np.clip(np.round(w / sc.reshape(shp)), -127, 127).astype(np.int8)
        inits.append(numpy_helper.from_array(q, name + "_q"))
        inits.append(numpy_helper.from_array(sc, name + "_s"))
        inits.append(numpy_helper.from_array(np.zeros(sc.shape, np.int8), name + "_z"))
        nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_s", name + "_z"], [name], axis=axis))
        return name

    for j, (kind, w, b, s, g) in enumerate(folded):
        wn = weight(f"w{j}", w, 0, kind)
        inits.append(numpy_helper.from_array(b, f"b{j}"))
        ks = list(w.shape[2:])
        nodes.append(helper.make_node("Conv", [cur, wn, f"b{j}"], [f"c{j}"], kernel_shape=ks, strides=[s, s],
                                      auto_pad="SAME_UPPER", group=g))
        nodes.append(helper.make_node("Relu", [f"c{j}"], [f"r{j}"]))
        cur = f"r{j}"
    nodes.append(helper.make_node("GlobalAveragePool", [cur], ["gap"]))
    nodes.append(helper.make_node("Flatten", ["gap"], ["emb"], axis=1))
    dn = weight("dense_w", dense_k, 1, "dense")
    inits.append(numpy_helper.from_array(dense_b.astype(np.float32), "dense_b"))
    nodes.append(helper.make_node("Gemm", ["emb", dn, "dense_b"], ["logits"]))
    nodes.append(helper.make_node("Sigmoid", ["logits"], ["scores"]))
    g = helper.make_graph(nodes, "yamnet_core", [x_in], [y_out], inits)
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 13)], producer_name="syrinx-vad-events")
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, path)
    print("wrote", path, os.path.getsize(path), "bytes")


VARIANTS = {
    "yamnet_core_fp32.onnx": None,
    "yamnet_core_int8w.onnx": {"conv": "int8", "dw": "int8", "pw": "int8", "dense": "int8"},
    "yamnet_core_pw8.onnx": {"pw": "int8", "dense": "int8"},
    "yamnet_core_pw8d16.onnx": {"pw": "int8", "dense": "fp16"},
}
for nm, q in VARIANTS.items():
    build(q, os.path.join(OUT, nm))

import onnxruntime as ort  # noqa: E402
for nm in VARIANTS:
    s = ort.InferenceSession(os.path.join(OUT, nm), providers=["CPUExecutionProvider"])
    o = s.run(None, {"patches": patches})[0]
    print(nm, "max |onnx - keras core| =", float(np.abs(o - ref_core).max()))
    # official waveform pipeline patches -> onnx
    lm = logmel.numpy()
    fr = tf.signal.frame(lm, 96, 48, axis=0).numpy()
    o2 = s.run(None, {"patches": fr.astype(np.float32)})[0]
    print(nm, "max |onnx(official logmel patches) - official scores| =", float(np.abs(o2 - scores.numpy()[: len(o2)]).max()),
          "patches", len(fr), "official frames", scores.shape[0])
