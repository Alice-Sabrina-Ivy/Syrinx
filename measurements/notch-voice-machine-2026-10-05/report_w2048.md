# Voice line vs machine line — micro-variation features (voice_w2048 / noise_w2048)

Windows (1 s): real voice 1960 (474 clips; typical 1162), synthetic 6297, machine 16052 (479 clips).
Typical voice windows by source: pvqd 575, vocalset 373, voiced 213, vocadito 1
Machine windows by group: motors/pumps/appliances 6529, mains/electrical 3755, fans/HVAC 3570, vehicles/engines/saws 1278, alarms/horns/bells/insects 595, DEMAND rooms/outdoor 325
Typical voice lines by harmonic k: k=1: 421, k=2: 98, k=3: 30, k=4: 9

Line prominence (dB over the band median, p10/p50/p90): typical voice 42/51/65, machine 13/19/32, promotable machine 16/23/39

### A1. Window level (1 s): typical clean voice vs machine

voice n = 1162, machine n = 16052. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| corr_mid | > | 0.994 | 0.564 | 93.1% |
| corr_fast * | > | 0.989 | 0.141 | 70.3% |
| snr * | > | 0.979 | 33.4 | 87.2% |
| mid_fast | > | 0.976 | 0.722 | 80.0% |
| coh_mid | > | 0.922 | 1.5 | 69.6% |
| hr_fast * | < | 0.914 | 2.07 | 58.8% |
| am_fast * | < | 0.908 | 0.666 | 63.7% |
| hr_mid | < | 0.896 | 2.62 | 46.1% |
| am_mid | < | 0.855 | 1.4 | 36.4% |
| am_std * | < | 0.853 | 2.36 | 37.4% |
| fm_slope_abs | > | 0.793 | 0.182 | 9.9% |
| fm_fast * | < | 0.779 | 9.67 | 31.7% |
| fm_d1 * | < | 0.735 | 10.1 | 28.1% |
| coh_fast | > | 0.729 | 0.746 | 56.8% |
| fm_mid | > | 0.707 | 1.65 | 23.7% |
| h21 | > | 0.657 | -31.8 | 1.8% |
| fm2_mid | > | 0.529 | 1.61 | 20.3% |
| fm_std * | > | 0.522 | 3.06 | 17.1% |

### A2. Line level: typical clean voice lines (all hold windows) vs machine lines (first <= 5 windows)

voice n = 558, machine n = 1881. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| pcorr_mid | > | 0.992 | 0.429 | 89.8% |
| corr_mid | > | 0.992 | 0.59 | 93.8% |
| corr_fast * | > | 0.986 | 0.127 | 74.9% |
| snr * | > | 0.986 | 32.5 | 90.2% |
| mid_fast | > | 0.974 | 0.773 | 83.3% |
| hr_fast * | < | 0.947 | 2.07 | 72.5% |
| am_fast * | < | 0.947 | 0.882 | 64.9% |
| hr_mid | < | 0.944 | 2.18 | 73.3% |
| am_std * | < | 0.931 | 2.26 | 62.7% |
| am_mid | < | 0.926 | 1.4 | 51.4% |
| coh_mid | > | 0.914 | 1.51 | 68.8% |
| pcoh_mid | > | 0.912 | 1.73 | 67.9% |
| fm_fast * | < | 0.846 | 9.78 | 42.5% |
| fm_d1 * | < | 0.822 | 9.98 | 40.5% |
| coh_fast | > | 0.735 | -0.356 | 42.8% |
| fm_slope_abs | > | 0.669 | 0.148 | 2.3% |
| h21 | > | 0.639 | -31.9 | 0.9% |
| fm_std * | < | 0.618 | 21 | 21.4% |
| fm_mid | > | 0.618 | 1.84 | 14.2% |
| fm2_mid | < | 0.580 | 13.6 | 20.2% |

### A3. Line level, PROMOTABLE machine lines only (span >= 5 s, duty >= 0.9)

