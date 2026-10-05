"""Fold a fitted linear head into the ECAPA q8-v2 graph's final layer (fc7), so the deployed
transformers.js audio-classification pipeline can run it unchanged:
  logits := [0, s],  s = w . relu_33 + b   ->  softmax 'female' = sigmoid(s)
fc6 and everything before stays the quantized production graph; the new fc7 is fp32 (192x2).
  python fold_head.py <head name e.g. scalesex140>
Writes build/resonance-lab/pitch-neutral-ml/export/ecapa_q8v2_pnhead_<head>.onnx and checks it
against the embedding+head path on random and real windows.
"""
import os, sys, json
import numpy as np
import onnx
from onnx import helper, numpy_helper
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pnml_core as C  # noqa
D = os.path.dirname(C.CACHE)
head = sys.argv[1]
h = json.load(open(os.path.join(D, f"head_{head}.json")))
sd = np.array(h["sd"]); w = np.array(h["w"]) / sd
b = h["b"] - float(np.dot(np.array(h["mu"]), w))
m = onnx.load(os.path.join(D, "ecapa_q8v2_emb.onnx"))
g = m.graph
drop_from = next(i for i, n in enumerate(g.node) if n.op_type == "DynamicQuantizeLinear" and n.input[0] == "relu_33")
keep = list(g.node)[:drop_from]
del g.node[:]
g.node.extend(keep)
W = np.zeros((192, 2), np.float32); W[:, 1] = w
B = np.array([0.0, b], np.float32)
g.initializer.extend([numpy_helper.from_array(W, "pnhead.W"), numpy_helper.from_array(B, "pnhead.B")])
g.node.extend([helper.make_node("MatMul", ["relu_33", "pnhead.W"], ["pnhead_mm"]),
               helper.make_node("Add", ["pnhead_mm", "pnhead.B"], ["logits"])])
outs = [o for o in g.output if o.name == "logits"]
del g.output[:]
g.output.extend(outs)
# drop now-unused initializers (old fc7)
used = {i for n in g.node for i in n.input}
inits = [x for x in g.initializer if x.name in used]
del g.initializer[:]
g.initializer.extend(inits)
onnx.checker.check_model(m)
out = os.path.join(D, "export", f"ecapa_q8v2_pnhead_{head}.onnx")
onnx.save(m, out)
import onnxruntime as ort
s1 = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
s0 = ort.InferenceSession(os.path.join(D, "ecapa_q8v2_emb.onnx"), providers=["CPUExecutionProvider"])
rng = np.random.default_rng(0)
err = []
for _ in range(20):
    x = (rng.standard_normal((1, 12000)) * 0.05).astype(np.float32)
    lg = s1.run(None, {s1.get_inputs()[0].name: x})[0][0]
    e = s0.run(None, {s0.get_inputs()[0].name: x})[1][0]
    err.append(abs((lg[1] - lg[0]) - (float(e @ w) + b)))
print(out, os.path.getsize(out), "bytes; max |folded - emb+head| =", max(err))
