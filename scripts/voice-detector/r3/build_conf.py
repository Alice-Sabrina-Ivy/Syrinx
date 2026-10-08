# build_conf.py — custom voice detector, round 3 (pre-registration §1.5, §2):
# the CONFIRMATORY stream specs, from the prepared confirmatory files
# (conf/manifest.jsonl; kept records only). valdump.mjs runs the app's
# production chain over them (--val=build/vad-train/r3/conf).
#
#   base   cvoice  clean voice, fresh: every kept recording at its native rate
#                  (c_ls: the 10 utterances per speaker in FNV order; the rest of
#                  the chapter is used only in the sessions); reference = the
#                  gated Praat track (prepare_conf.py)
#          cneg    every kept NA and NB noise stream (16 kHz, <= 90 s)
#   mix    cmix20 / cmix0  each noise stream x 2 voice programs, subsets rotating
#                  over speech, held, breathy, trills, humming, sirens in a
#                  seeded order (seed 20261012); a program = one recording (its
#                  first 30 s) or one source group's recordings of that subset
#                  (FNV order, cycling when the group has less) joined with
#                  0.5 s gaps to >= 20 s; valsets.py mix conventions (voice active
#                  RMS 0.1, SNR over the stream, +10 / 0 dB, 20 s noise lead and
#                  5 s tail; cmix0 = the same mix read from the voice start)
#   sess   csess   one-room sessions (sessions.py): 1 clean + 2 noisy per voice
#                  source group, groups in FNV order within each source, the
#                  sources in turn, until 160 sessions; beds = NA and NB streams in
#                  a seeded shuffled order (seed 20261011)
#
#   python scripts/voice-detector/r3/build_conf.py base|mix|sess
import collections
import json
import os
import sys

import numpy as np

from c3 import CAUDIO, CONF, CManifest, anon, args, fnv1a, log, write_json
import sessions as S

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "train"))
A = args()
SUBSETS = ["speech", "held", "breathy", "trills", "humming", "sirens"]
LEAD, TAIL = 20.0, 5.0
SR = 16000


def ref_of(r):
    return {"path": os.path.join(CONF, r["ref"]["path"]), "t0": r["ref"]["t0"], "hop": r["ref"]["hop"]}


def vmeta(r):
    return {k: r.get(k) for k in ("source", "subset", "group", "session_group", "licence", "f0_median", "voiced_sec") if r.get(k) is not None}


def read16(r):
    import soundfile as sf     # (data step: tcommon.read_wav refuses the sealed set, by design)
    x, sr = sf.read(os.path.join(CAUDIO, r["path16"]), dtype="float32", always_2d=True)
    x = x[:, 0]
    assert sr == SR
    return x.astype(np.float64)


def base():
    import soundfile as sf
    man = CManifest()
    kept = sorted(man.kept(), key=lambda r: r["id"])
    cv = []
    for r in kept:
        if r["kind"] != "voice" or (r["source"] == "c_ls" and not r.get("fresh")):
            continue
        p = os.path.join(CAUDIO, r["path"])
        info = sf.info(p)
        assert info.samplerate == r["sr"]
        cv.append({"id": r["id"], "gender": r["gender"] if r["gender"] in ("f", "m") else "unknown",
                   "audio": {"path": p, "fmt": "wav", "sr": int(info.samplerate), "start": 0, "len": int(info.frames)},
                   "ref": {"kind": "praat", **ref_of(r)}, "holds": [], "meta": dict(vmeta(r), set="cvoice")})
    write_json(os.path.join(CONF, "streams", "cvoice.json"), cv)
    cn = []
    for r in kept:
        if r["kind"] != "noise":
            continue
        p = os.path.join(CAUDIO, r["path16"])
        info = sf.info(p)
        cn.append({"id": r["id"], "gender": "na", "audio": {"path": p, "fmt": "wav", "sr": SR, "start": 0, "len": int(info.frames)},
                   "ref": {"kind": "none"}, "holds": [],
                   "meta": {"source": r["source"], "ngroup": r["ngroup"], "cls": r.get("cls"), "group": r["group"], "licence": r["licence"]}})
    write_json(os.path.join(CONF, "streams", "cneg.json"), cn)
    log(f"cvoice {len(cv)} streams, {sum(v['audio']['len'] / v['audio']['sr'] for v in cv) / 3600:.2f} h; "
        f"{dict(collections.Counter((v['meta']['subset'], v['gender']) for v in cv))}")
    log(f"cneg {len(cn)} streams, {sum(v['audio']['len'] / SR for v in cn) / 3600:.2f} h; {dict(collections.Counter(v['meta']['ngroup'] for v in cn))}")


