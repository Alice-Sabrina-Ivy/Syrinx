# build_mixes.py — end-to-end evaluation streams from the real corpora.
#
#   python scripts/notch-adversarial/realdata/build_mixes.py [--sets=voice_in_noise,held_series,noise_gated] [--jobs=4] [--no-render]
#
# Needs data/index_{noise,voice}.json (build_index.py) — the census labels pick
# the noise. Every stream is a SPEC (data/manifests/mix.<set>.json, field
# `spec`) of clip layers; render() below and realdata.mjs renderMix() turn a
# spec into identical samples (mix-parity.mjs checks), and the WAV is
# pre-rendered to data/mix/<set>/<id>.wav (PCM16). Deterministic (seeded selection).
#
# Sets
#   voice_in_noise  every non-duplicate real noise clip >= 20 s labelled
#                   stationary-tonal / intermittent-tonal, the 30 "mixed" ones
#                   with the strongest main line (+ 12 broadband controls) x 3 real voice programs x SNR {+10, 0}
#                   dB: 20 s noise lead (the interferer precedes the voice; the
#                   notch has promoted a steady source by then), the program,
#                   5 s noise tail. Programs rotate over
#                     held_series  real same-pitch holds (VocalSet: the same
#                                  note sung on other vowels / techniques by
#                                  the same singer) with 0.15-1 s gaps, >= 30 s
#                     speech       FDA / PTDB utterances of one speaker with
#                                  0.3-1.5 s pauses, >= 20 s
#                     other        vocadito song | PVQD (CAPE-V severity
#                                  < 20: vowels + sentences) | VOICED healthy /a/
#                                  (+ held / long-voiced runs of one session
#                                  when the opt-in private `sessions` source
#                                  was fetched — local only, never committed)
#                   SNR = voice active RMS (2 %-of-peak rule, noise-synth.js
#                   activeRms) / noise RMS over the stream; voice active RMS
#                   normalised to 0.1 (-20 dBFS).
#   held_series     real same-pitch hold series alone (no tonal noise) over a
#                   -70 dBFS Gaussian floor: every VocalSet (singer, note in
#                   75-460 Hz) with >= 3 holds >= 1.8 s x gap {0.15, 0.3, 0.5,
#                   1.0} s, >= 30 s — the "repeated holds with short breaths"
#                   family on real voices.
#   noise_gated     the R8 adversary on REAL sources: every non-duplicate
#                   stationary-tonal clip >= 20 s, looped to 50 s, normalised
#                   to -35 dBFS, switched fully off for {0.15, 0.5, 1.0} s
#                   every {5, 8} s from t = 2 s (20 ms ramps, as r2int.mjs
#                   --part=intermit) over the same Gaussian floor (rms 3e-4,
#                   r2int's). Noise-only: any painted frame is false voicing.
import os, json, math, collections
from concurrent.futures import ProcessPoolExecutor
import numpy as np, soundfile as sf
from common import DATA, SR, args, write_clip, save_manifest

A = args()
JOBS = int(A.get("jobs", 4))
SETS = A.get("sets", "voice_in_noise,held_series,noise_gated").split(",")
LOAD = {}

def clip(path):
    if path not in LOAD: LOAD[path] = sf.read(os.path.join(DATA, path), dtype="float32")[0]
    return LOAD[path]

def rnd(v): return int(math.floor(v + 0.5))

def gate_env(n, gates, fade):
    g = np.ones(n)
    i = np.arange(n)
    for t0, t1 in gates:
        a, b = rnd(t0 * SR), rnd(t1 * SR)
        lo, hi = max(0, a - fade), min(n, b + fade)
        k = i[lo:hi]
        v = np.where(k < a, (a - k) / fade, np.where(k >= b, (k - b + 1) / fade, 0.0))
        g[lo:hi] = np.minimum(g[lo:hi], np.clip(v, 0, 1))
    return g

def render(spec):
    """Mirror of realdata.mjs renderMix (float64 accumulate, float32 out)."""
    n = rnd(spec["dur"] * SR); y = np.zeros(n)
    for L in spec["layers"]:
        x = clip(L["clip"]).astype(np.float64)
        a, f, ln = rnd(L["at"] * SR), rnd(L.get("from", 0) * SR), rnd(L["len"] * SR)
        fade = max(1, rnd(L.get("fade", 0.02) * SR))
        m = min(ln, n - a)
        if m <= 0: continue
        k = f + np.arange(m)
        if L.get("loop"): k = k % len(x)
        else: m = int(min(m, max(0, len(x) - f))); k = k[:m]
        i = np.arange(m)
        e = np.minimum(np.minimum(1.0, (i + 1) / fade), (ln - i) / fade) * gate_env(ln, L.get("gates", []), fade)[:m]
        y[a:a + m] += L["gain"] * (e * x[k])
    return y.astype(np.float32)

