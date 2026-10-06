# vtln-warp dev scripts

Run these from `build/resonance-lab/vtln-warp/` (they resolve paths relative to that folder):
copy them there first. Interpreter: `build/resonance-lab/venv/Scripts/python`.

1. `python extract.py ct train_dev 4; python extract.py ct manip_dev 4` (and `lift`) - cache voiced-frame
   envelopes (gitignored, ~0.9 GB each). `r1_dev` is a subset of train_dev and is read from that cache.
2. `python aug_extract.py 8 4; python aug_extract.py -8 4` - Praat-PSOLA +-8 st copies of train_dev.
3. `./sweep.sh variants_all.tsv` - 2-fold speaker-disjoint CV on dev-clean per variant
   (model trained on the other fold's train_dev speakers only); writes dev_results/<tag>.json.
4. `python show.py all w1,post1` - variant table; `python tsum.py <result names>` - test-split summary.
5. `python f0robust.py` - F0-error sensitivity of the final model (diagnostic, no tuning).

`diag1.py` / `diag2.py` are the first-session diagnostics that motivated model warping over data warping.
