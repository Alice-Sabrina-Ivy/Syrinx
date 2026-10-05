import sys, json, glob, os, pandas as pd
pd.set_option("display.width", 250)
cols = ["G_ratio", "auc2", "auc5", "auc5_fold0", "auc5_fold1", "R2", "R2w", "R2_m", "R2_f", "R3", "R3w", "sign", "signw", "R3hi", "signhi",
        "tw_p_m12", "tw_p_f12", "tw_f_m115", "tw_f_f085", "flicker"]
ests = sys.argv[2].split(",") if len(sys.argv) > 2 else ["w1", "post1"]
rows = []
for f in sorted(glob.glob("dev_results/*.json")):
    tag = os.path.basename(f)[:-5]
    if sys.argv[1] != "all" and not any(p in tag for p in sys.argv[1].split(",")):
        continue
    r = json.load(open(f))
    for e in ests:
        if e in r["res"]:
            rows.append({"tag": tag, "est": e, **{c: r["res"][e].get(c) for c in cols}})
print(pd.DataFrame(rows).set_index(["tag", "est"]).round(3).to_string())
