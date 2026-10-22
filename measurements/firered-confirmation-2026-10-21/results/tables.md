| # | row | result (worst gating group) | limit | tuning value at R1 h | pass |
|---|---|---|---|---|---|
| G1 | nfresh | 80.64 % | >= 60 % | 79.8 % (tuning-194) | pass |
| G2 | noiseho | 79.15 % | >= 50 % | — (not read before) | pass |
| G3 | ravspeech | 0.20 % (m) | <= 1 % | pooled 0.30 / 0.11 %; worst row 0.99 % | pass |
| G3 | slr83 | 0.04 % (f) | <= 1 % | pooled 0.30 / 0.11 %; worst row 0.99 % | pass |
| G5 | ravsong | 0.00 % (m) | <= 1 % | <= 0.08 % pooled; worst row 0.48 % | pass |
| G8 | pvqd+voiced | 1.01 % (f) | <= 10 % | pooled 2.8 / 6.4 %; worst rows 10.5 / 9.9 % | pass |
| G8 | vmode (Behringer) | 1.92 % (m) | <= 10 % | pooled 2.8 / 6.4 %; worst rows 10.5 / 9.9 % | pass |
| G8 | vocalset | 0.92 % (m) | <= 10 % | pooled 2.8 / 6.4 %; worst rows 10.5 / 9.9 % | pass |
| G4 | vin lead 0 +10 dB | 0.03 % (unknown) | <= 3 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vin lead 0 0 dB | 0.94 % (unknown) | <= 10 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vin lead 20 s +10 dB | 0.00 % (m) | <= 3 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vin lead 20 s 0 dB | 0.94 % (unknown) | <= 10 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vinfresh lead 0 +10 dB | 0.76 % (m) | <= 3 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vinfresh lead 0 0 dB | 1.15 % (m) | <= 10 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vinfresh lead 20 s +10 dB | 1.22 % (m) | <= 3 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G4 | vinfresh lead 20 s 0 dB | 1.38 % (m) | <= 10 % | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) | pass |
| G6 | onset delay, median per sex group (gating voice streams) | 0 ms | <= 100 ms | 0 ms | pass |
| G7 | desktop browser CPU per 25 ms (max of Node / Chrome medians) | 0.847 ms | <= 2.0 ms | 1.4-1.6 ms (Python, not the browser) | pass |

Verdict: **CONFIRMED**; failing rows: none; missing sets: none


#### nfresh (175 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G1 nfresh | 80.64 % (35636 / 44192) |
| app16 paired: same hops, app-resampler-fed | 78.76 % (27545 / 34972) |
| app16 paired: same hops, scipy-fed | 78.90 % (27593 / 34972) |
| nfresh class dcase25:AutoTrash | 100.00 % (792 / 792) |
| nfresh class dcase25:BandSealer | 100.00 % (174 / 174) |
| nfresh class dcase25:CoffeeGrinder | 39.90 % (504 / 1263) |
| nfresh class dcase25:HomeCamera | 91.62 % (2045 / 2232) |
| nfresh class dcase25:Polisher | 100.00 % (396 / 396) |
| nfresh class dcase25:ScrewFeeder | 100.00 % (892 / 892) |
| nfresh class dcase25:ToyPet | 95.97 % (2450 / 2553) |
| nfresh class dcase25:ToyRCCar | 86.06 % (790 / 918) |
| nfresh class freesound:computer | 77.04 % (1329 / 1725) |
| nfresh class freesound:fans | 49.82 % (4519 / 9070) |
| nfresh class freesound:fridge | 97.13 % (12334 / 12699) |
| nfresh class freesound:hvac | 45.94 % (328 / 714) |
| nfresh class freesound:mains | 87.35 % (5919 / 6776) |
| nfresh class freesound:traffic | 79.34 % (3164 / 3988) |
| nfresh part dcase25 | 87.23 % (8043 / 9220) |
| nfresh part freesound | 78.90 % (27593 / 34972) |
| nfresh rate 16000 Hz | 87.23 % (8043 / 9220) |
| nfresh rate 192000 Hz | 100.00 % (243 / 243) |
| nfresh rate 44100 Hz | 57.17 % (8864 / 15504) |
| nfresh rate 48000 Hz | 96.07 % (16650 / 17332) |
| nfresh rate 88200 Hz | 100.00 % (65 / 65) |
| nfresh rate 96000 Hz | 96.88 % (1771 / 1828) |
| app resampler: G1 nfresh | 78.76 % (27545 / 34972) |