def active_rms(x):
    pk = np.max(np.abs(x)) if len(x) else 0
    m = np.abs(x) > 0.02 * pk
    return float(np.sqrt(np.mean(np.square(x[m], dtype=np.float64)))) if m.any() else 0.0

# ---- voice programs ---------------------------------------------------------
def seg_layers(items, gaps, rng, target, fade=0.03):
    """items: [(clip, from, len, meta)], concatenated with gaps cycling
    `gaps` until >= target s. Returns (layers, dur, holds[[t0,t1,f0]])."""
    layers, t, holds, k = [], 0.0, [], 0
    while t < target and k < 400:
        c, fr, ln, meta = items[k % len(items)]
        layers.append(dict(clip=c, at=round(t, 4), **{"from": round(fr, 4)}, len=round(ln, 4), gain=1.0, loop=False, fade=fade))
        if meta.get("f0"): holds.append([round(t, 3), round(t + ln, 3), meta["f0"]])
        t += ln + gaps[k % len(gaps)]; k += 1
    return layers, round(t - gaps[(k - 1) % len(gaps)], 4), holds

def vocalset_notes(voice):
    """(singer, note) -> [(clip, t0, len, f0)] same-pitch holds (+-30 c)."""
    out = collections.defaultdict(list)
    for r in voice:
        if r["source"] != "vocalset": continue
        for h in r["held"]:
            if h[1] - h[0] < 1.8 or not (75 <= h[2] <= 460): continue
            out[(r["singer"], round(12 * math.log2(h[2] / 440)))].append((r["path"], h[0], h[1] - h[0], h[2]))
    good = {}
    for key, L in out.items():
        f = np.median([q[3] for q in L])
        L = [q for q in L if abs(1200 * math.log2(q[3] / f)) <= 30]
        if len(L) >= 3: good[key] = sorted(L)
    return good

def programs(voice, rng):
    P = collections.defaultdict(list)
    notes = vocalset_notes(voice)
    for (singer, n), L in sorted(notes.items()):
        items = [(c, max(0.0, t0 - 0.05), ln + 0.1, dict(f0=f0)) for c, t0, ln, f0 in L]
        lay, dur, holds = seg_layers(items, [0.15, 0.3, 0.5, 1.0], rng, 30)
        P["held_series"].append(dict(name=f"vocalset_{singer}_n{n}", layers=lay, dur=dur, holds=holds, kind="held_series"))
    by = collections.defaultdict(list)
    for r in voice:
        if r["source"] == "fda": by[("fda", r["id"][6:8])].append(r)
        if r["source"] == "ptdb": by[("ptdb", r["id"].split("_")[3])].append(r)
    for (src, spk), rs in sorted(by.items()):
        rs = sorted(rs, key=lambda r: r["id"]); rng.shuffle(rs)
        gaps = list(np.round(rng.uniform(0.3, 1.5, 64), 2))
        lay, dur, _ = seg_layers([(r["path"], 0.0, r["dur"], {}) for r in rs], gaps, rng, 20, fade=0.01)
        P["speech"].append(dict(name=f"{src}_{spk}", layers=lay, dur=dur, holds=[], kind="speech"))
    for r in sorted((r for r in voice if r["source"] == "vocadito"), key=lambda r: r["id"]):
        items = [(r["path"], 0.0, r["dur"], {})]
        lay, dur, _ = seg_layers(items, [0.5], rng, 15, fade=0.01)
        P["other"].append(dict(name=r["id"], layers=lay, dur=dur, holds=[[q[0], q[1], q[2]] for q in r["held"]], kind="sing"))
    sess = collections.defaultdict(list)   # opt-in private source (empty in a public build)
    for r in voice:
        if r["source"] == "sessions": sess[r["session"]].append(r)
    for s, rs in sorted(sess.items()):
        rs = sorted(rs, key=lambda r: r["session_t0"])
        for i in range(0, len(rs), 8):
            ch = rs[i:i + 8]
            if sum(r["dur"] for r in ch) < 8: continue
            lay, dur, _ = seg_layers([(r["path"], 0.0, r["dur"], {}) for r in ch], [0.4], rng, sum(r["dur"] for r in ch) - 0.01, fade=0.01)
            P["other"].append(dict(name=f"sessions_{s}_{i}", layers=lay, dur=dur, holds=[], kind="sessions"))
    for r in sorted((r for r in voice if r["source"] == "pvqd" and (r.get("capev_severity") is not None and r["capev_severity"] < 20)), key=lambda r: r["id"]):
        P["other"].append(dict(name=r["id"], layers=[dict(clip=r["path"], at=0.0, **{"from": 0.0}, len=r["dur"], gain=1.0, loop=False, fade=0.01)],
                               dur=r["dur"], holds=[[q[0], q[1], q[2]] for q in r["held"]], kind="clinical"))
    for r in sorted((r for r in voice if r["source"] == "voiced" and "healthy" in r.get("diagnosis", "").lower()), key=lambda r: r["id"]):
        P["other"].append(dict(name=r["id"], layers=[dict(clip=r["path"], at=0.0, **{"from": 0.0}, len=r["dur"], gain=1.0, loop=False, fade=0.01)],
                               dur=r["dur"], holds=[[q[0], q[1], q[2]] for q in r["held"]], kind="sustained_a"))
    for k in P: rng.shuffle(P[k])
    return P

