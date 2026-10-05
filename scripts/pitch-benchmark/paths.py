# paths.py — shared locations for the pitch-detector benchmark scripts
# (measurements/pitch-detector-benchmark-2026-10-04.md). Nothing here is
# committed data: every output lives under WORK (gitignored build/).
#   PITCH_BENCH_DIR    work dir (default <repo>/build/pitch-benchmark):
#                      data/ (corpus dump), out/ (detector outputs, scores,
#                      timing), tmp/, logs/, trees/ (extracted src trees)
#   SO_REFS            session-oracle references (default
#                      <repo>/build/session-oracle/refs, from
#                      scripts/session-oracle/build_refs.py)
#   SYRINX_SESSIONS_DIR  the private session recordings: <date>/session.wav
#                      + the session label files (parquet); local only,
#                      outside the repo, no default (see CLAUDE.md)
import os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.abspath(os.environ.get("PITCH_BENCH_DIR", os.path.join(REPO, "build", "pitch-benchmark")))
DATA = os.path.join(WORK, "data")
OUT = os.path.join(WORK, "out")
TMP = os.path.join(WORK, "tmp")
SO_REFS = os.path.abspath(os.environ.get("SO_REFS", os.path.join(REPO, "build", "session-oracle", "refs")))
SO_RUNS = os.path.join(REPO, "build", "session-oracle", "runs")
SESSIONS_ROOT = os.environ.get("SYRINX_SESSIONS_DIR")  # None when unset: use sessions_root()
PARQ = "acoustic/frames_enrollment-2026-05-07-v2.parquet"
SWIFT_MODEL = os.path.join(REPO, "tests", "dsp", "data", "swift-f0", "model.onnx")


def sessions_root():
    """The private session recordings folder; exits with a clear message when unset."""
    if not SESSIONS_ROOT:
        raise SystemExit("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)")
    return SESSIONS_ROOT