def programs(kept):
    """subset -> list of programs {name, items [(rec, from, len)], gender, subset}."""
    P = collections.defaultdict(list)
    by = collections.defaultdict(list)
    for r in kept:
        if r["kind"] == "voice" and r["subset"] in SUBSETS:
            by[(r["subset"], r["group"])].append(r)
    for (sub, g), rs in sorted(by.items(), key=lambda t: (t[0][0], fnv1a(t[0][1]), t[0][1])):
        rs = sorted(rs, key=lambda r: (fnv1a(r["id"]), r["id"]))
        gender = collections.Counter(r["gender"] for r in rs).most_common(1)[0][0]
        gender = gender if gender in ("f", "m") else "unknown"
        short = []
        for r in rs:
            if r["dur"] >= 20.0:
                P[sub].append({"name": r["id"], "items": [(r, 0.0, min(30.0, r["dur"]))], "gender": gender, "subset": sub})
            else:
                short.append(r)
        if short:
            items, t, k = [], 0.0, 0
            total = sum(r["dur"] for r in short)
            while True:
                r = short[k % len(short)]
                k += 1
                items.append((r, 0.0, r["dur"]))
                t += r["dur"] + 0.5
                if t >= 20.0:
                    P[sub].append({"name": f"{anon(g).replace(':', '_')}__{sub}__{len(P[sub])}", "items": items, "gender": gender, "subset": sub,
                                   "cycled": k > len(short)})
                    items, t = [], 0.0
                    if k >= len(short):
                        break
            if total < 20.0 and not items:
                pass
    return P


def render_prog(pg, cache):
    layers, t = [], 0.0
    fade = int(0.01 * SR)
    for r, fr, ln in pg["items"]:
        if r["id"] not in cache:
            cache[r["id"]] = read16(r)
        x = cache[r["id"]]
        seg = x[int(round(fr * SR)):int(round((fr + ln) * SR))]
        e = np.minimum(np.minimum(1.0, (np.arange(len(seg)) + 1) / fade), (len(seg) - np.arange(len(seg))) / fade)
        layers.append({"at": round(t, 4), "from": fr, "len": len(seg) / SR, "rec": r, "x": seg * e})
        t += len(seg) / SR + 0.5
    dur = t - 0.5
    y = np.zeros(int(round(dur * SR)) + 1)
    for L in layers:
        a = int(round(L["at"] * SR))
        y[a:a + len(L["x"])] += L["x"]
    return y, layers, dur


def mix():
    import soundfile as sf
    man = CManifest()
    kept = sorted(man.kept(), key=lambda r: r["id"])
    noises = sorted([r for r in kept if r["kind"] == "noise"], key=lambda r: r["id"])
    P = programs(kept)
    rng = np.random.default_rng(20261012)
    perm = [SUBSETS[i] for i in rng.permutation(len(SUBSETS))]
    for s in SUBSETS:
        rng.shuffle(P[s])
    log("programs:", {s: len(P[s]) for s in SUBSETS}, "rotation:", perm)
    idx = collections.Counter()
    m20, m0, cache = [], [], {}
    for i, nz in enumerate(noises):
        xn = read16(nz)
        for j in range(2):
            sub = perm[(2 * i + j) % len(perm)]
            if not P[sub]:
                log("no program for subset", sub)
                continue
            pg = P[sub][idx[sub] % len(P[sub])]
            idx[sub] += 1
            y, layers, pdur = render_prog(pg, cache)
            vg = 0.1 / max(S.active_rms(y), 1e-9)
            n = int(round((LEAD + pdur + TAIL) * SR))
            noise = xn[np.arange(n) % len(xn)]
            nrms = float(np.sqrt(np.mean(np.square(noise))))
            for snr in (10, 0):
                ng = 0.1 / (10 ** (snr / 20)) / max(nrms, 1e-12)
                mx = ng * noise
                a = int(round(LEAD * SR))
                mx[a:a + len(y)] += vg * y[:max(0, n - a)]
                pk = np.max(np.abs(mx))
                sc = 1.0 if pk <= 0.999 else 0.999 / pk
                mid = f"cmix__{nz['id']}__{pg['name']}__snr{snr:+d}"
                p = os.path.join(CAUDIO, "mix", mid + ".wav")
                if not os.path.exists(p):
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    sf.write(p, (mx * sc).astype(np.float32), SR, subtype="PCM_16")
                lay = [{"at": round(LEAD + L["at"], 4), "len": L["len"], "from": L["from"], "ref": ref_of(L["rec"])} for L in layers]
                lmeta = [{"rec": L["rec"]["id"], "subset": L["rec"]["subset"], "gender": L["rec"]["gender"]} for L in layers]
                meta = {"snr_db": snr, "voice": pg["name"], "voice_subset": sub, "noise_id": nz["id"], "ngroup": nz["ngroup"], "noise_source": nz["source"],
                        "noise_cls": nz.get("cls"), "gain_scale": sc, "layers": lmeta, "program_cycled": pg.get("cycled", False)}
                holds = [[round(L["at"], 3), round(L["at"] + L["len"], 3)] for L in layers] if sub == "held" else []
                bs = {"gender": pg["gender"], "ref": {"kind": "mix", "layers": lay}}
                m20.append({"id": mid, **bs, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": 0, "len": n}, "crop": 0.0,
                            "holds": [[h[0] + LEAD, h[1] + LEAD] for h in holds], "meta": dict(meta, lead=20, voice_t0=LEAD, voice_t1=LEAD + pdur)})
                c0 = int(round(LEAD * SR))
                m0.append({"id": mid, **bs, "audio": {"path": p, "fmt": "wav", "sr": SR, "start": c0, "len": n - c0}, "crop": c0 / SR,
                           "holds": holds, "meta": dict(meta, lead=0, voice_t0=0.0, voice_t1=pdur)})
        if i % 25 == 0:
            log(f"  mixes: {i + 1}/{len(noises)} noise streams")
    write_json(os.path.join(CONF, "streams", "cmix20.json"), m20)
    write_json(os.path.join(CONF, "streams", "cmix0.json"), m0)
    log(f"cmix20 / cmix0: {len(m20)} each, {sum(m['audio']['len'] for m in m20) / SR / 3600:.2f} h / {sum(m['audio']['len'] for m in m0) / SR / 3600:.2f} h; "
        f"programs used {dict(idx)}; genders {dict(collections.Counter(m['gender'] for m in m20))}")