voice n = 558, machine n = 229. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| pcorr_mid | > | 0.996 | 0.429 | 94.8% |
| corr_mid | > | 0.996 | 0.59 | 98.7% |
| corr_fast * | > | 0.991 | 0.127 | 81.2% |
| mid_fast | > | 0.982 | 0.773 | 92.6% |
| coh_mid | > | 0.979 | 1.51 | 83.0% |
| pcoh_mid | > | 0.973 | 1.73 | 83.0% |
| snr * | > | 0.944 | 32.5 | 75.5% |
| fm_slope_abs | > | 0.915 | 0.148 | 10.9% |
| coh_fast | > | 0.864 | -0.356 | 37.1% |
| fm_mid | > | 0.856 | 1.84 | 41.9% |
| hr_mid | < | 0.806 | 2.18 | 48.9% |
| hr_fast * | < | 0.805 | 2.07 | 47.2% |
| am_fast * | < | 0.803 | 0.882 | 31.9% |
| am_mid | < | 0.741 | 1.4 | 15.3% |
| am_std * | < | 0.721 | 2.26 | 21.0% |
| fm_std * | > | 0.697 | 3.41 | 34.9% |
| h21 | > | 0.671 | -31.9 | 3.1% |
| fm_fast * | < | 0.624 | 9.78 | 15.3% |
| fm2_mid | > | 0.621 | 1.83 | 36.7% |
| fm_d1 * | < | 0.569 | 9.98 | 12.7% |

### A4. Machine noise floor vs line prominence (window level; p10/p50/p90)

| prominence dB | machine windows | fm_mid c | coh_mid c | corr_mid | voice windows | voice fm_mid | voice corr_mid |
|---|---|---|---|---|---|---|---|
| 0-15 | 2445 | 2.1/4.2/10 | -3.9/0.54/4.6 | -0.38/0.029/0.47 | 0 | - | - |
| 15-20 | 4715 | 1.6/3.7/10 | -4.3/0.4/4.4 | -0.39/0.023/0.47 | 0 | - | - |
| 20-25 | 3864 | 1.4/3.5/9.2 | -3.8/0.36/4.3 | -0.39/0.036/0.5 | 1 | 6.2/6.2/6.2 | 0.99/0.99/0.99 |
| 25-30 | 2191 | 0.91/2.7/8.7 | -3.2/0.33/3.7 | -0.38/0.052/0.47 | 2 | 7.1/7.8/8.6 | 0.71/0.83/0.95 |
| 30-40 | 2063 | 0.22/1/7.4 | -2.5/0.073/3.3 | -0.43/0.042/0.52 | 68 | 3.8/5.3/9.5 | 0.96/0.99/1 |
| 40-50 | 507 | 0.15/0.46/3 | -0.9/0.022/1 | -0.46/0.0097/0.52 | 431 | 3.6/6.3/11 | 0.97/1/1 |
| 50-99 | 267 | 0.0097/0.13/3 | -0.46/-0.0065/0.37 | -0.46/-0.096/0.41 | 660 | 2.8/4.8/8.3 | 0.99/1/1 |

### B. Typical voice lines with white noise added (SNR vs the held-segment RMS) — matched-prominence check

Thresholds from A2 (clean voice, 99 % kept). Voice kept = fraction of voice lines still on the voice side.

| condition | voice lines | prominence p10/p50/p90 | pcorr_mid kept | corr_mid kept | pcoh_mid kept | AUC pcorr vs machine | AUC pcoh |
|---|---|---|---|---|---|---|---|
| clean | 558 | 42/51/65 | 98.9% | 98.9% | 98.9% | 0.992 | 0.912 |
| +20 dB | 559 | 33/42/52 | 98.9% | 98.6% | 98.7% | 0.990 | 0.910 |
| +10 dB | 545 | 25/35/44 | 95.2% | 94.7% | 97.8% | 0.973 | 0.899 |
| +0 dB | 500 | 17/27/35 | 87.4% | 84.0% | 94.0% | 0.932 | 0.871 |

#### B2. Operating point keeping 99 % of typical voice lines over clean + every degradation (pooled)