#### noiseho (119 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G2 noiseho | 79.15 % (36437 / 46033) |
| noiseho class ToyCar | 94.16 % (580 / 616) |
| noiseho class ToyConveyor | 68.62 % (748 / 1090) |
| noiseho class appliance_motor | 96.00 % (3862 / 4023) |
| noiseho class boiler | 58.74 % (2212 / 3766) |
| noiseho class building | 70.20 % (610 / 869) |
| noiseho class compressor | 12.18 % (24 / 197) |
| noiseho class computer_fan | 100.00 % (95 / 95) |
| noiseho class electronics_whine | 100.00 % (9 / 9) |
| noiseho class engine_idle | 55.81 % (322 / 577) |
| noiseho class exhaust_fan | 94.98 % (984 / 1036) |
| noiseho class fan | 100.00 % (804 / 804) |
| noiseho class hvac | 100.00 % (940 / 940) |
| noiseho class industrial | 86.14 % (5644 / 6552) |
| noiseho class mains_hum | 82.25 % (3966 / 4822) |
| noiseho class office | 61.79 % (3839 / 6213) |
| noiseho class pump | 94.65 % (3328 / 3516) |
| noiseho class slider | 100.00 % (1083 / 1083) |
| noiseho class small_motor | 60.25 % (876 / 1454) |
| noiseho class transformer | 71.22 % (3553 / 4989) |
| noiseho class valve | 92.80 % (967 / 1042) |
| noiseho class vehicle_interior | 85.09 % (1991 / 2340) |
| noiseho source dcaseeval | 91.41 % (4819 / 5272) |
| noiseho source fsheld | 77.57 % (31618 / 40761) |

#### ravspeech (1440 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G3 ravspeech | f 0.15 % (26 / 17250); m 0.20 % (31 / 15163) |
| app16 paired: same hops, app-resampler-fed | f 0.16 % (47 / 29551); m 0.23 % (68 / 29181) |
| app16 paired: same hops, scipy-fed | f 0.14 % (41 / 29551); m 0.20 % (57 / 29181) |
| ravspeech rate 48000 Hz | f 0.14 % (41 / 29551); m 0.20 % (57 / 29181) |
| ravspeech strong intensity (reported) | f 0.12 % (15 / 12301); m 0.19 % (26 / 14018) |
| app resampler: G3 ravspeech | f 0.17 % (29 / 17250); m 0.22 % (33 / 15163) |

#### slr83 (696 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G3 slr83 | f 0.04 % (9 / 20113); m 0.00 % (0 / 38926) |
| slr83 rate 48000 Hz | f 0.04 % (9 / 20113); m 0.00 % (0 / 38926) |

#### ravsong (1012 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G5 ravsong | f 0.00 % (0 / 19382); m 0.00 % (0 / 25960) |
| app16 paired: same hops, app-resampler-fed | f 0.00 % (0 / 33904); m 0.03 % (13 / 46769) |
| app16 paired: same hops, scipy-fed | f 0.00 % (0 / 33904); m 0.03 % (12 / 46769) |
| ravsong rate 48000 Hz | f 0.00 % (0 / 33904); m 0.03 % (12 / 46769) |
| ravsong strong intensity (reported) | f 0.00 % (0 / 14522); m 0.06 % (12 / 20809) |
| app resampler: G5 ravsong | f 0.00 % (0 / 19382); m 0.00 % (0 / 25960) |

#### vocalset (399 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G8 vocalset | f 0.62 % (107 / 17130); m 0.92 % (651 / 70979) |
| long holds vocalset: 0-2 s into the hold | f 0.49 % (47 / 9593); m 0.39 % (155 / 39438) |
| long holds vocalset: 2-5 s into the hold | f 0.00 % (0 / 2280); m 1.98 % (235 / 11867) |
| long holds vocalset: 5-10 s into the hold | f — % (0 / 0); m 0.00 % (0 / 24) |
| long holds vocalset: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| vocalset rate 16000 Hz | f 0.62 % (107 / 17130); m 0.92 % (651 / 70979) |

