// heardAsCalibration.js — constants of the experimental "Likely heard as"
// estimate (src/ml/heard-as.js). EXPERIMENT: opt-in, off by default.
// measurements/heard-as-calibration-2026-10-07.md (summary, errors, known
// failures, licences) — fitted 2026-10-07 on public listener data only.
//
// Model (form A): eta = a + bMeter · meterLogit + bLnF0 · ln(F0 in Hz) is
// the logit of the share of listeners who would answer "man" in a two-way
// choice (unsure listeners counted half each way). meterLogit = mean over
// the gate-scored classifier windows of ln p_female − ln p_male (the
// deployed q8-v2 ECAPA classifier, unsmoothed); F0 = median of the pitch
// worker's posted voiced pitch inside those windows (heard-as.js).
// Weighted least squares on the share with a logistic link, each source
// weighted by √(listener data), per-source intercept offsets summing to
// zero; the app uses offset 0 (the average listener group; between-study
// offset SD 0.64 logit). Talker-bootstrap 95 % intervals: bMeter
// [−0.385, −0.314], bLnF0 [−3.65, −2.89].
// Range: eta ± halfWidth (2.25 logit: the smallest width with ≥ 80 %
// source-balanced coverage of LICENCE-CLEAN held-out listener data — the fit
// sources leave-one-source-out + the Hillenbrand & Clark syllable condition —
// on the feminine and masculine sides: 0.87 / 0.83; 2.0 gives 0.81 / 0.76.
// The ambiguous side has only 3 licence-clean data (0.67), so coverage there
// rests on validation data alone; the NC / unlicensed validation sets give
// 0.72 / 0.89 / 1.00 and were never used to choose it).
// Unsure share: u = min(max(unsureFloor, unsureK · 4s(1−s)), 2·min(s, 1−s)),
// man = s − u/2, woman = 1 − s − u/2 (k 0.42 = pooled licence-clean fit;
// it depends on how listeners are asked: 0.10–0.59).
//
// Fit sources (shipped constants depend ONLY on these; only numbers ship —
// no audio, no per-stimulus tables):
//   Palette of Voices — Munson & Dolquist (2025), JSLHR,
//     doi:10.1044/2025_JSLHR-24-00756; OSF n3twm. CC BY 4.0.
//   Meyer, Rachman, Araiza-Illan, Gaudrain & Başkent (2023), PLOS ONE
//     18:e0294328, doi:10.1371/journal.pone.0294328; per-cell values
//     digitised from Fig. 6B (CC BY 4.0); data doi:10.34894/IAGXVF (CC0),
//     on the PICKA grid rebuilt from LibriSpeech test-clean (CC BY 4.0).
//   Skuk, Kirchen, Oberhoffner, Guntinas-Lichius, Dobel & Schweinberger
//     (2020), JSLHR 63(9):3155–3175, doi:10.1044/2020_JSLHR-20-00026;
//     OSF f85tj. CC BY 4.0.
//   Hillenbrand & Clark (2009), Atten Percept Psychophys 71(5):1150–1166,
//     doi:10.3758/APP.71.5.1150 — published condition rates used as facts,
//     on stimuli rebuilt from the Hillenbrand et al. (1995) /hVd/
//     recordings (measurement input only, not redistributed) and a
//     LibriSpeech sentence proxy.
//   Mohsenin & Munz (2024), Psychological Science,
//     doi:10.1177/09567976241238222; ResearchBox 695 / Zenodo
//     doi:10.5281/zenodo.15038471 — listener data CC BY 4.0 (the vendor TTS
//     audio was measured locally, never redistributed).
//   LibriSpeech — Panayotov et al. (2015), ICASSP; openslr.org/12. CC BY 4.0.
//   Classifier: JaesungHuh voice-gender-classifier (ECAPA-TDNN, MIT),
//     re-quantised as Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2.
// Validation only (no constant depends on them): Jebens et al. 2022 and
// Nagels et al. 2020 PICKA (CC BY-NC-SA), bmmb (MIT), Kong et al. 2025
// STraDa (NC), Neuenswander et al. 2024, Mooshammer & Etzrodt 2022 (no data
// licence), LibriTTS-P (CC BY 4.0).

export const HEARD_AS_CALIBRATION = Object.freeze({
  a: 17.67240817107044,
  bMeter: -0.349098302736368,
  bLnF0: -3.5373482236362848,
  halfWidth: 2.25,
  unsureK: 0.42,
  unsureFloor: 0.02,
  // Where the fit data lie: F0 [min, q99] of the fit stimuli (natural running
  // speech in the fit ends at 213 Hz; above ~290 Hz the estimate is
  // extrapolation), meter logit [min, max].
  range: Object.freeze({
    lnF0: Object.freeze([Math.log(81.0), Math.log(293.1)]),
    meterLogit: Object.freeze([-7.31, 5.72]),
  }),
  // Live pooling and hide rules the constants assume (heard-as.js).
  windowMs: 8000,
  updateMs: 2000,
  minVoicedMs: 3000,
  minWindows: 10,
  freshMs: 5000,
  fitDate: "2026-10-07",
  measurement: "measurements/heard-as-calibration-2026-10-07.md",
});
