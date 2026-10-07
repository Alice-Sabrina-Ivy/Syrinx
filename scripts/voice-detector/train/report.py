# report.py — custom voice detector (2026-10-06): markdown tables for the
# measurement note: training curves (train.py log.jsonl: frame metrics on the
# fixed validation batches every 1000 steps) and the selection table
# (opselect.py JSON: each model's pre-registered pick on the selection data).
#
#   python report.py --runs=r1-base,r2-big,... --sel=a.json,b.json [--train=build/vad-train/train]
import json
import os
import sys

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TRAIN = A.get("train", "build/vad-train/train")


def curves(runs):
    print("### Training curves (fixed val batches: frame AUC / TPR at 10 % FPR / TNR at 99 % TPR / mean p on noise crops)\n")
    for r in runs:
        p = os.path.join(TRAIN, "runs", r, "log.jsonl")
        if not os.path.exists(p):
            continue
        cfg = json.load(open(os.path.join(TRAIN, "runs", r, "config.json")))
        print(f"**{r}** ({cfg['params']:,} parameters; cfg {json.dumps(cfg['cfg'])}; args "
              f"{json.dumps({k: v for k, v in cfg['args'].items() if k != 'name'})})\n")
        print("| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |")
        print("|---|---|---|---|---|---|---|---|")
        recs = [json.loads(line) for line in open(p, encoding="utf8") if line.strip()]
        live = {x["step"]: x for x in recs if not x.get("ema")}
        ema = {x["step"]: x for x in recs if x.get("ema")}
        for s in sorted(live):
            x, e = live[s], ema.get(s, {})
            print(f"| {s} | {x['loss']:.4f} | {x['auc']:.4f} | {x['tpr@fpr10']:.4f} | {x['tnr@tpr99']:.4f} | {x['noise_p_mean']:.4f} | "
                  f"{e.get('auc', float('nan')):.4f} | {e.get('tnr@tpr99', float('nan')):.4f} |")
        print()


def selection(files):
    print("### Selection table (pre-registered rule; feasible = clean val groups <= 0.5 %, val mix cells <= 1.5 %, worse gender)\n")
    print("| model | pick: agg / thr / hangover | tune-194 V2 % (objective) | clean speech / vowels / singing % | mix +10 20 s / 0 20 s / +10 lead 0 / 0 lead 0 % | onset median ms | val negatives V2 % |")
    print("|---|---|---|---|---|---|---|")
    rows = []
    for f in files:
        for name, v in json.load(open(f, encoding="utf8")).items():
            rows.append((name, v["best"]))
    for name, b in rows:
        if not b:
            print(f"| {name} | no feasible point | | | | | |")
            continue
        print(f"| {name} | {b['agg']} / {b['thr']} / {b['hang']:.0f} ms | {b['tune194_v2']:.2f} | "
              f"{b.get('clean speech', 0):.2f} / {b.get('clean vowels', 0):.2f} / {b.get('clean singing', 0):.2f} | "
              f"{b.get('mix vmix20 +10', 0):.2f} / {b.get('mix vmix20 +0', 0):.2f} / {b.get('mix vmix0 +10', 0):.2f} / {b.get('mix vmix0 +0', 0):.2f} | "
              f"{b['onset_median_worst']:.0f} | {b['vneg_v2']:.2f} |")
    print()


if __name__ == "__main__":
    if A.get("runs"):
        curves(A["runs"].split(","))
    if A.get("sel"):
        selection(A["sel"].split(","))