#### pvqd+voiced (504 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G8 pvqd+voiced | f 1.01 % (217 / 21503); m 1.01 % (120 / 11923); unknown 0.35 % (470 / 134870) |
| long holds pvqd+voiced: 0-2 s into the hold | f 0.28 % (26 / 9322); m 0.18 % (9 / 4987); unknown 0.41 % (123 / 29723) |
| long holds pvqd+voiced: 2-5 s into the hold | f 1.66 % (146 / 8793); m 1.70 % (94 / 5545); unknown 0.66 % (112 / 16915) |
| long holds pvqd+voiced: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown 0.00 % (0 / 883) |
| long holds pvqd+voiced: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown — % (0 / 0) |
| pvqd hops inside held segments (sustained vowels) | unknown 0.49 % (235 / 47521) |
| pvqd hops outside held segments (sentences, vowel edges) | unknown 0.27 % (235 / 87349) |
| pvqd+voiced rate 16000 Hz | f 1.01 % (217 / 21503); m 1.01 % (120 / 11923); unknown 0.35 % (470 / 134870) |

#### vmode (1200 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G8 vmode (Behringer) | f 1.43 % (302 / 21113); m 1.92 % (487 / 25419) |
| app16 paired: same hops, app-resampler-fed | f 1.03 % (217 / 21113); m 1.70 % (431 / 25419) |
| app16 paired: same hops, scipy-fed | f 1.43 % (302 / 21113); m 1.92 % (487 / 25419) |
| long holds vmode: 0-2 s into the hold | f 1.31 % (200 / 15254); m 1.97 % (366 / 18549) |
| long holds vmode: 2-5 s into the hold | f 0.00 % (0 / 1); m 0.00 % (0 / 150) |
| long holds vmode: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds vmode: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| vmode rate 44100 Hz | f 1.43 % (302 / 21113); m 1.92 % (487 / 25419) |
| app resampler: G8 vmode (Behringer) | f 1.03 % (217 / 21113); m 1.70 % (431 / 25419) |

