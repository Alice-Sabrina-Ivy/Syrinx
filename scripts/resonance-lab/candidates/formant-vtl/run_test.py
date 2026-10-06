"""Lab evaluation on the TEST split for variants chosen on dev (no tuning here); logs to variants_test.jsonl."""
import os, sys, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lab, sweep  # noqa: E402

if __name__ == "__main__":
    names = sys.argv[1].split(",")
    allv = {v["name"]: v for g in sweep.GROUPS.values() for v in g}
    out = os.path.join(lab.OUT, "variants_test.jsonl")
    os.makedirs(os.path.join(lab.OUT, "results"), exist_ok=True)
    for n in names:
        v = allv[n]
        t0 = time.time()
        res, sm, _ = lab.run(v["cfg"], "test", v["corr"], name=n, agg=v["agg"], verbose=False)
        rec = dict(name=n, split="test", cfg=v["cfg"], corr=v["corr"], agg=v["agg"], summary=sm, secs=round(time.time() - t0))
        open(out, "a").write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)
        json.dump(res, open(os.path.join(lab.OUT, "results", f"{n}.test.json"), "w"), default=float)
