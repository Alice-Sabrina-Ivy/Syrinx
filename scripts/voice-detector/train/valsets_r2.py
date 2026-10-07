# valsets_r2.py — custom voice detector, round 2 (pre-registration Addendum
# D.4): the validation streams added for round 2, appended to the round-1
# stream lists (vvoice / vmix20 / vmix0); the round-1 entries and their dumps
# are left exactly as they are. Built only from the val split of the round-2
# sources (splits.json round2).
#
#   clean val voice (vvoice, native rate; meta.r2 = true):
#     svd val takes (48 kHz)               group "clinical"
#     singbap val (<= 30 min per participant and microphone, lowest FNV-1a(id) first),
#     fsvoice val                          group "exercises"
#     kids val                             group "children"
#   mixes (vmix20 / vmix0; ids vmix2__...): one more program per val noise clip
#     (the 150 clips of vneg.json), built like valsets.py: 20 s noise lead,
#     program, 5 s tail; +10 / 0 dB; lead 0 = read from the voice start.
#     Kinds rotate over svd (one val speaker's whole take), exercise (one singbap
#     val participant's takes on one microphone, or fsvoice val clips, joined
#     with 0.5 s gaps to >= 20 s; alternating) and children (one kids val
#     child's utterances, 0.3-1.5 s pauses, >= 20 s). 16 kHz.
#
#   python scripts/voice-detector/train/valsets_r2.py
import collections
import json
import os

import numpy as np

from tcommon import DATA, SR, VAL, fnv1a, load_manifest, read_wav, write_json
from valsets import LEAD, TAIL, active_rms, gender_of, ref_of, write_pcm16

SB_CAP_S = 30 * 60


