import json, sys
for n in sys.argv[1:]:
    r = json.load(open(f"../results/{n}.json"))
    R1 = r["R1"]["r1_test"]; mt = r["R2R3"]["manip_test"]; mh = r["R2R3"]["manip_hill"]; R6 = r["R6"]; R7 = r["R7"]
    f = lambda v: "nan" if v is None else f"{v:.2f}"
    print(f"{n}: G={r['G']:.4f} (x{2.718281828**r['G']:.3f})")
    print(f"  R1 2s/5s/utt/spk {f(R1['auc_2s'])}/{f(R1['auc_5s'])}/{f(R1['auc_utt'])}/{f(R1['auc_spk'])}  ptdb {f(r['R1']['ptdb']['auc_5s'])} fda {f(r['R1']['fda']['auc_5s'])} hill tok/spk {f(r['R1']['hill']['auc_utt'])}/{f(r['R1']['hill']['auc_spk'])}")
    print(f"  R2 praat/world {f(mt['praat_R2'])}/{f(mt['world_R2'])} (m {f(mt['praat_R2_m'])} f {f(mt['praat_R2_f'])})  toward m+12/f-12 {f(mt['praat_toward_m_p+12'])}/{f(mt['praat_toward_f_p-12'])}  cross m+12 {f(mt['praat_men_p+12_cross'])} (base {f(mt['men_orig_cross'])}) f-12 {f(mt['praat_women_p-12_cross'])} (base {f(mt['women_orig_cross'])})")
    print(f"  R3 praat/world {f(mt['praat_R3'])}/{f(mt['world_R3'])} sign {f(mt['praat_sign5'])}/{f(mt['world_sign5'])}  +8st m {f(mt['praat_R3hi_m'])}/{f(mt['praat_sign5hi_m'])} f {f(mt['praat_R3hi_f'])}/{f(mt['praat_sign5hi_f'])}  toward x1.15/x0.85 {f(mt['praat_toward_m_f1.15'])}/{f(mt['praat_toward_f_f0.85'])} x1.05/x0.95 {f(mt['praat_toward_m_f1.05'])}/{f(mt['praat_toward_f_f0.95'])}  additivity m->f {f(mt['praat_mf+12_f1.15_additivity'])}")
    print(f"  hill-manip R2 {f(mh['praat_R2'])} R3 {f(mh['praat_R3'])} sign {f(mh['praat_sign5'])}  R4 {f(r['R4']['R4'])} vowel range {f(r['R4']['vowel_offset_range'])}  R5 flicker {f(r['R5']['flicker'])} held {f(r['R5']['held_sd'])} tts {f(r['R5']['time_to_stable_s'])}")
    cm = R6['clip_median_over_G']
    print(f"  R6 S-L/R-L/S-R {f(R6['S_minus_L'])}/{f(R6['R_minus_L'])}/{f(R6['S_minus_R'])}  auc5s S-L/R-L/S-R {f(R6['auc_5s_second_vs_alice_low'])}/{f(R6['auc_5s_alice_raised_vs_alice_low'])}/{f(R6['auc_5s_second_vs_alice_raised'])} R-L pitchcorr {f(R6['R_minus_L_pitch_corrected'])} ok={R6['ordering_ok']}")
    print(f"  R7 boys/girls {f(R7['synth_boys_position'])}/{f(R7['synth_girls_position'])} synth W-vs-M auc {f(R7['synth_auc_women_vs_men'])}  hiF0/loF0 women auc {f(R7['auc_highF0women_vs_men'])}/{f(R7['auc_lowF0women_vs_men'])}  R8 {f(r['R8']['cpu_ms_per_audio_s'])} ms/s {r['R8']['model_mb']} MB  pass {r['pass']}")