def shift(layers, dt, gain):
    return [dict(L, at=round(L["at"] + dt, 4), gain=L["gain"] * gain) for L in layers]

def voice_gain(layers, dur):
    y = render(dict(dur=dur, layers=layers))
    a = active_rms(y)
    return 0.1 / a if a > 0 else 1.0

FLOOR = "noise/synthfloor/gauss_3e-4.wav"
def make_floor():
    p = os.path.join(DATA, FLOOR)
    if not os.path.exists(p):
        x = (np.random.default_rng(21).standard_normal(SR * 60) * 3e-4).astype(np.float32)
        r = write_clip("noise", "synthfloor", "gauss_3e-4", x, {"class": "floor", "url": "numpy default_rng(21) Gaussian, rms 3e-4", "license": "n/a (synthetic)",
                                                               "attribution": "", "orig_sr": SR, "orig_channels": 1, "codec": "pcm", "notes": "the r2int.mjs pause floor level"})
        save_manifest("noise", [r], "synthfloor")

# ---- sets -------------------------------------------------------------------
def set_voice_in_noise(noise, voice, rng):
    P = programs(voice, rng)
    tonal = [r for r in noise if r.get("label") in ("stationary-tonal", "intermittent-tonal") and r["dur"] >= 20]
    # mixed: the 30 with the strongest main line (most notch-relevant)
    mixed = sorted([r for r in noise if r.get("label") == "mixed" and r["dur"] >= 20 and r.get("main_line")],
                   key=lambda r: (-r["main_line"]["snr_db"], r["id"]))[:30]
    tonal += mixed
    bb = [r for r in noise if r.get("label") == "broadband" and r["dur"] >= 20 and r["source"] != "synthfloor"]
    rng.shuffle(bb)
    sel = sorted(tonal, key=lambda r: r["id"]) + sorted(bb[:12], key=lambda r: r["id"])
    out, idx = [], collections.Counter()
    LEAD, TAIL = 20.0, 5.0
    for nr in sel:
        for kind in ("held_series", "speech", "other"):
            pg = P[kind][idx[kind] % len(P[kind])]; idx[kind] += 1
            vg = voice_gain(pg["layers"], pg["dur"])
            dur = round(LEAD + pg["dur"] + TAIL, 4)
            nrms = float(np.sqrt(np.mean(np.square(render(dict(dur=dur, layers=[dict(clip=nr["path"], at=0, **{"from": 0}, len=dur, gain=1.0, loop=True, fade=0.02)])), dtype=np.float64))))
            for snr in (10, 0):
                ng = 0.1 / (10 ** (snr / 20)) / max(nrms, 1e-9)
                spec = dict(sr=SR, dur=dur, layers=[dict(clip=nr["path"], at=0.0, **{"from": 0.0}, len=dur, gain=ng, loop=True, fade=0.02)] + shift(pg["layers"], LEAD, vg))
                out.append(dict(id=f"vin__{nr['id']}__{pg['name']}__snr{snr:+d}", set="voice_in_noise", spec=spec, dur=dur,
                                noise_id=nr["id"], noise_label=nr.get("label"), noise_looped=bool(nr["dur"] < dur), voice=pg["name"], voice_kind=pg["kind"], snr_db=snr,
                                voice_t0=LEAD, voice_t1=round(LEAD + pg["dur"], 4), holds=[[round(h[0] + LEAD, 3), round(h[1] + LEAD, 3), h[2]] for h in pg["holds"]],
                                set_notes="20 s real-noise lead, real voice program, 5 s tail; SNR = voice active RMS / noise RMS"))
    return out

