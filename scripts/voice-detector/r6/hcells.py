# hcells.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.4-2.10):
# the gating cells / bins / sub-bands of the new rows H4-H8 and of the review
# probe streams, as hop selections of a current-app dump. Fixed here BEFORE
# any model scores these rows; the Data step uses it for the size rules (CORRECT
# hops per cell and sex), the selection scorer (r6/opselect_r6.py) for the veto
# shares. A cell's veto share = CORRECT hops vetoed / CORRECT hops in the cell.
#
# Hop time td_k = (k + 1)·hop − 40 ms − L·hop − 30 ms (as dump.mjs / r5 hval).
# Masks (meta.mask: the old harness's VocalSet long tones and takes removed by
# the §1.2 item 5 check) are applied to every cell: masked hops are never read.
#
# Cell keys (sex = the stream's gender; cond = clean / snr+10 / snr+0 for the new
# rows, the review's own (bed, SNR) for the probe streams):
#   H4  h4|sx|cond|src             src = real / vsynth / lfsynth; CORRECT hops whose reference F0 is in the sex's band
#       s1|sx|snr                   S1 per SNR (0 / 10 / 20 / clean); band as above
#       s1b|sx|variant              S1b per microphone variant (phone, phone2agc, 16k); band
#       h4kind|sx|kind              each machine kind, 0 and +10 dB pooled over the new H4 streams and S1; band
#                                   (kind = synthetic generator kind, or the real clip's id); its class: h4cls|sx|class
#       h4low|sx                    0 dB, pooled over the new H4 streams and S1; reference F0 in men 75-100 / women 160-200 Hz
#   H5  h5|sx|cond|src|binB         10-s bins of t = td − hold (series) onset; binlast = the hold's last 10 s; no band filter
#       s4|sx|mic|cond|binB, s2|sx|mic|cond|binB   the review's S4 / S2 per microphone variant x condition
#   H6a h6a|sx|cond|exercise        synthesizers pooled; s3|sx|cond (the review's six S3 conditions)
#   H6b h6b|sx|cond|binB            series time (onset of the first hold); s2b|sx|cond|binB
#   H6c h6c|sx|cond|whole, h6c|sx|cond|minM (60-s bins of session time), h6c|sx|cond|first120 (td in [30, 150) s),
#       h6c|sx|cond|last120 (the last 120 s before the end of the session's last voice episode); real and synthetic pooled
#   H7  h7a|set|sx|cond             every hop of the VocalSet lip-trill takes (set = sess3 / sess5)
#       h7b|sx|cond                 the H6a lip-trill streams and the H6c lip-trill episodes (synthetic)
#   H8  h8|sx|snrS|period           period: before (td < switch-on), on (switch-on <= td < switch-off or end),
#                                   on60 (the first 60 s after switch-on), after (td >= switch-off)
#   Reported only (never gating, never grown): keys starting with "rep_".
import numpy as np

BANDS = {"m": (75.0, 130.0), "f": (160.0, 300.0)}
LOWB = {"m": (75.0, 100.0), "f": (160.0, 200.0)}
MIN_HOPS = 400
GROW_STEP = {"h4": 8, "h5": 4, "h6a": 4, "h6b": 4, "h6c": 2}
# classes of the review's S1 machines (for the "machine kind under 400 merges into its class" rule)
S1_CLASS = {"twofan": "buzz", "aqpump": "buzz", "microwave": "buzz", "washer": "buzz", "ballast": "buzz", "caridle": "motor",
            "144046": "buzz", "830089": "buzz", "201788": "buzz", "848181": "buzz", "530917": "fridge", "785127": "air"}


def td_of(m):
    k = np.arange(m["n"])
    return (k + 1) * m["hop_s"] - 0.040 - m["L"] * m["hop_s"] - 0.030


def unmasked(s, td):
    sel = np.ones(len(td), bool)
    for a, b in s["meta"].get("mask", []):
        sel &= ~((td >= a) & (td <= b))
    return sel


