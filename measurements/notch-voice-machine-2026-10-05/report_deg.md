# Voice line vs machine line — micro-variation features (voice_deg / noise)

Windows (1 s): real voice 1964 (475 clips; typical 1164), synthetic 6297, machine 16052 (479 clips).
Typical voice windows by source: pvqd 576, vocalset 374, voiced 213, vocadito 1
Machine windows by group: motors/pumps/appliances 6529, mains/electrical 3755, fans/HVAC 3570, vehicles/engines/saws 1278, alarms/horns/bells/insects 595, DEMAND rooms/outdoor 325
Typical voice lines by harmonic k: k=1: 421, k=2: 99, k=3: 30, k=4: 9

Line prominence (dB over the band median, p10/p50/p90): typical voice 42/51/65, machine 13/19/32, promotable machine 16/23/39

### A1. Window level (1 s): typical clean voice vs machine

voice n = 1164, machine n = 16052. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| corr_mid | > | 0.998 | 0.879 | 99.2% |
| corr_fast * | > | 0.995 | 0.298 | 91.0% |
| mid_fast | > | 0.990 | 0.51 | 92.1% |
| snr * | > | 0.979 | 33.4 | 87.2% |
| hr_fast * | < | 0.973 | 1.54 | 88.5% |
| am_fast * | < | 0.960 | 0.792 | 82.7% |
| hr_mid | < | 0.936 | 2.31 | 51.8% |
| am_std * | < | 0.908 | 2.4 | 62.5% |
| fm_d1 * | < | 0.897 | 12.7 | 69.6% |
| coh_mid | > | 0.892 | 1.64 | 67.1% |
| fm_fast * | < | 0.890 | 13.8 | 63.7% |
| am_mid | < | 0.888 | 1.28 | 49.0% |
| fm_std * | < | 0.752 | 26.1 | 40.4% |
| fm_slope_abs | > | 0.743 | 0.21 | 9.6% |
| coh_fast | > | 0.651 | 1.26 | 54.7% |
| h21 | > | 0.636 | -31.4 | 1.2% |
| fm2_mid | < | 0.585 | 15.5 | 23.6% |
| fm_mid | > | 0.541 | 1.82 | 16.1% |

### A2. Line level: typical clean voice lines (all hold windows) vs machine lines (first <= 5 windows)

voice n = 559, machine n = 1881. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| corr_mid | > | 0.997 | 0.901 | 99.2% |
| pcorr_mid | > | 0.997 | 0.802 | 99.2% |
| corr_fast * | > | 0.996 | 0.348 | 96.4% |
| mid_fast | > | 0.988 | 0.575 | 93.5% |
| snr * | > | 0.986 | 32.5 | 90.2% |
| hr_fast * | < | 0.984 | 1.46 | 94.4% |
| am_fast * | < | 0.978 | 0.836 | 89.1% |
| hr_mid | < | 0.970 | 1.89 | 81.6% |
| am_std * | < | 0.960 | 2.12 | 84.2% |
| am_mid | < | 0.947 | 1.34 | 62.6% |
| fm_d1 * | < | 0.935 | 12.7 | 81.4% |
| fm_fast * | < | 0.929 | 13.8 | 76.0% |
| coh_mid | > | 0.879 | 1.66 | 64.6% |
| pcoh_mid | > | 0.873 | 1.85 | 64.4% |
| fm_std * | < | 0.852 | 23.3 | 60.4% |
| fm2_mid | < | 0.691 | 14.7 | 32.1% |
| coh_fast | > | 0.662 | 1.21 | 54.7% |
| h21 | > | 0.606 | -31.6 | 0.6% |
| fm_slope_abs | > | 0.597 | 0.74 | 8.7% |
| fm_mid | < | 0.591 | 14.5 | 23.5% |

### A3. Line level, PROMOTABLE machine lines only (span >= 5 s, duty >= 0.9)

voice n = 559, machine n = 229. AUC in the voice-like direction; threshold keeps 99% of these voice rows; recall = machine rows then called machine. `*` = recording-quality-confounded (see text).

