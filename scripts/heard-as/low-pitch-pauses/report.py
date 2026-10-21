"""report.py -- markdown tables of measurements/heard-as-low-pitch-and-pauses-2026-10-21.md
from analyze.mjs's streams.<variant>.json.

  python report.py <streams.shipped.json> [--split=all|dev|test]
"""
import json, sys
import numpy as np

path = sys.argv[1]
split = next((a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("--split=")), "all")
rows = json.load(open(path))
if split != "all":
    rows = [r for r in rows if r["split"] == split]
SEX = {"f": "W", "m": "M"}


def med(v):
    v = [x for x in v if x is not None]
    return float(np.median(v)) if v else float("nan")


def tmed(rs, key):
    """median time, streams that never reach it count as +inf; '>span' when the median is inf"""
    v = [r[key] if r[key] is not None else np.inf for r in rs]
    m = float(np.median(v)) if v else float("nan")
    never = sum(1 for r in rs if r[key] is None)
    return ("never" if not np.isfinite(m) else f"{m:.1f}"), never


def pct(x):
    return f"{100 * x:.1f}"


def reasons(rs):
    tot = {}
    n = 0
    for r in rs:
        for k, c in r["reasons"].items():
            tot[k] = tot.get(k, 0) + c
        n += r["nVis"]
    return {k: c / n for k, c in tot.items()}, n


def panel_table(groups, title):
    print(f"\n### {title}\n")
    print("| group | sex | n | first reading s (median; never) | informative s (median; never) | shown % | informative % | can't tell % | hidden: short-voiced % | short-windows % | short-no-logit % | outside-lowF0 % | stale % | listening % | sustained % |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx]
            if not rs:
                continue
            tf, nf = tmed(rs, "tFirst")
            ti, ni = tmed(rs, "tInf")
            R, _ = reasons(rs)
            g = lambda k: pct(R.get(k, 0))
            print(f"| {name} | {SEX[sx]} | {len(rs)} | {tf} ({nf}) | {ti} ({ni}) | {pct(np.mean([r['shareShown'] for r in rs]))} | {pct(np.mean([r['shareInf'] for r in rs]))} | {g('shown:wide')} | {g('short:voiced')} | {g('short:windows')} | {g('short:noLogit')} | {g('outside:lowF0')} | {g('stale')} | {g('listening')} | {g('sustained')} |")


def gate_table(groups, title):
    print(f"\n### {title}\n")
    keys = ["score", "pause:floor", "warming:postOnset", "warming:steady", "pause:recency", "pause:share", "pause:voicing", "silent", "sustained", "stale"]
    print("| group | sex | speech windows | " + " | ".join(keys) + " | spans / min speech | scored windows mostly in a pause % | classified w/o logit (<200 ms voiced) % | Silero hangover ms (median) |")
    print("|---|---|---|" + "---|" * len(keys) + "---|---|---|---|")
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx]
            if not rs:
                continue
            tot = {}
            n = sum(r["nSpeechTicks"] for r in rs)
            for r in rs:
                for k, c in r["verdicts"].items():
                    tot[k] = tot.get(k, 0) + c
            spm = sum(r["spans"] for r in rs) / (sum(r["speechS"] for r in rs) / 60)
            mp = sum(r["scoredMostlyPause"] for r in rs) / max(1, sum(r["scored"] for r in rs))
            nq = sum(r["classifiedNoLogit"] for r in rs) / max(1, sum(r["classified"] for r in rs))
            print(f"| {name} | {SEX[sx]} | {n} | " + " | ".join(pct(tot.get(k, 0) / max(n, 1)) for k in keys) + f" | {spm:.1f} | {pct(mp)} | {pct(nq)} | {med([r['hangoverMs'] for r in rs]):.0f} |")


