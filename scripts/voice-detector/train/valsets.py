# valsets.py — custom voice detector (2026-10-06): the VALIDATION streams of
# the pre-registration §3 ("Validation streams through the production chain"),
# built only from the val split of §2.2. Writes stream specs that valdump.mjs
# runs through the app's production chain (same columns as dump.mjs):
#
#   <VAL>/streams/vvoice.json  clean val voice at its NATIVE rate, whole
#       recordings: LibriSpeech test (<= 20 utterances per speaker: the 20
#       lowest FNV-1a(id)), VCTK val, MDVR-KCL val, Coswara val (vowels +
#       countings), Cantoria. Reference = the Praat AC track of the data step
#       (60-1100 Hz, 10 ms; the VocalSet / PVQD / VOICED convention).
#       group: speech (LibriSpeech, VCTK, MDVR, Coswara counting) | vowels
#       (Coswara vowels) | singing (Cantoria); gender from corpus metadata,
#       choir S / A -> f, T / B -> m, MDVR unknown.
#   <VAL>/streams/vmix20.json / vmix0.json  val voice programs in val negatives,
#       built like the benchmark's mixes (notch-adversarial/realdata/
#       build_mixes.py set_voice_in_noise): 20 s noise lead, program, 5 s tail;
#       SNR = voice active RMS (2 %-of-peak rule) / noise RMS over the stream,
#       voice active RMS 0.1; +10 and 0 dB; vmix0 = the same mix read from the
#       voice start (lead 0). Every noise clip carries 1 program, kinds
#       rotating over held (one Coswara participant's vowels, gaps 0.15-1 s),
#       speech (one speaker's utterances, 0.3-1.5 s pauses, >= 20 s) and
#       singing (a 25 s Cantoria excerpt). 16 kHz (the data step's files).
#   <VAL>/streams/vneg.json  the same noise clips alone (first 90 s).
#   Noise clips: 60 FSD50K eval machine / room clips >= 20 s and 60 fstrain
#       val clips >= 20 s (lowest FNV-1a(id), <= 2 per uploader), 30 synthetic
#       val interferers (seeds 1e9 + 0..29, 60 s).
#
#   python scripts/voice-detector/train/valsets.py
import collections
import os

import numpy as np

import synth
from tcommon import DATA, SR, VAL, args, fnv1a, load_manifest, read_wav, write_json

A = args()
LEAD, TAIL = 20.0, 5.0
PROGS_PER_NOISE = 1   # (2 doubled the production-chain cost on the shared machine for little extra precision)
SYN_SEED0 = 1_000_000_000


def active_rms(x):
    pk = np.max(np.abs(x)) if len(x) else 0
    m = np.abs(x) > 0.02 * pk
    return float(np.sqrt(np.mean(np.square(x[m], dtype=np.float64)))) if m.any() else 0.0


def write_pcm16(path, x, sr=SR):
    import soundfile as sf
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if np.max(np.abs(x)) > 1.0:
        raise ValueError(f"{path}: clips")
    sf.write(path, x, sr, subtype="PCM_16")


def ref_of(rec):
    z = np.load(os.path.join(DATA, rec["f0_path"]))
    p = os.path.join(VAL, "refs", rec["id"] + ".f32")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        z["f0"].astype("<f4").tofile(p)
    return {"path": p, "t0": float(z["t0"]), "hop": float(z["hop"])}


def gender_of(r):
    g = r.get("gender")
    return g if g in ("f", "m") else "unknown"


