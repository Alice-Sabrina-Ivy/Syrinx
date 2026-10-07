"""Assemble calibration.json (shipped constants + provenance + test vectors)."""
import json, numpy as np
from data import *
FIT = json.load(open("fit.json")); UNS = json.load(open("unsure.json"))
H = set_target(load(), "half"); H = H[H[CUE].notna().all(axis=1)]
FS = ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695"]
Fit = H[H.fset.isin(FS) & H.y.notna()]
a, b, c = FIT["a"], FIT["b_meter"], FIT["c_lnf0"]
W, K, FL = 2.25, 0.42, 0.02
sg = lambda e: 1 / (1 + np.exp(-e))
def show(m, f0):
    e = a + b * m + c * np.log(f0); s = sg(e); lo, hi = sg(e - W), sg(e + W)
    def three(s):
        u = min(max(FL, K * 4 * s * (1 - s)), 2 * min(s, 1 - s)); return s - u / 2, u, 1 - s - u / 2
    mc, uc, wc = three(s); ml, _, wl = three(lo); mh, _, wh = three(hi)
    word = "likely heard as a man" if lo > 0.5 else ("likely heard as a woman" if hi < 0.5 else "listeners would split")
    return dict(meter_logit=m, f0_hz=f0, eta=round(e, 4), s=round(s, 4), s_low=round(lo, 4), s_high=round(hi, 4),
                man=round(mc, 4), man_low=round(ml, 4), man_high=round(mh, 4), unsure=round(uc, 4),
                woman=round(wc, 4), woman_low=round(wh, 4), woman_high=round(wl, 4), word=word,
                in_tenths=dict(man=[int(np.floor(10 * ml)), int(np.ceil(10 * mh))], woman=[int(np.floor(10 * wh)), int(np.ceil(10 * wl))]))
J = {
 "name": "Likely heard as -- experimental calibration (form A)",
 "version": "2026-10-07",
 "status": "EXPERIMENT: opt-in, off by default; see CALIBRATION.md for known failures that the UI must disclose",
 "model": {
   "form": "eta = a + b*meter_logit + c*ln(F0_Hz);  s = 1/(1+exp(-eta)) = share of listeners who would answer 'man' in a two-way choice (unsure listeners counted half each way)",
   "a": a, "b_meter_logit": b, "c_ln_f0": c,
   "bootstrap_95ci": {"a": FIT["boot_ci"][0][0:1] + FIT["boot_ci"][1][0:1], "b": [FIT["boot_ci"][0][1], FIT["boot_ci"][1][1]], "c": [FIT["boot_ci"][0][2], FIT["boot_ci"][1][2]],
                      "note": "talker-cluster bootstrap within sources, 300 reps; prediction SD 0.15-0.18 logit at typical inputs"},
   "f0_for_50pct_at_meter_logit": {str(m): round(float(np.exp((a + b * m) / -c)), 1) for m in [-4, -2, 0, 2, 4]},
   "source_offsets_logit_not_used_live": FIT["offsets"], "source_offset_sd": FIT["offset_sd"],
   "tested_input_range": {"f0_hz": [round(float(np.exp(Fit.lnf0.min())), 1), round(float(np.exp(Fit.lnf0.quantile(0.99))), 1), round(float(np.exp(Fit.lnf0.max())), 1)],
                          "f0_note": "[min, q99, max] of the fit stimuli; Palette (natural running speech) alone ends at 213 Hz",
                          "meter_logit": [round(float(Fit.meter_logit.min()), 2), round(float(Fit.meter_logit.max()), 2)]},
 },
 "range": {"half_width_logit": W, "nominal": "80 %",
           "rule": "show [1/(1+exp(-(eta-w))), 1/(1+exp(-(eta+w)))]; in 'x in 10 listeners' round the low end DOWN and the high end UP",
           "basis": "smallest width with >= 80 % source-balanced coverage of held-out listener data on BOTH sides (feminine-presenting 0.81, ambiguous 0.83, masculine-presenting 0.88); natural voices need only ~1.1 after correcting for listener-panel sampling"},
 "unsure": {"model": "u = min(max(f, k*4*s*(1-s)), 2*min(s, 1-s)); man = s - u/2; woman = 1 - s - u/2  (even split = the inverse of the fitted target)",
            "k": K, "f": FL, "k_by_question_framing": {"explicit other-gender + no-answer (Palette)": round(UNS["palette"][0], 2),
                 "'other gender' only (Palette)": round(UNS["palette 'other gender' only"][0], 2),
                 "7-point scale midpoint (RB695)": round(UNS["rb695 (7-pt midpoint)"][0], 2),
                 "5-point midpoint (Mooshammer, validation)": 0.20, "'I don't know' (Kong singing, validation)": round(UNS["kong singing ('I don't know') [val]"][0], 2),
                 "neutral word, 3 annotators (LibriTTS-P, validation)": round(UNS["libritts-p (neutral word, 3 annot.) [val]"][0], 2)},
            "basis": "pooled licence-clean fit (Palette + RB695, equal source weight) k 0.42, f 0.00; f set to 0.02 as a display floor; the sweep prior (k 0.28, f 0.04) fits Palette at MAE 10.7 vs 2.9 points"},
 "word": {"likely heard as a man": "s_low > 0.5", "likely heard as a woman": "s_high < 0.5", "listeners would split": "otherwise"},
 "live_aggregation": {
   "window_s": 8.0, "update_every_s": 2.0,
   "meter_logit": "arithmetic mean, over every 0.75 s classifier window that the utterance gate scored (verdict 'score') and that ENDS inside the trailing 8 s, of L = ln(p_female) - ln(p_male) from that window's own (unsmoothed) classifier probabilities -- never the EMA or the 0-100 score; skip a window if L is not finite; no clamping (fit data reach -37)",
   "ln_f0": "ln of the median of the pitch worker's POSTED voiced pitch values (pitch != null; one per 25 ms frame; not smoothed, painted or held values) whose frame time lies inside at least one of those scored windows",
   "voiced_seconds": "count of those voiced frames x 0.025 s",
   "fit_pooling": "fit items (2-3 s voiced) pooled the same way per item with the lab gate (window scored if >= 1 voiced 10 ms frame in its last 0.5 s); replaying the live utterance gate (origin/voice-direction 852b5cc) changes meter_logit by +0.08..+0.12 on average (eta -0.03..-0.04 logit)",
 },
 "hide_rules": {"min_voiced_seconds_in_window": 3.0, "min_scored_windows_in_window": 10,

                "notes": "both counted from scored windows only (see live_aggregation). Held notes: the gate never scores them (verdict 'sustained'), so they fail the scored-window rule; melodic singing and children's voices are NOT detected by any rule and must be disclosed"},
 "fit_data": {"target": "two-way-equivalent '% heard as man' = man + unsure/2 (2AFC sources as published)",
              "weights": "each source weighted sqrt(#listener data), every listener datum equal inside its source; per-source intercept offsets summing to zero; the app uses offset 0",
              "sources": {s: dict(stimuli=int((Fit.fset == s).sum()), listener_data=int(Fit[Fit.fset == s].unit.nunique()), talkers=int(Fit[Fit.fset == s].talker.nunique())) for s in FS}},
 "test_vectors": [show(m, f) for m, f in [(-5, 110), (-3, 130), (-1, 150), (0, 165), (2, 180), (3.5, 210), (1.6, 161)]],
}
json.dump(J, open("calibration.json", "w"), indent=1, default=float)
print(json.dumps(J["test_vectors"][:3], indent=1)); print(J["model"]["tested_input_range"])