def band(refd, sx, b=BANDS):
    lo, hi = b[sx]
    return (refd >= lo) & (refd <= hi)


def bins10(t, dur):
    """(label, selection) of 10-s bins of t in [0, dur]: bins 0 .. nb-2 regular, binlast = the last 10 s (r5 hval cells)."""
    nb = int(np.ceil(dur / 10.0 - 1e-9))
    for b in range(nb):
        if b < nb - 1:
            yield f"bin{b}", (t >= b * 10.0) & (t < (b + 1) * 10.0)
        else:
            yield "binlast", (t >= dur - 10.0) & (t <= dur)


def in_eps(td, eps):
    sel = np.zeros(len(td), bool)
    for e in eps:
        sel |= (td >= e["start"]) & (td <= e["start"] + e["dur"])
    return sel


def cells(sset, s, m, col):
    """Yield (cell key, hop selection) of one stream; the caller intersects with CORRECT (lab == 1)."""
    M = s["meta"]
    sx = s["gender"]
    td = td_of(m)
    refd = col["refd"]
    um = unmasked(s, td)
    if sset == "h4":
        cond, src = M["cond"], M["source_kind"]
        inb = band(refd, sx) & um
        yield f"h4|{sx}|{cond}|{src}", inb
        kind = M["bed"]["kind"]
        cls = M["bed"]["cls"]
        yield f"h4kind|{sx}|{kind}", inb
        yield f"h4cls|{sx}|{cls}", inb
        if cond == "snr+0":
            yield f"h4low|{sx}", band(refd, sx, LOWB) & um
        yield f"rep_h4src|{sx}|{cond}|{src}|{M.get('voice_kind')}", inb
    elif sset in ("s1", "s1b"):
        R = M["review_spec"]
        inb = band(refd, sx) & um
        if sset == "s1":
            snr = "clean" if R["bed"] == "clean" else str(R["snr"])
            yield f"s1|{sx}|{snr}", inb
            if R["bed"] != "clean" and R["snr"] in (0, 10):
                yield f"h4kind|{sx}|{R['bed']}", inb
                yield f"h4cls|{sx}|{S1_CLASS[R['bed']]}", inb
            if R["bed"] != "clean" and R["snr"] == 0:
                yield f"h4low|{sx}", band(refd, sx, LOWB) & um
        else:
            variant = "16k" if R["sr"] == 16000 else R["eq"]
            yield f"s1b|{sx}|{variant}", inb
    elif sset == "h5":
        cond, src = M["cond"], M["source_kind"]
        ep = M["episodes"][0]
        t = td - ep["start"]
        for lab, sel in bins10(t, ep["dur"]):
            yield f"h5|{sx}|{cond}|{src}|{lab}", sel & um
        if sx == "m" and src != "real" and M["synth"]["f0"] < 100.0:
            for lab, sel in bins10(t, ep["dur"]):
                yield f"rep_h5low|{sx}|{cond}|{src}|{lab}", sel & um
    elif sset in ("s4", "s2", "s2b"):
        R = M["review_spec"]
        cond = "clean" if R["bed"] == "clean" else f"{R['bed']}@{R['snr']}"
        t0 = R["lead"]
        dur = R["dur"]
        t = td - t0
        for lab, sel in bins10(t, dur):
            if sset == "s2b":
                yield f"s2b|{sx}|{cond}|{lab}", sel & um
            else:
                yield f"{sset}|{sx}|{R['eq']}|{cond}|{lab}", sel & um
    elif sset == "h6a":
        cond, ex = M["cond"], M["exercise"]
        yield f"h6a|{sx}|{cond}|{ex}", um
        if ex == "liptrill":
            yield f"h7b|{sx}|{cond}", um
    elif sset == "s3":
        R = M["review_spec"]
        cond = "clean" if R["bed"] == "clean" else f"{R['bed']}@{R['snr']}"
        yield f"s3|{sx}|{cond}", um
        yield f"rep_s3ex|{sx}|{cond}|{R['ex']}", um
    elif sset == "h6b":
        cond = M["cond"]
        t = td - M["voice_t0"]
        for lab, sel in bins10(t, M["series_dur"]):
            yield f"h6b|{sx}|{cond}|{lab}", sel & um
        for e in M["episodes"]:
            yield f"rep_h6bhold|{sx}|{cond}|hold{e['hold']}", in_eps(td, [e]) & um
    elif sset == "h6c":
        cond = M["cond"]
        yield f"h6c|{sx}|{cond}|whole", um
        for b in range(int(np.ceil(M["session_len"] / 60.0))):
            yield f"h6c|{sx}|{cond}|min{b}", (td >= 60.0 * b) & (td < 60.0 * (b + 1)) & um
        yield f"h6c|{sx}|{cond}|first120", (td >= 30.0) & (td < 150.0) & um
        end = max(e["start"] + e["dur"] for e in M["episodes"])
        yield f"h6c|{sx}|{cond}|last120", (td >= end - 120.0) & (td <= end) & um
        lt = [e for e in M["episodes"] if e["kind"] == "liptrill"]
        if lt:
            yield f"h7b|{sx}|{cond}", in_eps(td, lt) & um
        for kind in sorted({e["kind"] for e in M["episodes"]}):
            yield f"rep_h6ckind|{sx}|{cond}|{kind}", in_eps(td, [e for e in M["episodes"] if e["kind"] == kind]) & um
        yield f"rep_h6csrc|{sx}|{cond}|{M['source_kind']}", um
    elif sset in ("sess5", "sess3"):
        cond = {"clean": "clean", "+10": "snr+10", "0": "snr+0"}[M["cond"]]
        lt = [e for e in M["episodes"] if e["liptrill"]]
        yield f"h7a|{sset}|{sx}|{cond}", in_eps(td, lt) & um
        for tech in sorted({e["tech"] for e in M["episodes"] if not e["liptrill"]}):
            yield f"rep_h7aother|{sset}|{sx}|{cond}|{tech}", in_eps(td, [e for e in M["episodes"] if e["tech"] == tech]) & um
    elif sset == "h8":
        snr = f"snr{M['snr_db']:+d}"
        on = M["switch_on"]
        off = M["switch_off"]
        end = m["n"] * m["hop_s"]
        yield f"h8|{sx}|{snr}|before", (td < on) & um
        yield f"h8|{sx}|{snr}|on", (td >= on) & (td < (off if off is not None else end + 1)) & um
        yield f"h8|{sx}|{snr}|on60", (td >= on) & (td < on + 60.0) & um
        if off is not None:
            yield f"h8|{sx}|{snr}|after", (td >= off) & um
    else:
        raise ValueError(sset)