| feature | voice-like | AUC | thr | machine recall |
|---|---|---|---|---|
| corr_mid | > | 0.998 | 0.901 | 99.6% |
| pcorr_mid | > | 0.998 | 0.802 | 99.6% |
| corr_fast * | > | 0.997 | 0.348 | 98.3% |
| mid_fast | > | 0.990 | 0.575 | 98.3% |
| coh_mid | > | 0.965 | 1.66 | 79.9% |
| pcoh_mid | > | 0.954 | 1.85 | 80.3% |
| snr * | > | 0.944 | 32.5 | 75.5% |
| hr_fast * | < | 0.915 | 1.46 | 79.0% |
| am_fast * | < | 0.900 | 0.836 | 67.2% |
| fm_slope_abs | > | 0.897 | 0.74 | 33.6% |
| hr_mid | < | 0.865 | 1.89 | 56.3% |
| am_std * | < | 0.799 | 2.12 | 52.4% |
| coh_fast | > | 0.785 | 1.21 | 64.2% |
| am_mid | < | 0.783 | 1.34 | 23.6% |
| fm_d1 * | < | 0.778 | 12.7 | 54.1% |
| fm_fast * | < | 0.771 | 13.8 | 47.6% |
| fm_mid | > | 0.728 | 1.89 | 30.1% |
| h21 | > | 0.660 | -31.6 | 2.6% |
| fm_std * | < | 0.592 | 23.3 | 27.5% |
| fm2_mid | > | 0.523 | 1.87 | 30.6% |

### A4. Machine noise floor vs line prominence (window level; p10/p50/p90)

| prominence dB | machine windows | fm_mid c | coh_mid c | corr_mid | voice windows | voice fm_mid | voice corr_mid |
|---|---|---|---|---|---|---|---|
| 0-15 | 2445 | 3.5/7.8/25 | -6.2/0.54/6.7 | -0.29/0.015/0.32 | 0 | - | - |
| 15-20 | 4715 | 2.4/6/22 | -6.3/0.38/5.9 | -0.3/0.0095/0.33 | 0 | - | - |
| 20-25 | 3864 | 2/5.8/19 | -5.5/0.31/5.8 | -0.3/0.01/0.37 | 1 | 6.1/6.1/6.1 | 0.99/0.99/0.99 |
| 25-30 | 2191 | 1.4/4.2/13 | -4.3/0.33/5.1 | -0.31/0.028/0.38 | 2 | 7.3/8.5/9.7 | 0.76/0.86/0.96 |
| 30-40 | 2063 | 0.34/1.5/9.2 | -3.1/0.1/4 | -0.33/0.029/0.43 | 68 | 4.2/5.7/10 | 0.96/0.99/1 |
| 40-50 | 507 | 0.22/0.67/3.2 | -1.1/0.046/1.2 | -0.35/0.011/0.42 | 432 | 3.9/6.7/11 | 0.97/1/1 |
| 50-99 | 267 | 0.013/0.27/3.3 | -0.89/-0.0064/0.68 | -0.37/-0.054/0.33 | 661 | 3.1/5.2/8.8 | 0.98/1/1 |

### B. Typical voice lines with white noise added (SNR vs the held-segment RMS) — matched-prominence check

Thresholds from A2 (clean voice, 99 % kept). Voice kept = fraction of voice lines still on the voice side.

| condition | voice lines | prominence p10/p50/p90 | pcorr_mid kept | corr_mid kept | pcoh_mid kept | AUC pcorr vs machine | AUC pcoh |
|---|---|---|---|---|---|---|---|
| clean | 559 | 42/51/65 | 98.9% | 98.9% | 98.9% | 0.997 | 0.873 |
| +20 dB | 561 | 33/42/52 | 97.5% | 96.4% | 98.8% | 0.995 | 0.871 |
| +10 dB | 546 | 25/35/44 | 90.1% | 83.2% | 96.7% | 0.973 | 0.856 |
| +0 dB | 501 | 17/27/35 | 67.7% | 53.9% | 95.2% | 0.946 | 0.840 |

#### B2. Operating point keeping 99 % of typical voice lines over clean + every degradation (pooled)