def main():
    man = load_manifest()
    val = [r for r in man.values() if not r.get("drop") and r["split"] == "val" and r["kind"] == "voice"
           and r["source"] in ("svd", "singbap", "kids", "fsvoice")]
    val.sort(key=lambda r: r["id"])
    import soundfile as sf
    # ---- clean val voice ----
    vv_path = os.path.join(VAL, "streams", "vvoice.json")
    vv = [v for v in json.load(open(vv_path, encoding="utf8")) if not v.get("meta", {}).get("r2")]
    n_old = len(vv)
    grp = {"svd": "clinical", "singbap": "exercises", "fsvoice": "exercises", "kids": "children"}
    used = collections.Counter()
    for r in sorted(val, key=lambda r: (fnv1a(r["id"]), r["id"])):
        if r["source"] == "singbap":
            key = (r["participant"], r["mic"])
            if used[key] >= SB_CAP_S:
                continue
            used[key] += r["dur"]
        path = os.path.join(DATA, r.get("native_path") or r["path"])
        sr = int(r.get("native_sr") or r["sr"])
        info = sf.info(path)
        if info.samplerate != sr:
            raise SystemExit(f"{path}: {info.samplerate} != {sr}")
        vv.append({"id": r["id"], "gender": gender_of(r), "audio": {"path": path, "fmt": "wav", "sr": sr, "start": 0, "len": int(info.frames)},
                   "ref": {"kind": "praat", **ref_of(r)}, "holds": [], "meta": {"group": grp[r["source"]], "source": r["source"], "vgroup": r["group"], "r2": True}})
    write_json(vv_path, vv)
    new = vv[n_old:]
    print(f"vvoice: {n_old} round-1 + {len(new)} round-2 streams ({sum(v['audio']['len'] / v['audio']['sr'] for v in new) / 3600:.2f} h);",
          dict(collections.Counter((v['meta']['group'], v['gender']) for v in new)))

    # ---- programs ----
    rng = np.random.default_rng(20261007)
    P = collections.defaultdict(list)
    for r in val:
        if r["source"] == "svd":
            P["svd"].append({"name": r["id"], "items": [(r, 0.0, r["dur"])], "gaps": [0.5], "gender": gender_of(r), "kind": "svd"})
    # SingBAP takes are short (median 4 s): one participant's takes on one
    # microphone, joined with 0.5 s gaps to >= 20 s (Addendum E)
    sb = []
    by_pm = collections.defaultdict(list)
    for r in val:
        if r["source"] == "singbap":
            by_pm[(r["participant"], r["mic"])].append(r)
    for (pid, mic), rs in sorted(by_pm.items()):
        items, t = [], 0.0
        for r in sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"])):
            items.append((r, 0.0, r["dur"]))
            t += r["dur"] + 0.5
            if t >= 20:
                sb.append({"name": f"singbap_{pid}_{mic}_{len(sb)}", "items": items, "gaps": [0.5], "gender": "unknown", "kind": "exercise"})
                items, t = [], 0.0
    fsv_by_up = collections.defaultdict(list)
    for r in val:
        if r["source"] == "fsvoice":
            fsv_by_up[r["group"]].append(r)
    fs = []
    pool = sorted([r for rs in fsv_by_up.values() for r in rs], key=lambda r: (fnv1a(r["id"]), r["id"]))
    items, t = [], 0.0
    for r in pool:
        items.append((r, 0.0, r["dur"]))
        t += r["dur"] + 0.5
        if t >= 20:
            fs.append({"name": "fsvoice_" + "_".join(x[0]["id"].split("__")[1] for x in items), "items": items, "gaps": [0.5], "gender": "unknown", "kind": "exercise"})
            items, t = [], 0.0
    rng.shuffle(sb)
    rng.shuffle(fs)
    for a, b in zip(sb, fs):
        P["exercise"] += [a, b]
    P["exercise"] += sb[len(fs):] + fs[len(sb):]
    kid = collections.defaultdict(list)
    for r in val:
        if r["source"] == "kids":
            kid[r["child"]].append(r)
    for c, rs in sorted(kid.items()):
        rs = sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"]))
        items, t = [], 0.0
        for r in rs:
            items.append((r, 0.0, r["dur"]))
            t += r["dur"] + 0.9
            if t >= 20:
                P["children"].append({"name": f"kids_{c}_{len(P['children'])}", "items": items, "gaps": list(np.round(rng.uniform(0.3, 1.5, 64), 2)),
                                      "gender": "f" if "_F_" in c else "m", "kind": "children"})
                items, t = [], 0.0
    for k in ("svd", "children"):
        rng.shuffle(P[k])
    print("programs:", {k: len(v) for k, v in P.items()})

    # ---- mixes ----
    noises = json.load(open(os.path.join(VAL, "streams", "vneg.json"), encoding="utf8"))
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
            if pg["kind"] in ("svd", "exercise"):
                holds.append([round(t, 3), round(t + len(seg) / SR, 3)])
            t += len(seg) / SR + pg["gaps"][k % len(pg["gaps"])]
        dur = t - pg["gaps"][(len(pg["items"]) - 1) % len(pg["gaps"])]
        y = np.zeros(int(round(dur * SR)) + 1)
        for L in layers:
            a = int(round(L["at"] * SR))
            y[a:a + len(L["x"])] += L["x"]
        return y, layers, dur, holds

    out = {}
    for nm in ("vmix20", "vmix0"):
        out[nm] = [m for m in json.load(open(os.path.join(VAL, "streams", f"{nm}.json"), encoding="utf8")) if not m["id"].startswith("vmix2__")]
    n_old = {k: len(v) for k, v in out.items()}
    kinds = ["svd", "exercise", "children"]
    idx = collections.Counter()
    for q, nz in enumerate(noises):
        kind = kinds[q % 3]
        pg = P[kind][idx[kind] % len(P[kind])]
        idx[kind] += 1
        xn = read_wav(nz["audio"]["path"])[0].astype(np.float64)
        y, layers, pdur, holds = render_prog(pg)
        vg = 0.1 / max(active_rms(y), 1e-9)
        n = int(round((LEAD + pdur + TAIL) * SR))
        noise = xn[np.arange(n) % len(xn)]
        nrms = float(np.sqrt(np.mean(np.square(noise))))
        meta_n = nz["meta"]
        for snr in (10, 0):
            ng = 0.1 / (10 ** (snr / 20)) / max(nrms, 1e-12)
            mix = ng * noise
            a = int(round(LEAD * SR))
            mix[a:a + len(y)] += vg * y[:max(0, n - a)]
            peak = np.max(np.abs(mix))
            sc = 1.0 if peak <= 0.999 else 0.999 / peak
            mid = f"vmix2__{nz['id']}__{pg['name']}__snr{snr:+d}"
            p = os.path.join(VAL, "audio", "mix", mid + ".wav")
            if not os.path.exists(p):
                write_pcm16(p, (mix * sc).astype(np.float32))
            lay = [{"at": round(LEAD + L["at"], 4), "len": L["len"], "from": L["from"], "ref": ref_of(L["rec"])} for L in layers]
            meta = {"snr_db": snr, "voice": pg["name"], "voice_kind": pg["kind"], "noise_id": nz["id"], "noise_source": meta_n["source"],
                    "noise_cls": meta_n["cls"], "ngroup": meta_n["ngroup"], "gain_scale": sc, "r2": True}
            base = {"gender": pg["gender"], "ref": {"kind": "mix", "layers": lay}}
            out["vmix20"].append({"id": mid, **base, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": 0, "len": n}, "crop": 0.0,
                                  "holds": [[h[0] + LEAD, h[1] + LEAD] for h in holds], "meta": dict(meta, lead=20, voice_t0=LEAD, voice_t1=LEAD + pdur)})
            c0 = int(round(LEAD * SR))
            out["vmix0"].append({"id": mid, **base, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": c0, "len": n - c0}, "crop": c0 / SR,
                                 "holds": [[h[0], h[1]] for h in holds], "meta": dict(meta, lead=0, voice_t0=0.0, voice_t1=pdur)})
    for nm, v in out.items():
        write_json(os.path.join(VAL, "streams", f"{nm}.json"), v)
        print(f"{nm}: {n_old[nm]} round-1 + {len(v) - n_old[nm]} round-2 mixes")
    print("round-2 mix programs used:", dict(idx), "genders:", dict(collections.Counter(m["gender"] for m in out["vmix20"][n_old["vmix20"]:])))


if __name__ == "__main__":
    main()