def merge_bins(C, prefix):
    """The binned cells under `prefix` (…|binB / binlast) with every bin under 400 merged into the bin before it (§2.10), in time
    order; binlast stays separate (it is the hold's own last 10 s). Returns [(labels, hops)]."""
    keys = [k for k in C if k.startswith(prefix + "|bin")]
    regs = sorted((int(k.rsplit("bin", 1)[1]), k) for k in keys if not k.endswith("binlast"))
    out = []
    for _, k in regs:
        if out and C[k] < MIN_HOPS:
            out[-1] = (out[-1][0] + [k.rsplit("|", 1)[1]], out[-1][1] + C[k])
        else:
            out.append(([k.rsplit("|", 1)[1]], C[k]))
    # a merged run that is still under 400 at the front: merge forward into the next one
    while len(out) > 1 and out[0][1] < MIN_HOPS:
        out[1] = (out[0][0] + out[1][0], out[0][1] + out[1][1])
        out.pop(0)
    if prefix + "|binlast" in C:
        out.append((["binlast"], C[prefix + "|binlast"]))
    return out


def size_report(C):
    """Size rules (§2.10): every gating cell / bin / machine kind >= 400 CORRECT hops per sex. Synthetic cells are grown (next seeds);
    real and review-probe cells are not grown and are listed as "cannot be evaluated"; a machine kind under 400 merges into its class
    (a class under 400 is reported only); a time bin under 400 merges with the bin before it."""
    grow, cbe, merged_kinds, merged_bins = set(), [], {}, {}
    gating = {k: v for k, v in C.items() if not k.startswith("rep_")}
    binned = sorted({k.rsplit("|", 1)[0] for k in gating if "|bin" in k})
    for pre in binned:
        mb = merge_bins(gating, pre)
        merged_bins[pre] = [["+".join(lab), n] for lab, n in mb]
        fam = pre.split("|")[0]
        first_ok = mb and mb[0][1] >= MIN_HOPS and "bin0" in mb[0][0]
        last_ok = (pre + "|binlast") in gating and gating[pre + "|binlast"] >= MIN_HOPS
        bad = [lab for lab, n in mb if n < MIN_HOPS]
        if fam == "h5" and pre.split("|")[3] != "real" and (not first_ok or not last_ok):
            grow.add(f"h5|{pre.split('|')[1]}|{pre.split('|')[3]}")
        elif fam == "h6b" and (not first_ok or not last_ok):
            grow |= {f"h6b|{pre.split('|')[1]}|vsynth", f"h6b|{pre.split('|')[1]}|lfsynth"}
        elif bad or not first_ok:
            cbe.append({"cell": pre, "merged_bins": merged_bins[pre], "why": "a bin (after merging) under 400" if bad else "the first bin under 400"})
    for k, n in sorted(gating.items()):
        if "|bin" in k or n >= MIN_HOPS:
            continue
        p = k.split("|")
        fam, sx = p[0], p[1]
        if fam == "h4" and p[3] in ("vsynth", "lfsynth"):
            grow.add(f"h4|{sx}|{p[3]}")
        elif fam == "h4low":
            grow |= {f"h4|{sx}|vsynth", f"h4|{sx}|lfsynth"}
        elif fam == "h4kind":
            merged_kinds[k] = n
        elif fam == "h4cls":
            cbe.append({"cell": k, "hops": n, "why": "machine class under 400: reported only"})
        elif fam == "h6a":
            grow |= {f"h6a|{sx}|vsynth|{p[3]}", f"h6a|{sx}|lfsynth|{p[3]}"}
        elif fam == "h7b":
            grow |= {f"h6a|{sx}|vsynth|liptrill", f"h6a|{sx}|lfsynth|liptrill"}
        elif fam == "h6c" and p[3] in ("whole", "first120", "last120"):
            grow.add(f"h6c|{sx}|syn")
        elif fam == "h6c":
            pass                       # a 60-s bin under 400 merges with the bin before it (evaluation rule)
        else:
            cbe.append({"cell": k, "hops": n, "why": "real or review-probe cell under 400: cannot be evaluated (not grown)"})
    mmin = {}
    for k in gating:
        if k.startswith("h6c|") and "|min" in k:
            pre = k.rsplit("|", 1)[0]
            mmin.setdefault(pre, []).append((int(k.rsplit("min", 1)[1]), gating[k]))
    h6c_minutes = {}
    for pre, lst in mmin.items():
        out = []
        for b, n in sorted(lst):
            if out and n < MIN_HOPS:
                out[-1] = (out[-1][0] + [f"min{b}"], out[-1][1] + n)
            else:
                out.append(([f"min{b}"], n))
        while len(out) > 1 and out[0][1] < MIN_HOPS:
            out[1] = (out[0][0] + out[1][0], out[0][1] + out[1][1])
            out.pop(0)
        h6c_minutes[pre] = [["+".join(lab), n] for lab, n in out]
        if any(n < MIN_HOPS for _, n in out):
            grow.add(f"h6c|{pre.split('|')[1]}|syn")
    return {"grow": sorted(grow), "cannot_be_evaluated": cbe, "machine_kinds_merged_into_class": merged_kinds,
            "merged_bins": merged_bins, "h6c_minute_bins_merged": h6c_minutes}
