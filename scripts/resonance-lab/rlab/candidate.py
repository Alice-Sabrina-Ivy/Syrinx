"""Candidate plug-in interface.

A candidate is a Python file defining `CANDIDATE` (an instance or a class) that
subclasses `Candidate` (or just duck-types it). The harness calls

    t, s = cand.score(x, sr, f0)

once per benchmark item, where
  x   float32 mono audio at sr == 16000 (every corpus is resampled to 16 kHz)
  f0  rlab.f0.F0Track (10 ms grid, t_k = 0.005 + 0.01 k, f0 == 0 unvoiced) or None
      when the candidate sets uses_f0 = False
and returns two equal-length 1-D arrays:
  t   output times in seconds from the start of x (window END for causal readouts)
  s   scores, LARGER = more feminine-typical / shorter apparent vocal tract; NaN = no
      output at that time (e.g. unvoiced). Units are arbitrary: every metric is
      normalised by the candidate's own men-women gap.

Rules:
  * score() sees audio + optional F0 only; no labels, no file names, no item ids.
  * score() is stateless across calls (each item is a fresh stream).
  * learned candidates train ONLY on the `train_dev` set (LibriSpeech dev-clean);
    test sets (r1_test, manip_test, hill, manip_hill, ptdb, fda, synth, sessions)
    must never be used for fitting or threshold tuning. Tune on r1_dev/manip_dev
    with speaker-wise CV.
  * setup() runs once per worker process (load models there, not in __init__).

Batch candidates (e.g. a JS implementation run through Node) set batch = True and
implement score_batch(jobs, workdir) instead; see NodeBridgeCandidate.
"""
import os
import sys
import json
import subprocess
import importlib.util
import numpy as np


class Candidate:
    name = "unnamed"            # unique id -> score cache dir; [a-z0-9_]
    version = "1"               # bump to invalidate cached scores
    description = ""
    cadence_s = 0.15            # nominal output interval (informational)
    uses_f0 = False             # pass an F0Track to score()
    aggregate = "median"        # how the harness pools window scores into a readout: median | mean
    model_bytes = 0             # shipped model/weights size (R8)
    js_portability = ""         # one line: how this would run in the browser (R8)
    batch = False

    def setup(self):
        pass

    def score(self, x, sr, f0=None):
        raise NotImplementedError


class NodeBridgeCandidate(Candidate):
    """Runs a Node script over anonymised raw-f32 jobs.

    The harness writes each item as <workdir>/<k>.f32 (float32 LE, 16 kHz) and
    <workdir>/<k>.f0.f32 (float32 F0 on the 10 ms grid, t_k = 0.005 + 0.01 k), then
    calls  node <script> <jobs.json> <out.jsonl>  with jobs = [{key, audio, f0, dur}].
    The script writes one JSON line per job: {"key": ..., "t": [...], "s": [...]}
    (null for NaN). Shards run as concurrent child processes; each is waited on /
    terminated through its own Popen handle (PID-scoped, never by name).
    """
    batch = True
    node_script = None
    node_args = ()
    shards = 8

    def score_batch(self, jobs, workdir):
        os.makedirs(workdir, exist_ok=True)
        procs, outs = [], []
        n = max(1, min(self.shards, len(jobs)))
        try:
            for i in range(n):
                part = jobs[i::n]
                jp = os.path.join(workdir, f"jobs.{i}.json")
                op = os.path.join(workdir, f"out.{i}.jsonl")
                json.dump(part, open(jp, "w"))
                procs.append(subprocess.Popen(["node", self.node_script, jp, op, *self.node_args]))
                outs.append(op)
            for p in procs:
                if p.wait() != 0:
                    raise RuntimeError(f"node shard failed ({p.args})")
        finally:
            for p in procs:
                if p.poll() is None:
                    p.kill()          # this child's PID only
        res, cpu = {}, 0.0
        for op in outs:
            for line in open(op):
                d = json.loads(line)
                if "__cpu_s" in d:          # each shard reports its own process.cpuUsage()
                    cpu += float(d["__cpu_s"])
                    continue
                res[d["key"]] = (np.array(d["t"], float),
                                 np.array([np.nan if v is None else v for v in d["s"]], float))
        res["__cpu_s"] = (cpu, None)
        return res


def load_candidate(spec):
    """'path/to/file.py' (uses CANDIDATE) or 'path/to/file.py:ClassName'."""
    path, _, attr = spec.partition(":")
    path = os.path.abspath(path)
    lab = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if lab not in sys.path:
        sys.path.insert(0, lab)
    mod_name = "cand_" + os.path.splitext(os.path.basename(path))[0]
    spec_ = importlib.util.spec_from_file_location(mod_name, path)
    mod = importlib.util.module_from_spec(spec_)
    sys.modules[mod_name] = mod
    spec_.loader.exec_module(mod)
    obj = getattr(mod, attr or "CANDIDATE")
    return obj() if isinstance(obj, type) else obj