#### vinfresh (236 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G4 vinfresh lead 0 +10 dB | f 0.00 % (0 / 4289); m 0.76 % (36 / 4737) |
| G4 vinfresh lead 0 0 dB | f 1.07 % (30 / 2808); m 1.15 % (31 / 2700) |
| G4 vinfresh lead 20 s +10 dB | f 0.00 % (0 / 4352); m 1.22 % (57 / 4679) |
| G4 vinfresh lead 20 s 0 dB | f 1.36 % (39 / 2869); m 1.38 % (38 / 2754) |
| app16 paired: same hops, app-resampler-fed | f 2.77 % (694 / 25027); m 2.23 % (579 / 25968) |
| app16 paired: same hops, scipy-fed | f 2.23 % (557 / 25027); m 2.24 % (581 / 25968) |
| false paint vinfresh lead 0 +10 dB: noise-only lead | — % (0 / 0) |
| false paint vinfresh lead 0 +10 dB: tail after the voice | 71.62 % (2511 / 3506) |
| false paint vinfresh lead 0 0 dB: noise-only lead | — % (0 / 0) |
| false paint vinfresh lead 0 0 dB: tail after the voice | 74.46 % (3251 / 4366) |
| false paint vinfresh lead 20 s +10 dB: noise-only lead | 85.89 % (7002 / 8152) |
| false paint vinfresh lead 20 s +10 dB: tail after the voice | 71.94 % (2892 / 4020) |
| false paint vinfresh lead 20 s 0 dB: noise-only lead | 79.30 % (6489 / 8183) |
| false paint vinfresh lead 20 s 0 dB: tail after the voice | 70.70 % (2961 / 4188) |
| held voices in noise: vinfresh lead 0 +10 dB | f 4.53 % (159 / 3513); m 2.44 % (96 / 3932) |
| held voices in noise: vinfresh lead 0 0 dB | f 4.52 % (75 / 1660); m 6.22 % (96 / 1543) |
| held voices in noise: vinfresh lead 20 s +10 dB | f 4.03 % (150 / 3721); m 2.37 % (96 / 4051) |
| held voices in noise: vinfresh lead 20 s 0 dB | f 5.73 % (104 / 1815); m 8.33 % (131 / 1572) |
| long holds in noise vinfresh lead 0 +10 dB: 0-2 s into the hold | f 4.18 % (102 / 2438); m 2.88 % (75 / 2603) |
| long holds in noise vinfresh lead 0 +10 dB: 2-5 s into the hold | f — % (0 / 0); m 0.00 % (0 / 13) |
| long holds in noise vinfresh lead 0 +10 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 0 +10 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 0 0 dB: 0-2 s into the hold | f 4.59 % (56 / 1221); m 5.92 % (59 / 996) |
| long holds in noise vinfresh lead 0 0 dB: 2-5 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 0 0 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 0 0 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 20 s +10 dB: 0-2 s into the hold | f 3.59 % (92 / 2561); m 2.80 % (75 / 2683) |
| long holds in noise vinfresh lead 20 s +10 dB: 2-5 s into the hold | f — % (0 / 0); m 0.00 % (0 / 13) |
| long holds in noise vinfresh lead 20 s +10 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 20 s +10 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 20 s 0 dB: 0-2 s into the hold | f 5.43 % (72 / 1327); m 7.79 % (78 / 1001) |
| long holds in noise vinfresh lead 20 s 0 dB: 2-5 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 20 s 0 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| long holds in noise vinfresh lead 20 s 0 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0) |
| right after voice vinfresh lead 0 +10 dB: 0-2 s after a voice layer ends | 14.34 % (502 / 3500) |
| right after voice vinfresh lead 0 +10 dB: 2-10 s after a voice layer ends | 75.75 % (2240 / 2957) |
| right after voice vinfresh lead 0 0 dB: 0-2 s after a voice layer ends | 27.66 % (944 / 3413) |
| right after voice vinfresh lead 0 0 dB: 2-10 s after a voice layer ends | 77.29 % (2859 / 3699) |
| right after voice vinfresh lead 20 s +10 dB: 0-2 s after a voice layer ends | 16.24 % (609 / 3750) |
| right after voice vinfresh lead 20 s +10 dB: 2-10 s after a voice layer ends | 77.41 % (2581 / 3334) |
| right after voice vinfresh lead 20 s 0 dB: 0-2 s after a voice layer ends | 26.78 % (871 / 3252) |
| right after voice vinfresh lead 20 s 0 dB: 2-10 s after a voice layer ends | 74.57 % (2631 / 3528) |
| vinfresh lead 0 +10 dB kind held | f 4.53 % (159 / 3513); m 2.44 % (96 / 3932) |
| vinfresh lead 0 +10 dB kind song | f 0.00 % (0 / 2515); m 0.57 % (18 / 3179) |
| vinfresh lead 0 +10 dB kind speech | f 0.00 % (0 / 1774); m 1.16 % (18 / 1558) |
| vinfresh lead 0 +10 dB rate 48000 Hz | f 2.04 % (159 / 7802); m 1.52 % (132 / 8669) |
| vinfresh lead 0 0 dB kind held | f 4.52 % (75 / 1660); m 6.22 % (96 / 1543) |
| vinfresh lead 0 0 dB kind song | f 0.50 % (9 / 1816); m 1.40 % (29 / 2072) |
| vinfresh lead 0 0 dB kind speech | f 2.12 % (21 / 992); m 0.32 % (2 / 628) |
| vinfresh lead 0 0 dB rate 48000 Hz | f 2.35 % (105 / 4468); m 2.99 % (127 / 4243) |
| vinfresh lead 20 s +10 dB kind held | f 4.03 % (150 / 3721); m 2.37 % (96 / 4051) |
| vinfresh lead 20 s +10 dB kind song | f 0.00 % (0 / 2545); m 0.57 % (18 / 3142) |
| vinfresh lead 20 s +10 dB kind speech | f 0.00 % (0 / 1807); m 2.54 % (39 / 1537) |
| vinfresh lead 20 s +10 dB rate 48000 Hz | f 1.86 % (150 / 8073); m 1.75 % (153 / 8730) |
| vinfresh lead 20 s 0 dB kind held | f 5.73 % (104 / 1815); m 8.33 % (131 / 1572) |
| vinfresh lead 20 s 0 dB kind song | f 0.87 % (16 / 1846); m 1.35 % (29 / 2151) |
| vinfresh lead 20 s 0 dB kind speech | f 2.25 % (23 / 1023); m 1.49 % (9 / 603) |
| vinfresh lead 20 s 0 dB rate 48000 Hz | f 3.05 % (143 / 4684); m 3.91 % (169 / 4326) |
| app resampler: G4 vinfresh lead 0 +10 dB | f 0.00 % (0 / 4289); m 0.59 % (28 / 4737) |
| app resampler: G4 vinfresh lead 0 0 dB | f 1.03 % (29 / 2808); m 1.33 % (36 / 2700) |
| app resampler: G4 vinfresh lead 20 s +10 dB | f 0.00 % (0 / 4352); m 1.05 % (49 / 4679) |
| app resampler: G4 vinfresh lead 20 s 0 dB | f 1.29 % (37 / 2869); m 1.56 % (43 / 2754) |
| app resampler: held voices in noise: vinfresh lead 0 +10 dB | f 4.53 % (159 / 3513); m 2.44 % (96 / 3932) |
| app resampler: held voices in noise: vinfresh lead 0 0 dB | f 6.33 % (105 / 1660); m 5.90 % (91 / 1543) |
| app resampler: held voices in noise: vinfresh lead 20 s +10 dB | f 6.05 % (225 / 3721); m 2.72 % (110 / 4051) |
| app resampler: held voices in noise: vinfresh lead 20 s 0 dB | f 7.66 % (139 / 1815); m 8.02 % (126 / 1572) |

