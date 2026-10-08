# build_vsess.py — custom voice detector, round 3 (pre-registration §2,
# validation side): the one-room carried-state VALIDATION sessions, built only
# from the rounds 1-2 validation split (never from the sealed confirmatory set).
#
# Voice groups (one voice source on one microphone each):
#   LibriSpeech test speakers (one chapter: the first in FNV order of the
#   chapter id; utterances in chapter order), VCTK val speakers (mic1, id
#   order), Coswara val participants (all their recordings), MDVR-KCL val
#   subjects, SVD val speakers (iau takes), SingBAP val participant x
#   microphone (takes in FNV order), kids val children (FNV order), Cantoria
#   singers, fsvoice val uploaders (FNV order).
# Session list: 1 clean + 2 noisy (+10 dB, then 0 dB) per group; groups taken
# in FNV-1a order of the group key within each source, the sources in turn
# (so every val source contributes), until 240 sessions.
# Noise beds (one per noisy session): the val negatives — FSD50K eval machine /
# room clips >= 30 s, every fstrain val clip, and 40 synthetic val
# interferers (seeds 1e9 + 1000 ... 1e9 + 1039, 300 s, synth.py) — in a
# seeded shuffled order (seed 20261010).
# References: each layer's Praat AC track (data step), frames kept within 30 dB
# of the recording's 95th-percentile voiced level (as the confirmatory set).
#
# Writes build/vad-train/r3/vsess/{audio,refs,streams/vsess.json}; dumps with
#   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/train/valdump.mjs --set=vsess --val=build/vad-train/r3/vsess
import collections
import json
import os
import sys

import numpy as np

from c3 import DATA, VSESS, args, fnv1a, guard_not_conf, load_manifest, log, write_json
import sessions as S

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "train"))
A = args()
SEED = 20261010
CAP = 240
SYN0 = 1_000_000_000 + 1000

ROW = {"librispeech": "speech", "vctk": "speech", "mdvr": "speech", "cantoria": "singing", "svd": "clinical", "singbap": "exercises",
       "fsvoice": "exercises", "kids": "children"}


def row_of(r):
    if r["source"] == "coswara":
        return "vowels" if r["recording"].startswith("vowel") else "speech"
    return ROW[r["source"]]


def gender_of(r):
    g = r.get("gender")
    return g if g in ("f", "m") else "unknown"


def groups(man):
    val = [r for r in man.values() if not r.get("drop") and r["split"] == "val" and r["kind"] == "voice"]
    G = collections.defaultdict(list)
    for r in val:
        s = r["source"]
        if s == "librispeech":
            G[(s, f"{r['speaker']}")].append(r)
        elif s == "vctk":
            if r.get("mic", "mic1") == "mic1":
                G[(s, r["group"])].append(r)
        elif s == "singbap":
            G[(s, f"{r['participant']}:{r['mic']}")].append(r)
        else:
            G[(s, r["group"])].append(r)
    out = {}
    for (s, k), rs in G.items():
        if s == "librispeech":
            chap = sorted({r["member"].split("/")[3] for r in rs}, key=lambda c: (fnv1a(c), c))[0]
            rs = sorted([r for r in rs if r["member"].split("/")[3] == chap], key=lambda r: r["id"])
            k = f"{k}:{chap}"
        elif s in ("singbap", "kids", "fsvoice"):
            rs = sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"]))
        else:
            rs = sorted(rs, key=lambda r: r["id"])
        out[(s, k)] = rs
    return out


def gated_ref(r):
    from tcommon import frame_levels_db, read_wav
    p = os.path.join(VSESS, "refs", r["id"] + ".f32")
    z = np.load(os.path.join(DATA, r["f0_path"]))
    t0, hop, f0 = float(z["t0"]), float(z["hop"]), z["f0"].astype(np.float32)
    if not os.path.exists(p):
        x = read_wav(os.path.join(DATA, r["path"]))[0]
        v = f0 > 0
        g = f0.copy()
        if v.any():
            lev = frame_levels_db(x, t0, hop, len(f0))
            g = np.where(v & (lev >= np.percentile(lev[v], 95) - 30.0), f0, 0).astype(np.float32)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        g.astype("<f4").tofile(p)
    return {"path": guard_not_conf(p), "t0": t0, "hop": hop}


