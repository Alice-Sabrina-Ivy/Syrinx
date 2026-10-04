# paths.py — shared locations for the pitch-detector benchmark scripts
# (measurements/pitch-detector-benchmark-2026-10-04.md). Nothing here is
# committed data: every output lives under WORK (gitignored build/).
#   PITCH_BENCH_DIR    work dir (default <repo>/build/pitch-benchmark):
#                      data/ (corpus dump), out/ (detector outputs, scores,
#                      timing), tmp/, logs/, trees/ (extracted src trees)
#   SO_REFS            session-oracle references (default
#                      <repo>/build/session-oracle/refs, from
#                      scripts/session-oracle/build_refs.py)
#   SESSION_IDS  session WAVs + private-session parquet (personal recordings,
#                      outside the repo)
import os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.abspath(os.environ.get("PITCH_BENCH_DIR", os.path.join(REPO, "build", "pitch-benchmark")))
DATA = os.path.join(WORK, "data")
OUT = os.path.join(WORK, "out")
TMP = os.path.join(WORK, "tmp")
SO_REFS = os.path.abspath(os.environ.get("SO_REFS", os.path.join(REPO, "build", "session-oracle", "refs")))
SO_RUNS = os.path.join(REPO, "build", "session-oracle", "runs")
SESSIONS_ROOT = os.environ.get("SESSION_IDS", "C:/Coding Projects/private-session/sessions")
PARQ = "acoustic/frames_enrollment-2026-05-07-v2.parquet"
SWIFT_MODEL = os.path.join(REPO, "tests", "dsp", "data", "swift-f0", "model.onnx")