#### vin (1568 streams)

| reading | result per group: veto % (vetoed / hops) |
|---|---|
| G4 vin lead 0 +10 dB | f 0.00 % (0 / 10311); m 0.00 % (0 / 9886); unknown 0.03 % (5 / 15237) |
| G4 vin lead 0 0 dB | f 0.07 % (4 / 5543); m 0.85 % (41 / 4848); unknown 0.94 % (104 / 11083) |
| G4 vin lead 20 s +10 dB | f 0.00 % (0 / 10422); m 0.00 % (0 / 9748); unknown 0.00 % (0 / 15043) |
| G4 vin lead 20 s 0 dB | f 0.09 % (5 / 5745); m 0.93 % (44 / 4741); unknown 0.94 % (105 / 11187) |
| false paint vin lead 0 +10 dB: noise-only lead | — % (0 / 0) |
| false paint vin lead 0 +10 dB: tail after the voice | 66.43 % (13678 / 20591) |
| false paint vin lead 0 0 dB: noise-only lead | — % (0 / 0) |
| false paint vin lead 0 0 dB: tail after the voice | 60.14 % (11257 / 18717) |
| false paint vin lead 20 s +10 dB: noise-only lead | 83.30 % (72180 / 86646) |
| false paint vin lead 20 s +10 dB: tail after the voice | 65.10 % (12089 / 18570) |
| false paint vin lead 20 s 0 dB: noise-only lead | 73.30 % (63918 / 87206) |
| false paint vin lead 20 s 0 dB: tail after the voice | 59.37 % (10777 / 18152) |
| held voices in noise: vin lead 0 +10 dB | f 1.17 % (299 / 25549); m 3.35 % (3164 / 94534); unknown 3.89 % (1157 / 29729) |
| held voices in noise: vin lead 0 0 dB | f 4.65 % (793 / 17054); m 18.87 % (11554 / 61229); unknown 15.68 % (3017 / 19237) |
| held voices in noise: vin lead 20 s +10 dB | f 1.27 % (325 / 25496); m 3.59 % (3406 / 94777); unknown 3.73 % (1126 / 30190) |
| held voices in noise: vin lead 20 s 0 dB | f 5.20 % (840 / 16161); m 19.79 % (12367 / 62479); unknown 14.87 % (3022 / 20328) |
| long holds in noise vin lead 0 +10 dB: 0-2 s into the hold | f 0.13 % (22 / 16637); m 3.41 % (2087 / 61213); unknown 1.46 % (104 / 7137) |
| long holds in noise vin lead 0 +10 dB: 2-5 s into the hold | f 4.37 % (260 / 5952); m 3.54 % (816 / 23057); unknown 17.17 % (721 / 4198) |
| long holds in noise vin lead 0 +10 dB: 5-10 s into the hold | f — % (0 / 0); m 0.00 % (0 / 8); unknown 55.78 % (164 / 294) |
| long holds in noise vin lead 0 +10 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown — % (0 / 0) |
| long holds in noise vin lead 0 0 dB: 0-2 s into the hold | f 2.99 % (339 / 11338); m 18.68 % (7573 / 40551); unknown 21.98 % (993 / 4517) |
| long holds in noise vin lead 0 0 dB: 2-5 s into the hold | f 10.16 % (389 / 3827); m 21.00 % (3227 / 15368); unknown 43.03 % (1279 / 2972) |
| long holds in noise vin lead 0 0 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown 58.04 % (148 / 255) |
| long holds in noise vin lead 0 0 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown — % (0 / 0) |
| long holds in noise vin lead 20 s +10 dB: 0-2 s into the hold | f 0.37 % (61 / 16543); m 3.63 % (2224 / 61326); unknown 1.54 % (112 / 7281) |
| long holds in noise vin lead 20 s +10 dB: 2-5 s into the hold | f 3.95 % (236 / 5977); m 3.87 % (892 / 23049); unknown 16.36 % (701 / 4286) |
| long holds in noise vin lead 20 s +10 dB: 5-10 s into the hold | f — % (0 / 0); m 0.00 % (0 / 8); unknown 51.87 % (139 / 268) |
| long holds in noise vin lead 20 s +10 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown — % (0 / 0) |
| long holds in noise vin lead 20 s 0 dB: 0-2 s into the hold | f 3.48 % (372 / 10691); m 19.63 % (8154 / 41528); unknown 20.17 % (1019 / 5051) |
| long holds in noise vin lead 20 s 0 dB: 2-5 s into the hold | f 10.60 % (388 / 3660); m 21.88 % (3393 / 15507); unknown 40.14 % (1264 / 3149) |
| long holds in noise vin lead 20 s 0 dB: 5-10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown 45.03 % (86 / 191) |
| long holds in noise vin lead 20 s 0 dB: >= 10 s into the hold | f — % (0 / 0); m — % (0 / 0); unknown — % (0 / 0) |
| right after voice vin lead 0 +10 dB: 0-2 s after a voice layer ends | 16.65 % (3673 / 22054) |
| right after voice vin lead 0 +10 dB: 2-10 s after a voice layer ends | 83.51 % (11390 / 13639) |
| right after voice vin lead 0 0 dB: 0-2 s after a voice layer ends | 27.53 % (5309 / 19284) |
| right after voice vin lead 0 0 dB: 2-10 s after a voice layer ends | 71.49 % (8664 / 12120) |
| right after voice vin lead 20 s +10 dB: 0-2 s after a voice layer ends | 15.14 % (3095 / 20436) |
| right after voice vin lead 20 s +10 dB: 2-10 s after a voice layer ends | 82.62 % (10198 / 12344) |
| right after voice vin lead 20 s 0 dB: 0-2 s after a voice layer ends | 26.32 % (4892 / 18584) |
| right after voice vin lead 20 s 0 dB: 2-10 s after a voice layer ends | 70.80 % (8367 / 11818) |
| vin lead 0 +10 dB kind clinical | unknown 3.89 % (1157 / 29729) |
| vin lead 0 +10 dB kind held_series | f 0.13 % (31 / 23056); m 3.36 % (3135 / 93282) |
| vin lead 0 +10 dB kind sing | unknown 0.03 % (5 / 15237) |
| vin lead 0 +10 dB kind speech | f 0.00 % (0 / 10311); m 0.00 % (0 / 9886) |
| vin lead 0 +10 dB kind sustained_a | f 10.75 % (268 / 2493); m 2.32 % (29 / 1252) |
| vin lead 0 +10 dB noise split held | f 0.17 % (24 / 13896); m 3.58 % (1261 / 35189); unknown 2.39 % (355 / 14878) |
| vin lead 0 +10 dB noise split tune | f 1.25 % (275 / 21964); m 2.75 % (1903 / 69231); unknown 2.68 % (807 / 30088) |
| vin lead 0 +10 dB rate 16000 Hz | f 0.83 % (299 / 35860); m 3.03 % (3164 / 104420); unknown 2.58 % (1162 / 44966) |
| vin lead 0 0 dB kind clinical | unknown 15.68 % (3017 / 19237) |
| vin lead 0 0 dB kind held_series | f 3.74 % (580 / 15523); m 18.76 % (11355 / 60530) |
| vin lead 0 0 dB kind sing | unknown 0.94 % (104 / 11083) |
| vin lead 0 0 dB kind speech | f 0.07 % (4 / 5543); m 0.85 % (41 / 4848) |
| vin lead 0 0 dB kind sustained_a | f 13.91 % (213 / 1531); m 28.47 % (199 / 699) |
| vin lead 0 0 dB noise split held | f 2.40 % (251 / 10446); m 22.56 % (4615 / 20457); unknown 8.72 % (966 / 11077) |
| vin lead 0 0 dB noise split tune | f 4.49 % (546 / 12151); m 15.30 % (6980 / 45620); unknown 11.20 % (2155 / 19243) |
| vin lead 0 0 dB rate 16000 Hz | f 3.53 % (797 / 22597); m 17.55 % (11595 / 66077); unknown 10.29 % (3121 / 30320) |
| vin lead 20 s +10 dB kind clinical | unknown 3.73 % (1126 / 30190) |
| vin lead 20 s +10 dB kind held_series | f 0.14 % (31 / 22865); m 3.61 % (3377 / 93513) |
| vin lead 20 s +10 dB kind sing | unknown 0.00 % (0 / 15043) |
| vin lead 20 s +10 dB kind speech | f 0.00 % (0 / 10422); m 0.00 % (0 / 9748) |
| vin lead 20 s +10 dB kind sustained_a | f 11.17 % (294 / 2631); m 2.29 % (29 / 1264) |
| vin lead 20 s +10 dB noise split held | f 0.36 % (49 / 13738); m 3.90 % (1369 / 35097); unknown 2.35 % (350 / 14875) |
| vin lead 20 s +10 dB noise split tune | f 1.24 % (276 / 22180); m 2.93 % (2037 / 69428); unknown 2.56 % (776 / 30358) |
| vin lead 20 s +10 dB rate 16000 Hz | f 0.90 % (325 / 35918); m 3.26 % (3406 / 104525); unknown 2.49 % (1126 / 45233) |
| vin lead 20 s 0 dB kind clinical | unknown 14.87 % (3022 / 20328) |
| vin lead 20 s 0 dB kind held_series | f 3.71 % (549 / 14780); m 19.43 % (11966 / 61573) |
| vin lead 20 s 0 dB kind sing | unknown 0.94 % (105 / 11187) |
| vin lead 20 s 0 dB kind speech | f 0.09 % (5 / 5745); m 0.93 % (44 / 4741) |
| vin lead 20 s 0 dB kind sustained_a | f 21.07 % (291 / 1381); m 44.26 % (401 / 906) |
| vin lead 20 s 0 dB noise split held | f 2.82 % (283 / 10035); m 24.31 % (5158 / 21216); unknown 9.16 % (1051 / 11469) |
| vin lead 20 s 0 dB noise split tune | f 4.73 % (562 / 11871); m 15.77 % (7253 / 46004); unknown 10.36 % (2076 / 20046) |
| vin lead 20 s 0 dB rate 16000 Hz | f 3.86 % (845 / 21906); m 18.46 % (12411 / 67220); unknown 9.92 % (3127 / 31515) |

Onset delays (gating voice streams): f: median 0 ms, p90 0 ms, n 2318, never shown 2; m: median 0 ms, p90 0 ms, n 2402, never shown 8; unknown: median 0 ms, p90 0 ms, n 494, never shown 2
