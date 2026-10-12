# htable_r5.py — custom voice detector, round 5: Markdown tables of the H rows
# (H1 cells, H2 per cell: worst bin / first / last, H3 medium row) from
# opselect_r5.py --point JSON files, per sex. Reporting only.
#
#   python htable_r5.py NAME=FILE.json [NAME=FILE.json ...]
import json
import sys

COND = ["clean", "snr+20", "snr+10", "snr+0"]
LIM = {"clean": 0.5, "snr+20": 1.5, "snr+10": 1.5, "snr+0": 1.5}


def f(v):
    return "—" if v is None else f"{v:.2f}"


def main():
    runs = [a.split("=", 1) for a in sys.argv[1:]]
    D = {n: json.load(open(p, encoding="utf8")) for n, p in runs}
    print("**H1** (veto % of in-band CORRECT hops; limit 0.5 clean / 1.5 bed; ✗ = over the limit)\n")
    print("| cell | " + " | ".join(n for n, _ in runs) + " |")
    print("|---|" + "---|" * len(runs))
    for sx in ("m", "f"):
        for vk in ("real", "syn_vowel", "syn_hum"):
            for c in COND:
                k = f"h1|{sx}|{c}|{vk}"
                vals = []
                for n, _ in runs:
                    v = D[n]["h"]["cells"].get(k, [None])[0]
                    vals.append(f(v) + (" ✗" if v is not None and v > LIM[c] else ""))
                print(f"| {'men' if sx == 'm' else 'women'} {vk} {c} | " + " | ".join(vals) + " |")
    print("\n**H2** (every CORRECT hop; worst 10-s bin / first 10 s / last 10 s, veto %; ✗ = a bin over the limit or last > first + 1 pp)\n")
    print("| cell | " + " | ".join(n for n, _ in runs) + " |")
    print("|---|" + "---|" * len(runs))
    for sx in ("m", "f"):
        for kind in ("syn", "real"):
            for c in COND:
                if kind == "real" and c == "snr+20":
                    continue
                pre = f"h2|{sx}|{c}|{kind}|"
                vals = []
                for n, _ in runs:
                    cells = {k[len(pre):]: v for k, v in D[n]["h"]["cells"].items() if k.startswith(pre)}
                    worst = max((v[0] for b, v in cells.items() if v[0] is not None and v[1] >= 400), default=None)
                    first = cells.get("bin0", [None])[0]
                    last = cells.get("last", [None])[0]
                    bad = any(x.startswith(pre) for x in D[n]["h"]["fail"])
                    vals.append(f"{f(worst)} / {f(first)} / {f(last)}" + (" ✗" if bad else ""))
                print(f"| {'men' if sx == 'm' else 'women'} {kind} {c} | " + " | ".join(vals) + " |")
    print("\n**H3** (reported; one-room validation sessions, speech rows, veto %)\n")
    print("| row | " + " | ".join(n for n, _ in runs) + " |")
    print("|---|" + "---|" * len(runs))
    for sx in ("m", "f"):
        for c in ("clean", "+10 dB", "+0 dB"):
            k = f"MEDIUM speech rows|{sx}|{c}"
            print(f"| speech, {'men' if sx == 'm' else 'women'}, {c} | " + " | ".join(f(D[n]["h3"].get(k, [None])[0]) for n, _ in runs) + " |")
    print("\n" + " · ".join(f"{n}: H feasible {D[n]['h']['feasible']}, fails {len(D[n]['h']['fail'])}, round-4 rows feasible {D[n].get('r3', {}).get('feasible')}, O {D[n].get('r3', {}).get('O', float('nan')):.2f}" for n, _ in runs))


if __name__ == "__main__":
    main()