| feature | thr | voice kept clean / +20 / +10 / +0 | machine recall | promotable machine recall |
|---|---|---|---|---|
| pcorr_mid | -0.14 | 99.8% / 99.8% / 98.7% / 97.4% | 19.4% | 6.6% |
| corr_mid | -0.14 | 99.8% / 99.8% / 98.7% / 97.4% | 20.1% | 9.6% |
| pcoh_mid | -2.57 | 99.8% / 99.8% / 98.9% / 97.2% | 26.4% | 8.7% |
| coh_mid | -2.24 | 99.8% / 99.8% / 98.9% / 97.2% | 25.6% | 10.5% |
| mid_fast | 0.285 | 100.0% / 100.0% / 100.0% / 95.6% | 63.6% | 82.1% |

### C. Small combinations — grouped 5-fold CV logistic regression on line-level features, out-of-fold scores

Voice training/eval set = typical voice lines, clean + white-noise-degraded (so the model cannot learn 'clean = voice'); operating point keeps 99 % of those voice lines. Confounded features excluded except in the last row (shown for reference).

| features | AUC | machine recall | promotable recall | voice kept clean / degraded |
|---|---|---|---|---|
| pcorr_mid | 0.977 | 18.9% | 7.4% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid | 0.978 | 14.5% | 6.1% | 99.8% / 98.7% |
| pcorr_mid+fm_mid+fm2_mid | 0.977 | 21.2% | 8.3% | 99.8% / 98.7% |
| pcorr_mid+pcoh_mid+mid_fast | 0.986 | 78.1% | 87.8% | 100.0% / 98.6% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast | 0.986 | 76.8% | 86.9% | 100.0% / 98.6% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs | 0.989 | 81.7% | 82.5% | 100.0% / 98.6% |
| pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs+snr+am_fast+fm_fast+corr_fast+hr_fast (confounded) | 0.990 | 84.3% | 86.5% | 99.8% / 98.7% |

### D. Machine recall by class — pcorr_mid alone (threshold keeps 99 % of clean+degraded typical voice lines)

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 17.5% |
| vehicles/engines/saws | 476 | 109 | 22.9% |
| alarms/horns/bells/insects | 265 | 105 | 24.2% |
| fans/HVAC | 257 | 59 | 14.0% |
| mains/electrical | 186 | 32 | 15.6% |
| DEMAND rooms/outdoor | 40 | 5 | 27.5% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 18.3% |
| mixed | 680 | 195 | 20.7% |
| intermittent-tonal | 149 | 36 | 19.5% |
| broadband | 25 | 13 | 24.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 16.3% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 19.7% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 6.6% called machine

### D. Machine recall by class — best non-confounded combination (pcorr_mid+pcoh_mid+fm_mid+fm2_mid+mid_fast+am_mid+hr_mid+h21+fm_slope_abs)

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 82.8% |
| vehicles/engines/saws | 476 | 109 | 80.5% |
| alarms/horns/bells/insects | 265 | 105 | 80.8% |
| fans/HVAC | 257 | 59 | 84.8% |
| mains/electrical | 186 | 32 | 76.9% |
| DEMAND rooms/outdoor | 40 | 5 | 87.5% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 82.6% |
| mixed | 680 | 195 | 81.6% |
| intermittent-tonal | 149 | 36 | 79.2% |
| broadband | 25 | 13 | 64.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 84.4% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 72.7% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 82.5% called machine

### E. synthetic held notes (suite synth.mjs, clean): lines on the voice side of the B2 thresholds

| feature | thr | lines kept as voice |
|---|---|---|
| pcorr_mid | -0.14 | 100.0% (n=364) |
| corr_mid | -0.14 | 99.7% (n=364) |
| pcoh_mid | -2.57 | 100.0% (n=364) |

synthetic by scenario family (pcorr_mid kept): synthetic_dynamics 100% (n=14), synthetic_repeat 100% (n=180), synthetic_steady 100% (n=156), synthetic_vowelchange 100% (n=14)

### E. clinical / atypical real voice (PVQD severity >= 20, VOICED pathological), clean: lines on the voice side of the B2 thresholds

| feature | thr | lines kept as voice |
|---|---|---|
| pcorr_mid | -0.14 | 100.0% (n=352) |
| corr_mid | -0.14 | 100.0% (n=352) |
| pcoh_mid | -2.57 | 100.0% (n=352) |