def sess():
    import soundfile as sf
    man = CManifest()
    kept = sorted(man.kept(), key=lambda r: r["id"])
    G = collections.defaultdict(list)
    for r in kept:
        if r["kind"] == "voice":
            G[(r["source"], r["session_group"])].append(r)
    for k, rs in G.items():
        rs.sort(key=(lambda r: r["id"]) if k[0] == "c_ls" else (lambda r: (fnv1a(r["id"]), r["id"])))
    by_src = collections.defaultdict(list)
    for (s, g) in G:
        by_src[s].append(g)
    for s in by_src:
        by_src[s].sort(key=lambda g: (fnv1a(g), g))
    order, i, srcs = [], 0, sorted(by_src)
    while len(order) * 3 < 160 and any(by_src.values()):
        s = srcs[i % len(srcs)]
        i += 1
        if by_src[s]:
            order.append((s, by_src[s].pop(0)))
    beds = sorted([r for r in kept if r["kind"] == "noise"], key=lambda r: r["id"])
    rng = np.random.default_rng(20261011)
    rng.shuffle(beds)
    specs, nk = [], 0
    for gi, (s, g) in enumerate(order):
        rs = G[(s, g)]
        recs = [{"dur": float(r["dur"])} for r in rs]
        audio = [read16(r) for r in rs]
        for kind in ("clean", "noisy", "noisy"):
            if len(specs) >= 160:
                break
            seed = 20261011 * 1000 + len(specs)
            pl, stretches, info = S.timeline(recs, seed)
            bed = snr = None
            bmeta = {}
            if kind == "noisy":
                snr = 10 if nk % 2 == 0 else 0
                b = beds[nk % len(beds)]
                nk += 1
                bed = read16(b)
                bmeta = {"bed": b["id"], "bed_ngroup": b["ngroup"], "bed_source": b["source"], "bed_cls": b.get("cls")}
            mx, vg, ng, sc, lev = S.render(recs, audio, pl, seed, bed, snr)
            sid = f"csess__{anon(g).replace(':', '_')}__{'clean' if kind == 'clean' else f'snr{snr:+d}'}"
            p = os.path.join(CAUDIO, "sess", sid + ".wav")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            sf.write(p, mx, SR, subtype="PCM_16")
            layers = [{"at": q["at"], "len": q["len"], "from": q["from"], "ref": ref_of(rs[q["rec"]])} for q in pl]
            lmeta = [{"rec": rs[q["rec"]]["id"], "subset": rs[q["rec"]]["subset"], "gender": rs[q["rec"]]["gender"], "at": q["at"], "len": q["len"], "from": q["from"]}
                     for q in pl]
            gg = collections.Counter(x["gender"] for x in lmeta).most_common(1)[0][0]
            specs.append({"id": sid, "gender": gg if gg in ("f", "m") else "unknown", "audio": {"path": p, "fmt": "wav", "sr": SR, "start": 0, "len": len(mx)},
                          "ref": {"kind": "mix", "layers": layers}, "holds": [],
                          "meta": {"side": "confirmatory", "kind": kind, "snr_db": snr, "source": s, "vgroup": anon(g), "stretches": stretches, "layers": lmeta,
                                   "voice_gain": vg, "noise_gain": ng, "gain_scale": sc, "voice_level_db": round(lev, 2), "seed": seed, **info, **bmeta}})
        log(f"  {gi + 1}/{len(order)} {anon(g)} ({len(rs)} recordings) -> {len(specs)} sessions")
    write_json(os.path.join(CONF, "streams", "csess.json"), specs)
    log(f"csess: {len(specs)} sessions, {len(specs) * S.LEN / 3600:.1f} h; forced {sum(x['meta']['forced'] for x in specs)}; "
        f"sources {dict(collections.Counter(x['meta']['source'] for x in specs))}")


if __name__ == "__main__":
    {"base": base, "mix": mix, "sess": sess}[sys.argv[1]]()
