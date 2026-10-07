# yamnet_lib.py — YAMNet as a voice detector for the voice-detector benchmark
# (2026-10-06, audio-event candidate). Shared by run_yamnet.py (probabilities
# for every benchmark stream) and write_cand.py (candidate directories).
#
# Model: the official YAMNet (tensorflow/models research/audioset/yamnet,
# Apache-2.0; weights https://storage.googleapis.com/audioset/yamnet.h5),
# converted to ONNX by convert_onnx.py (core network only: log-mel patches ->
# 521 sigmoid scores, BN folded). Features are computed here exactly as the
# official features.py does (periodic Hann 400 / hop 160 / FFT 512, magnitude,
# the TF HTK mel matrix 125-7500 Hz x 64, log(mel + 0.001)); the parity check
# against the official TF pipeline is in convert_onnx.py.
#
# Causal streaming framing (what a browser implementation would do): the
# detector starts with 95 mel frames of digital silence as history (the
# zero-padded waveform's log-mel), so a probability exists from the first
# STFT frame on. Frame i of a grid with hop H mel frames is the patch of the
# T mel frames ending at original mel frame H*i; it covers samples up to
# 160*H*i + 400 and is therefore available at 25 + 10*H*i ms of stream time.
import numpy as np

SR = 16000
WIN, HOP, NFFT = 400, 160, 512
LOG_OFFSET = 0.001

# Human-vocal classes (fixed before any benchmark output was looked at): the
# AudioSet classes whose definition needs a human voice. Speech family
# (0-4), shouts / screams (6-11), whispering (12), laughter (13-18), crying /
# wail / sigh (19-23), singing family (24-31: singing, choir, yodeling, chant,
# mantra, child singing, synthetic singing, rapping), humming, groan, grunt
# (32-34), speech babble (65), beatboxing (213), opera (233), vocal music
# (249), a capella (250), song (261), lullaby (266).
# Excluded: 5 speech synthesizer, 35 whistling, 36-45 breathing / cough /
# sneeze and other body sounds.
VOCAL = list(range(0, 5)) + list(range(6, 35)) + [65, 213, 233, 249, 250, 261, 266]
# extra classes stored for diagnostics only (never used in the voice probability)
EXTRA = [5, 35, 36, 125, 132, 490, 494, 495, 496, 497, 500, 510]
STORED = VOCAL + EXTRA


def hann_periodic(n=WIN):
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float64)


def log_mel(x16, mel, pad_frames=95):
    """Log-mel frames of x16 preceded by pad_frames frames of silence history.
    Row j' covers padded samples [160 j', 160 j' + 400); with pad_frames = 95
    row 95 + j is the original mel frame j (samples [160 j, 160 j + 400))."""
    xp = np.concatenate([np.zeros(pad_frames * HOP, np.float64), x16.astype(np.float64)])
    nf = (len(xp) - WIN) // HOP + 1 if len(xp) >= WIN else 0
    if nf <= 0:
        return np.zeros((0, mel.shape[1]), np.float32)
    w = hann_periodic()
    out = np.empty((nf, mel.shape[1]), np.float32)
    step = 20000
    for a in range(0, nf, step):
        b = min(nf, a + step)
        idx = (np.arange(a, b) * HOP)[:, None] + np.arange(WIN)[None, :]
        fr = xp[idx] * w
        mag = np.abs(np.fft.rfft(fr, NFFT, axis=1))
        out[a:b] = np.log(mag @ mel.astype(np.float64) + LOG_OFFSET)
    return out


SILENCE = float(np.log(LOG_OFFSET))  # log-mel of digital silence


def patch_iter(lm, hop_frames, T=96, pad_frames=95, batch=512, real=None):
    """Yields batches of patches for frames i = 0.. of a grid with hop
    hop_frames mel frames: patch i = the T lm rows ending at padded row
    pad_frames + hop_frames * i (only complete STFT frames exist). With
    real = R < T only the last R rows carry audio; the first T - R rows are
    set to digital silence (a short-window variant: the patch then depends on
    (R - 1) * 10 + 25 ms of audio)."""
    last_end = len(lm) - 1  # padded row index
    n = (last_end - pad_frames) // hop_frames + 1 if last_end >= pad_frames else 0
    starts = pad_frames + hop_frames * np.arange(n) - (T - 1)
    st = np.lib.stride_tricks.sliding_window_view(lm, (T, lm.shape[1]))[:, 0]  # view (len-T+1, T, 64)
    for a in range(0, n, batch):
        b = np.array(st[starts[a:a + batch]])
        if real is not None and real < T:
            b[:, : T - real, :] = SILENCE
        yield b


def n_frames(lm_len, hop_frames, pad_frames=95):
    last_end = lm_len - 1
    return (last_end - pad_frames) // hop_frames + 1 if last_end >= pad_frames else 0


def voice_prob(scores_stored):
    """Sum of the human-vocal class scores, clipped to [0, 1]."""
    v = scores_stored[:, : len(VOCAL)].astype(np.float64).sum(axis=1)
    return np.clip(v, 0.0, 1.0)
