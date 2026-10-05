"""Filesystem layout + fixed constants for the resonance-validity benchmark.

Code lives in scripts/resonance-lab/ (committed); every generated artifact
(converted audio, manipulated WAVs, F0 tracks, candidate scores, results)
lives under build/resonance-lab/ (gitignored via the repo-wide `build/`).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)                                   # scripts/resonance-lab
REPO = os.path.dirname(os.path.dirname(LAB))                  # worktree root
BUILD = os.path.join(REPO, "build", "resonance-lab")
DATA = os.path.join(BUILD, "data")                            # raw downloads (LibriSpeech)
BENCH = os.path.join(BUILD, "bench")                          # derived benchmark items
AUDIO = os.path.join(BENCH, "audio")
F0DIR = os.path.join(BENCH, "f0")
MANIFESTS = os.path.join(BENCH, "manifests")
SCORES = os.path.join(BUILD, "scores")
RESULTS = os.path.join(BUILD, "results")
TMP = os.path.join(BUILD, "tmp")

LIBRI = os.path.join(DATA, "LibriSpeech")
# Corpora that are gitignored in the repo may only exist in the main checkout.
_CORPUS_CANDIDATES = [os.path.join(REPO, "tests", "dsp", "data"),
                      "C:/Coding Projects/Syrinx/tests/dsp/data"]


def corpus_dir(sub):
    """First tests/dsp/data/<sub> that actually holds data (worktree first)."""
    for root in _CORPUS_CANDIDATES:
        p = os.path.join(root, sub)
        if os.path.isdir(p) and len(os.listdir(p)) > 2:
            return p
    return os.path.join(_CORPUS_CANDIDATES[0], sub)


HILL = os.path.join(REPO, "tests", "dsp", "data")             # vowdata.dat + men/ + women/
# Private session recordings (local-only, never committed): the root comes from the
# SYRINX_SESSIONS_DIR environment variable (see CLAUDE.md "Private session data").
# Resolved lazily via sessions_dir(), so importing rlab never needs it.
SESSIONS_DIR = os.environ.get("SYRINX_SESSIONS_DIR", "")
SESSION_IDS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
SESSIONS_HINT = ("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings "
                 "(see CLAUDE.md)")


def sessions_dir():
    """Root of the private session recordings; raises with a clear message when unset."""
    if not SESSIONS_DIR:
        raise RuntimeError(SESSIONS_HINT)
    return SESSIONS_DIR.replace("\\", "/").rstrip("/")


# Octave-robust consensus F0 references for the private sessions (refs/<session>.npz +
# analyze.py; session-derived, local-only), computed by the 2026-10-03 session-attribution
# investigation (AC / SHS / PENN family majority). Folder: $SYRINX_SESSION_ATTRIB_DIR, else
# the gitignored build/investigate-2026-10-03/session-attribution of this checkout or, from
# a linked worktree, of the main checkout. Resolved lazily via session_attrib_dir().
_ATTRIB_SUB = os.path.join("build", "investigate-2026-10-03", "session-attribution")
SESSION_ATTRIB_HINT = ("set SYRINX_SESSION_ATTRIB_DIR to the folder holding the session-attribution "
                       "consensus F0 references for the private session recordings "
                       "(see scripts/resonance-lab/README.md)")


def _main_checkout():
    """Root of the main checkout when REPO is a linked git worktree, else REPO."""
    dotgit = os.path.join(REPO, ".git")
    if not os.path.isfile(dotgit):
        return REPO
    with open(dotgit, encoding="utf-8") as f:   # "gitdir: <main>/.git/worktrees/<name>"
        gitdir = os.path.normpath(os.path.join(REPO, f.read().split(":", 1)[1].strip()))
    return os.path.dirname(os.path.dirname(os.path.dirname(gitdir)))


def session_attrib_dir():
    """Folder of the session consensus F0 references; raises with a clear message when absent."""
    env = os.environ.get("SYRINX_SESSION_ATTRIB_DIR", "")
    roots = [env] if env else [os.path.join(REPO, _ATTRIB_SUB), os.path.join(_main_checkout(), _ATTRIB_SUB)]
    for root in roots:
        if os.path.isdir(root):
            return root.replace("\\", "/").rstrip("/")
    raise RuntimeError(SESSION_ATTRIB_HINT)


ECAPA_ONNX = os.path.join(REPO, "node_modules", "@huggingface", "transformers", ".cache",
                          "Alice-Sabrina-Ivy", "voice-gender-classifier-onnx-q8-v2", "onnx",
                          "model_quantized.onnx")

SR = 16000          # every benchmark item is delivered to candidates at 16 kHz mono float32
F0_HOP = 0.01       # F0 tracks: 10 ms grid
SEED = 20261004

for d in (BENCH, AUDIO, F0DIR, MANIFESTS, SCORES, RESULTS, TMP):
    os.makedirs(d, exist_ok=True)