def main():
    import soundfile as sf
    import synth
    from tcommon import read_wav
    man = load_manifest()
    G = groups(man)
    by_src = collections.defaultdict(list)
    for (s, k) in G:
        by_src[s].append(k)
    for s in by_src:
        by_src[s].sort(key=lambda k: (fnv1a(f"{s}:{k}"), k))
    order, i = [], 0
    srcs = sorted(by_src)
    while len(order) * 3 < CAP and any(by_src.values()):
        s = srcs[i % len(srcs)]
        i += 1
        if by_src[s]:
            order.append((s, by_src[s].pop(0)))
    # ---- noise beds ----
    neg = [r for r in man.values() if not r.get("drop") and r["split"] == "val" and r["kind"] == "nonvoice"]
    beds = [("fsd50k", r) for r in neg if r["source"] == "fsd50k" and r.get("machine_room") and float(r["dur"]) >= 30]
    beds += [("fstrain", r) for r in neg if r["source"] == "fstrain"]
    beds = sorted(beds, key=lambda t: t[1]["id"]) + [("synthetic", {"id": f"synth__{SYN0 + k}", "seed": SYN0 + k}) for k in range(40)]
    rng = np.random.default_rng(SEED)
    rng.shuffle(beds)
    log(f"vsess: {len(order)} groups -> {min(CAP, 3 * len(order))} sessions; beds {collections.Counter(b[0] for b in beds)}")
    specs, nk = [], 0
    for gi, (s, k) in enumerate(order):
        rs = G[(s, k)]
        recs = [{"dur": float(r["dur"])} for r in rs]
        audio = [read_wav(os.path.join(DATA, r["path"]))[0] for r in rs]
        refs = [gated_ref(r) for r in rs]
        for j, kind in enumerate(("clean", "noisy", "noisy")):
            if len(specs) >= CAP:
                break
            sidx = len(specs)
            seed = SEED * 1000 + sidx
            pl, stretches, info = S.timeline(recs, seed)
            bed = snr = None
            bmeta = {}
            if kind == "noisy":
                snr = 10 if nk % 2 == 0 else 0
                fam, br = beds[nk % len(beds)]
                nk += 1
                if fam == "synthetic":
                    x, m = synth.gen(br["seed"], int(S.LEN * S.SR))
                    bed = x.astype(np.float64)
                    bmeta = {"bed": br["id"], "bed_source": "synthetic", "bed_cls": m["family"]}
                else:
                    bed = read_wav(os.path.join(DATA, guard_not_conf(br["path"])))[0]
                    bmeta = {"bed": br["id"], "bed_source": fam, "bed_cls": ",".join(br.get("labels", [])) or br.get("query"), "bed_dur": float(br["dur"])}
            mix, vg, ng, sc, lev = S.render(recs, audio, pl, seed, bed, snr)
            sid = f"vsess__{s}__{k.replace(':', '_')}__{'clean' if kind == 'clean' else f'snr{snr:+d}'}"
            p = os.path.join(VSESS, "audio", sid + ".wav")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            sf.write(p, mix, S.SR, subtype="PCM_16")
            layers = [{"at": q["at"], "len": q["len"], "from": q["from"], "ref": refs[q["rec"]]} for q in pl]
            lmeta = [{"rec": rs[q["rec"]]["id"], "row": row_of(rs[q["rec"]]), "gender": gender_of(rs[q["rec"]]), "at": q["at"], "len": q["len"], "from": q["from"]} for q in pl]
            g = collections.Counter(x["gender"] for x in lmeta).most_common(1)[0][0]
            specs.append({"id": sid, "gender": g, "audio": {"path": p, "fmt": "wav", "sr": S.SR, "start": 0, "len": len(mix)},
                          "ref": {"kind": "mix", "layers": layers}, "holds": [],
                          "meta": {"side": "validation", "kind": kind, "snr_db": snr, "source": s, "vgroup": f"{s}:{k}", "stretches": stretches,
                                   "layers": lmeta, "voice_gain": vg, "noise_gain": ng, "gain_scale": sc, "voice_level_db": round(lev, 2), "seed": seed,
                                   **info, **bmeta}})
        log(f"  {gi + 1}/{len(order)} {s}:{k} ({len(rs)} recordings) -> {len(specs)} sessions")
    write_json(os.path.join(VSESS, "streams", "vsess.json"), specs)
    log(f"vsess: {len(specs)} sessions, {len(specs) * S.LEN / 3600:.1f} h; forced timelines {sum(x['meta']['forced'] for x in specs)}; "
        f"sources {dict(collections.Counter(x['meta']['source'] for x in specs))}")


if __name__ == "__main__":
    main()