| feature | thr | voice kept clean / +20 / +10 / +0 | machine recall | promotable machine recall |
|---|---|---|---|---|
| pcorr_mid | -0.178 | 99.8% / 99.8% / 98.7% / 97.4% | 17.4% | 7.0% |
| corr_mid | -0.178 | 99.8% / 99.8% / 98.7% / 97.4% | 19.8% | 14.0% |
| pcoh_mid | -2.26 | 99.8% / 99.8% / 99.1% / 97.0% | 20.9% | 6.6% |
| coh_mid | -1.97 | 99.8% / 99.8% / 98.9% / 97.2% | 20.8% | 9.2% |
| mid_fast | 0.581 | 99.8% / 99.5% / 100.0% / 96.4% | 63.6% | 73.8% |

### C. Small combinations — grouped 5-fold CV logistic regression on line-level features, out-of-fold scores

Voice training/eval set = typical voice lines, clean + white-noise-degraded (so the model cannot learn 'clean = voice'); operating point keeps 99 % of those voice lines. Confounded features excluded except in the last row (shown for reference).

| features | AUC | machine recall | promotable recall | voice kept clean / degraded |
|---|---|---|---|---|
| pcorr_mid | 0.971 | 16.6% | 7.9% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid | 0.973 | 16.6% | 9.6% | 99.8% / 98.7% |
| pcorr_mid+fm_mid+fm2_mid | 0.970 | 19.2% | 19.2% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid+mid_fast | 0.983 | 74.4% | 83.0% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast | 0.984 | 75.3% | 88.2% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs | 0.989 | 86.4% | 87.3% | 100.0% / 98.6% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs+snr+am_fast+fm_fast+corr_fast+hr_fast (confounded) | 0.990 | 86.3% | 89.1% | 100.0% / 98.6% |

### D. Machine recall by class — pcorr_mid alone (threshold keeps 99 % of clean+degraded typical voice lines)

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 15.2% |
| vehicles/engines/saws | 476 | 109 | 19.1% |
| alarms/horns/bells/insects | 265 | 105 | 22.3% |
| fans/HVAC | 257 | 59 | 16.0% |
| mains/electrical | 186 | 32 | 12.4% |
| DEMAND rooms/outdoor | 40 | 5 | 35.0% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 17.7% |
| mixed | 680 | 195 | 16.8% |
| intermittent-tonal | 149 | 36 | 17.4% |
| broadband | 25 | 13 | 24.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 16.3% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 20.8% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 7.0% called machine

### D. Machine recall by class — best non-confounded combination (pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs)

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 87.7% |
| vehicles/engines/saws | 476 | 109 | 81.7% |
| alarms/horns/bells/insects | 265 | 105 | 89.1% |
| fans/HVAC | 257 | 59 | 93.0% |
| mains/electrical | 186 | 32 | 80.1% |
| DEMAND rooms/outdoor | 40 | 5 | 90.0% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 88.3% |
| mixed | 680 | 195 | 85.1% |
| intermittent-tonal | 149 | 36 | 81.9% |
| broadband | 25 | 13 | 68.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 91.1% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 78.7% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 87.3% called machine

### E. synthetic held notes (suite synth.mjs, clean): lines on the voice side of the B2 thresholds

| feature | thr | lines kept as voice |
|---|---|---|
| pcorr_mid | -0.178 | 100.0% (n=364) |
| corr_mid | -0.178 | 99.7% (n=364) |
| pcoh_mid | -2.26 | 100.0% (n=364) |

synthetic by scenario family (pcorr_mid kept): synthetic_dynamics 100% (n=14), synthetic_repeat 100% (n=180), synthetic_steady 100% (n=156), synthetic_vowelchange 100% (n=14)

### E. clinical / atypical real voice (PVQD severity >= 20, VOICED pathological), clean: lines on the voice side of the B2 thresholds

| feature | thr | lines kept as voice |
|---|---|---|
| pcorr_mid | -0.178 | 100.0% (n=352) |
| corr_mid | -0.178 | 100.0% (n=352) |
| pcoh_mid | -2.26 | 100.0% (n=352) |