def block_table(groups, title):
    """updates before the first reading: what the 8 s pool held"""
    print(f"\n### {title}\n")
    print("| group | sex | hidden updates before the first reading | failing rule: voiced < 3 s % | windows < 10 % | no qualifying logit % | median voiced in scored spans s | median posted voiced in last 8 s s | median speech in last 8 s s |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx]
            if not rs:
                continue
            U = []
            for r in rs:
                for u in r["updates"]:
                    if u["shown"]:
                        break
                    if u["t"] >= 2000 and u["reason"].startswith("short"):
                        U.append(u)
            if not U:
                continue
            c = lambda k: pct(sum(1 for u in U if u["reason"] == k) / len(U))
            print(f"| {name} | {SEX[sx]} | {len(U)} | {c('short:voiced')} | {c('short:windows')} | {c('short:noLogit')} | {med([u['vMs'] / 1000 for u in U]):.2f} | {med([u['pv8'] / 1000 for u in U]):.2f} | {med([u['sp8'] / 1000 for u in U]):.2f} |")


def steady_table(groups, title):
    """after the first reading: hides by reason (the pool emptying in pauses)"""
    print(f"\n### {title}\n")
    print("| group | sex | updates after the first reading | shown % | hidden short-voiced % | short-windows % | stale % | other hidden % | median voiced in pool at shown updates s |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx]
            U = []
            for r in rs:
                seen = False
                for u in r["updates"]:
                    if u["shown"]:
                        seen = True
                    if seen and u["t"] <= (r["spanS"] - 1) * 1000:
                        U.append(u)
            if not U:
                continue
            c = lambda pred: pct(sum(1 for u in U if pred(u)) / len(U))
            print(f"| {name} | {SEX[sx]} | {len(U)} | {c(lambda u: u['shown'])} | {c(lambda u: u['reason'] == 'short:voiced')} | {c(lambda u: u['reason'] == 'short:windows')} | {c(lambda u: u['reason'] == 'stale')} | {c(lambda u: not u['shown'] and u['reason'] not in ('short:voiced', 'short:windows', 'stale'))} | {med([u['vMs'] / 1000 for u in U if u['shown']]):.2f} |")


def wide_table(groups, title):
    print(f"\n### {title}\n")
    print("| group | sex | n | settled reading wide (streams) | settled outside range | can't-tell share of shown time % | of which settled-wide (the voice) % | of which settled-informative (pooling) % | median \\|eta\\| settled | median meter logit settled | median F0 settled Hz |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx]
            if not rs:
                continue
            st = [r["settled"] for r in rs if r["settled"]]
            shown = sum(r["reasons"].get("shown:wide", 0) + r["reasons"].get("shown:informative", 0) for r in rs)
            wide = sum(r["reasons"].get("shown:wide", 0) for r in rs)
            wv = sum(r["wideVoice"] for r in rs)
            wp = sum(r["widePool"] for r in rs)
            print(f"| {name} | {SEX[sx]} | {len(rs)} | {sum(1 for s in st if s['wide'])} | {sum(1 for s in st if s['outside'])} | {pct(wide / max(shown, 1))} | {pct(wv / max(wide, 1))} | {pct(wp / max(wide, 1))} | {med([abs(s['eta']) for s in st]):.2f} | {med([s['meterLogit'] for s in st]):.2f} | {med([s['f0'] for s in st]):.0f} |")


def stage_table(groups, title):
    print(f"\n### {title}\n")
    print("| group | sex | reference F0 band | frames | posted % | tracker unvoiced % | ghost veto % | above 400 % | harmonic guard % |")
    print("|---|---|---|---|---|---|---|---|---|")
    order = ["<75", "75-81", "81-90", "90-100", "100-160", "160-230", ">=230"]
    for name, rs0 in groups:
        for sx in ("f", "m"):
            rs = [r for r in rs0 if r["sex"] == sx and r.get("pitchStages")]
            tot = {}
            for r in rs:
                for b, d in r["pitchStages"].items():
                    for k, c in d.items():
                        tot.setdefault(b, {})[k] = tot.setdefault(b, {}).get(k, 0) + c
            for b in order:
                if b not in tot:
                    continue
                d = tot[b]
                n = sum(d.values())
                if n < 200:
                    continue
                g = lambda k: pct(d.get(k, 0) / n)
                print(f"| {name} | {SEX[sx]} | {b} | {n} | {g('posted')} | {g('tracker')} | {g('ghost')} | {g('above400')} | {g('guard')} |")


def sel(**kw):
    return [r for r in rows if all(r.get(k) == v for k, v in kw.items())]


print(f"# streams: {len(rows)} (split {split})")
P = ["p0", "p0.3", "p0.6", "p1.0", "p1.5", "p2.5", "pnat"]
pause_groups = [(f"LibriSpeech {p}", sel(family="libri", voice="nat", pause=p)) for p in P]
panel_table(pause_groups, "B1 Pauses: the panel on natural LibriSpeech reading")
gate_table(pause_groups, "B2 Pauses: utterance-gate verdicts on speech windows (window >= 50 % speech)")
block_table(pause_groups, "B3 Pauses: what blocks the first reading (hidden 'short' updates before it)")
steady_table(pause_groups, "B4 Pauses: after the first reading")
wide_table(pause_groups, "B5 Pauses: why a reading is 'can't tell yet'")

low_groups = [("WORLD 75 Hz, continuous", sel(voice="w75", pause="p0")), ("WORLD 75 Hz, pauses", sel(voice="w75", pause="pnat")),
              ("WORLD 90 Hz, continuous", sel(voice="w90", pause="p0")), ("WORLD 90 Hz, pauses", sel(voice="w90", pause="pnat")),
              ("WORLD own F0 (control), pauses", sel(voice="w1", pause="pnat")),
              ("PTDB-TUG", sel(set="ptdb")), ("FDA", sel(set="fda")), ("Hillenbrand /hVd/", sel(set="hil"))]
panel_table(low_groups, "A1 Low pitch: the panel")
gate_table(low_groups, "A2 Low pitch: utterance-gate verdicts on speech windows")
stage_table(low_groups, "A3 Low pitch: pitch-worker stage of reference-voiced frames, by reference F0")
lo_upd = []
print("\n### A4 Low pitch: posted-F0 median of the pool at hidden 'outside' / shown updates\n")
print("| group | sex | updates with an aggregate | outside:lowF0 % | median pooled F0 Hz | pooled F0 < 81 Hz % |")
print("|---|---|---|---|---|---|")
for name, rs0 in low_groups:
    for sx in ("f", "m"):
        U = [u for r in rs0 if r["sex"] == sx for u in r["updates"] if u.get("f0")]
        if not U:
            continue
        print(f"| {name} | {SEX[sx]} | {len(U)} | {pct(sum(1 for u in U if u['reason'] == 'outside:lowF0') / len(U))} | {med([u['f0'] for u in U]):.1f} | {pct(sum(1 for u in U if u['f0'] < 81) / len(U))} |")

fem_groups = [("women, natural, pauses", sel(family="libri", voice="nat", pause="pnat", sex="f")),
              ("women, natural, continuous", sel(family="libri", voice="nat", pause="p0", sex="f")),
              ("WORLD own F0 (control), pauses", sel(voice="w1", pause="pnat")),
              ("WORLD 185 Hz, pauses", sel(voice="w185", pause="pnat")),
              ("WORLD 185 Hz, continuous", sel(voice="w185", pause="p0"))]
panel_table(fem_groups, "C1 Feminine-voice speech: the panel")
wide_table(fem_groups, "C2 Feminine-voice speech: why a reading is 'can't tell yet'")