def main():
    man = load_manifest()
    val = [r for r in man.values() if not r.get("drop") and r["split"] == "val"]
    voice = sorted([r for r in val if r["kind"] == "voice"], key=lambda r: r["id"])
    # ---- clean val voice ----
    by_spk = collections.defaultdict(list)
    for r in voice:
        if r["source"] == "librispeech":
            by_spk[r["speaker"]].append(r)
    keep_libri = set()
    for spk, rs in by_spk.items():
        for r in sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"]))[:20]:
            keep_libri.add(r["id"])
    vv = []
    for r in voice:
        if r["source"] == "librispeech" and r["id"] not in keep_libri:
            continue
        grp = "singing" if r["source"] == "cantoria" else "vowels" if r["source"] == "coswara" and r["recording"].startswith("vowel") else "speech"
        path = os.path.join(DATA, r.get("native_path") or r["path"])
        sr = int(r.get("native_sr") or r["sr"])
        import soundfile as sf
        info = sf.info(path)
        if info.samplerate != sr:
            raise SystemExit(f"{path}: {info.samplerate} != {sr}")
        vv.append({"id": r["id"], "gender": gender_of(r), "audio": {"path": path, "fmt": "wav", "sr": sr, "start": 0, "len": int(info.frames)},
                   "ref": {"kind": "praat", **ref_of(r)}, "holds": [], "meta": {"group": grp, "source": r["source"], "vgroup": r["group"]}})
    write_json(os.path.join(VAL, "streams", "vvoice.json"), vv)
    print(f"vvoice: {len(vv)} streams, {sum(v['audio']['len'] / v['audio']['sr'] for v in vv) / 3600:.2f} h;",
          dict(collections.Counter((v['meta']['group'], v['gender']) for v in vv)))

    # ---- programs (16 kHz files of the data step) ----
    rng = np.random.default_rng(20261006)
    P = collections.defaultdict(list)
    cos_v = collections.defaultdict(list)
    for r in voice:
        if r["source"] == "coswara" and r["recording"].startswith("vowel"):
            cos_v[r["participant"]].append(r)
    for pid, rs in sorted(cos_v.items()):
        rs = sorted(rs, key=lambda r: r["recording"])
        if sum(r["dur"] for r in rs) < 12:
            continue
        P["held"].append({"name": f"coswara_{pid}", "items": [(r, 0.0, r["dur"]) for r in rs], "gaps": [0.15, 0.3, 0.5, 1.0], "gender": gender_of(rs[0]), "kind": "held"})
    spk = collections.defaultdict(list)
    for r in voice:
        if r["source"] in ("librispeech", "vctk") and (r["source"] != "librispeech" or r["id"] in keep_libri):
            spk[(r["source"], r["group"])].append(r)
    for (src, g), rs in sorted(spk.items()):
        rs = sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"]))
        items, t = [], 0.0
        for r in rs:
            items.append((r, 0.0, r["dur"]))
            t += r["dur"] + 0.9
            if t >= 20:
                break
        if t < 20:
            continue
        P["speech"].append({"name": f"{src}_{g.split(':')[1]}", "items": items, "gaps": list(np.round(rng.uniform(0.3, 1.5, 64), 2)), "gender": gender_of(rs[0]), "kind": "speech"})
    for r in voice:
        if r["source"] == "mdvr":
            for k in range(int(r["dur"] // 60)):
                P["speech"].append({"name": f"{r['id']}_{k}", "items": [(r, 10.0 + 60 * k, 25.0)], "gaps": [0.5], "gender": "unknown", "kind": "speech"})
        if r["source"] == "cantoria":
            f0 = np.load(os.path.join(DATA, r["f0_path"]))["f0"]
            for k in range(int(r["dur"] // 50)):
                a = 5.0 + 50 * k
                seg = f0[int(a * 100):int((a + 25) * 100)]
                if len(seg) and (seg > 0).mean() >= 0.5:
                    P["singing"].append({"name": f"{r['id']}_{k}", "items": [(r, a, 25.0)], "gaps": [0.5], "gender": gender_of(r), "kind": "singing"})
    for k in P:
        rng.shuffle(P[k])
    print("programs:", {k: len(v) for k, v in P.items()})

    # ---- noise clips ----
    def pick(src, n):
        rs = sorted([r for r in val if r["kind"] == "nonvoice" and r["source"] == src and r["dur"] >= 20 and r.get("machine_room")],
                    key=lambda r: (fnv1a(r["id"]), r["id"]))
        out, up = [], collections.Counter()
        for r in rs:
            if up[r["group"]] >= 2:
                continue
            up[r["group"]] += 1
            out.append(r)
            if len(out) == n:
                break
        return out
    noises = []
    for r in pick("fsd50k", 60) + pick("fstrain", 60):
        noises.append({"id": r["id"], "path": os.path.join(DATA, r["path"]), "source": r["source"], "cls": ",".join(r.get("labels", [])) or r.get("query"), "group": r["group"]})
    for i in range(30):
        seed = SYN_SEED0 + i
        x, m = synth.gen(seed, 60 * SR)
        x = (x * 0.05).astype(np.float32)   # unit RMS -> -26 dBFS
        p = os.path.join(VAL, "audio", "synth", f"synth_{seed}.wav")
        write_pcm16(p, x)
        noises.append({"id": f"synth__{seed}", "path": p, "source": "synthetic", "cls": m["family"], "group": f"synth:{seed}"})
    print(f"noise clips: {len(noises)}")

    # ---- vneg ----
    vn = []
    import soundfile as sf
    for nz in noises:
        info = sf.info(nz["path"])
        n = min(int(info.frames), 90 * SR)
        vn.append({"id": nz["id"], "gender": "na", "audio": {"path": nz["path"], "fmt": "wav", "sr": SR, "start": 0, "len": n},
                   "ref": {"kind": "none"}, "holds": [], "meta": {"source": nz["source"], "cls": nz["cls"], "ngroup": nz["group"]}})
    write_json(os.path.join(VAL, "streams", "vneg.json"), vn)

    # ---- mixes ----
    cache = {}

    def clip(r):
        if r["id"] not in cache:
            cache[r["id"]] = read_wav(os.path.join(DATA, r["path"]))[0].astype(np.float64)
        return cache[r["id"]]

    def render_prog(pg):
        layers, t, holds = [], 0.0, []
        for k, (r, fr, ln) in enumerate(pg["items"]):
            x = clip(r)
            a0, n = int(round(fr * SR)), int(round(ln * SR))
            seg = x[a0:a0 + n]
            fade = int(0.01 * SR)
            e = np.minimum(np.minimum(1.0, (np.arange(len(seg)) + 1) / fade), (len(seg) - np.arange(len(seg))) / fade)
            layers.append({"at": round(t, 4), "from": fr, "len": len(seg) / SR, "rec": r, "x": seg * e})
            if pg["kind"] == "held":
                holds.append([round(t, 3), round(t + len(seg) / SR, 3)])
            t += len(seg) / SR + pg["gaps"][k % len(pg["gaps"])]
        dur = t - pg["gaps"][(len(pg["items"]) - 1) % len(pg["gaps"])]
        y = np.zeros(int(round(dur * SR)) + 1)
        for L in layers:
            a = int(round(L["at"] * SR))
            y[a:a + len(L["x"])] += L["x"]
        return y, layers, dur, holds

    mixes20, mixes0 = [], []
    idx = collections.Counter()
    kinds = ["held", "speech", "singing"]
    q = 0
    for nz in noises:
        xn = read_wav(nz["path"])[0].astype(np.float64)
        for _ in range(PROGS_PER_NOISE):
            kind = kinds[q % 3]
            q += 1
            pg = P[kind][idx[kind] % len(P[kind])]
            idx[kind] += 1
            y, layers, pdur, holds = render_prog(pg)
            vg = 0.1 / max(active_rms(y), 1e-9)
            n = int(round((LEAD + pdur + TAIL) * SR))
            noise = xn[np.arange(n) % len(xn)]
            nrms = float(np.sqrt(np.mean(np.square(noise))))
            for snr in (10, 0):
                ng = 0.1 / (10 ** (snr / 20)) / max(nrms, 1e-12)
                mix = ng * noise
                a = int(round(LEAD * SR))
                mix[a:a + len(y)] += vg * y[:max(0, n - a)]
                peak = np.max(np.abs(mix))
                sc = 1.0 if peak <= 0.999 else 0.999 / peak
                mid = f"vmix__{nz['id']}__{pg['name']}__snr{snr:+d}"
                p = os.path.join(VAL, "audio", "mix", mid + ".wav")
                if not os.path.exists(p) or "force" in A:
                    write_pcm16(p, (mix * sc).astype(np.float32))
                lay = [{"at": round(LEAD + L["at"], 4), "len": L["len"], "from": L["from"], "ref": ref_of(L["rec"])} for L in layers]
                meta = {"snr_db": snr, "voice": pg["name"], "voice_kind": pg["kind"], "noise_id": nz["id"], "noise_source": nz["source"], "noise_cls": nz["cls"],
                        "ngroup": nz["group"], "gain_scale": sc}
                v0, v1 = LEAD, LEAD + pdur
                base = {"gender": pg["gender"], "ref": {"kind": "mix", "layers": lay}}
                mixes20.append({"id": mid, **base, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": 0, "len": n}, "crop": 0.0,
                                "holds": [[h[0] + LEAD, h[1] + LEAD] for h in holds], "meta": dict(meta, lead=20, voice_t0=v0, voice_t1=v1)})
                c0 = int(round(LEAD * SR))
                mixes0.append({"id": mid, **base, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": c0, "len": n - c0}, "crop": c0 / SR,
                               "holds": [[h[0], h[1]] for h in holds], "meta": dict(meta, lead=0, voice_t0=0.0, voice_t1=v1 - LEAD)})
    write_json(os.path.join(VAL, "streams", "vmix20.json"), mixes20)
    write_json(os.path.join(VAL, "streams", "vmix0.json"), mixes0)
    print(f"vmix20 / vmix0: {len(mixes20)} each; programs used {dict(idx)}; "
          f"{sum(m['audio']['len'] for m in mixes20) / SR / 3600:.2f} h / {sum(m['audio']['len'] for m in mixes0) / SR / 3600:.2f} h")
    print("mix genders:", dict(collections.Counter((m['meta']['snr_db'], m['gender']) for m in mixes20)))


if __name__ == "__main__":
    main()