def set_held_series(noise, voice, rng):
    P = programs(voice, rng)
    out = []
    for pg in sorted(P["held_series"], key=lambda p: p["name"]):
        base = pg["layers"]
        for gap in (0.15, 0.3, 0.5, 1.0):
            lay, t = [], 1.0
            holds = []
            k = 0
            while t < 31 and k < 200:
                L = base[k % len(base)]; lay.append(dict(L, at=round(t, 4))); holds.append([round(t, 3), round(t + L["len"], 3), pg["holds"][k % len(base)][2]])
                t += L["len"] + gap; k += 1
            dur = round(t - gap + 1.0, 4)
            vg = voice_gain(lay, dur)
            spec = dict(sr=SR, dur=dur, layers=[dict(clip=FLOOR, at=0.0, **{"from": 0.0}, len=dur, gain=(10 ** (-70 / 20)) / 3e-4, loop=True, fade=0.02)] + [dict(L, gain=vg) for L in lay])
            out.append(dict(id=f"held__{pg['name']}__gap{int(gap * 1000)}ms", set="held_series", spec=spec, dur=dur, voice=pg["name"], gap_s=gap,
                            f0=pg["holds"][0][2], holds=holds, set_notes="real same-pitch holds (VocalSet, same singer, other vowels/techniques) with silent gaps over a -70 dBFS floor"))
    return out

def set_noise_gated(noise, voice, rng):
    out = []
    st = sorted([r for r in noise if r.get("label") == "stationary-tonal" and r["dur"] >= 20], key=lambda r: r["id"])
    DUR, ON = 50.0, 2.0
    for nr in st:
        x = render(dict(dur=DUR, layers=[dict(clip=nr["path"], at=0, **{"from": 0}, len=DUR, gain=1.0, loop=True, fade=0.02)]))
        g = (10 ** (-35 / 20)) / max(float(np.sqrt(np.mean(np.square(x, dtype=np.float64)))), 1e-9)
        for per in (5, 8):
            for off in (0.15, 0.5, 1.0):
                gates = [[round(t - ON + per - off, 4), round(t - ON + per, 4)] for t in np.arange(ON, DUR, per)]
                spec = dict(sr=SR, dur=DUR, layers=[dict(clip=FLOOR, at=0.0, **{"from": 0.0}, len=DUR, gain=1.0, loop=True, fade=0.02),
                                                    dict(clip=nr["path"], at=ON, **{"from": 0.0}, len=DUR - ON, gain=g, loop=True, fade=0.02, gates=gates)])
                out.append(dict(id=f"gated__{nr['id']}__p{per}_off{int(off * 1000)}ms", set="noise_gated", spec=spec, dur=DUR, noise_id=nr["id"],
                                period_s=per, off_s=off, on_s=ON, gates_abs=[[round(a + ON, 4), round(b + ON, 4)] for a, b in gates],
                                set_notes="real stationary-tonal source switched fully off for off_s every period_s (r2int intermit on real noise), -35 dBFS, floor rms 3e-4"))
    return out

def rend_one(m):
    """PCM16 (exact k/32768 levels, so a reader's /32768 is lossless): the
    mixes are evaluation streams, ~3x smaller than float; peak / clip count
    recorded. A stream whose peak exceeds 0.9 (noise clips with clicks /
    fade-ins have a low RMS but loud transients) is scaled down as a whole —
    every layer gain x level_scale, SNR unchanged — and the spec updated."""
    y = render(m["spec"]); scale = 1.0
    pk = float(np.max(np.abs(y))) if len(y) else 0.0
    if pk > 0.9:
        scale = 0.9 / pk
        for L in m["spec"]["layers"]: L["gain"] = L["gain"] * scale
        y = render(m["spec"])
    q = np.round(y.astype(np.float64) * 32768)
    clipped = int(np.sum((q > 32767) | (q < -32768)))
    d = os.path.join(DATA, "mix", m["set"]); os.makedirs(d, exist_ok=True)
    p = os.path.join(d, m["id"] + ".wav"); sf.write(p, np.clip(q, -32768, 32767).astype(np.int16), SR, subtype="PCM_16")
    return os.path.relpath(p, DATA).replace("\\", "/"), round(float(np.max(np.abs(y))), 4), clipped, round(scale, 6), m["spec"]

if __name__ == "__main__":
    make_floor()
    noise = [r for r in json.load(open(os.path.join(DATA, "index_noise.json"))) if not r.get("dup_of")]
    voice = [r for r in json.load(open(os.path.join(DATA, "index_voice.json"))) if not r.get("dup_of")]
    FN = dict(voice_in_noise=set_voice_in_noise, held_series=set_held_series, noise_gated=set_noise_gated)
    for s in SETS:
        recs = FN[s](noise, voice, np.random.default_rng(20261005))
        if "no-render" not in A:
            with ProcessPoolExecutor(JOBS) as ex: res = list(ex.map(rend_one, recs, chunksize=4))
            for r, (p, pk, cl, sc, spec) in zip(recs, res): r["path"] = p; r["peak"] = pk; r["clipped"] = cl; r["level_scale"] = sc; r["spec"] = spec
        for r in recs: r["source"] = "mix"; r["kind"] = "mix"; r["sr"] = SR
        save_manifest("mix", recs, s)
        print(f"{s}: {len(recs)} streams, {sum(r['dur'] for r in recs) / 3600:.2f} h", flush=True)
