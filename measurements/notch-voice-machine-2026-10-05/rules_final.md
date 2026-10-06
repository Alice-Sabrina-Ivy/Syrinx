evidence floor: >= 3 window(s) per line (dropped 1575 voice / 810 machine lines)

# Explicit 'confidently machine' rules (voice_deg / noise)

voice lines (typical, clean + degradations) 592; machine lines 1071 (promotable 229)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | 0.152 | 208 | 81.9% | 84.3% | 0.0% / 0.7% / 0.0% / 1.4% | 84.2% | 0.68% |
| pcoh_mid / fm_fast | 2.37 | 208 | 73.9% | 83.0% | 0.0% / 0.7% / 0.0% / 1.4% | 75.1% | 1.35% |
| pcorr_mid / noise2 | 0.152 | 50.6 | 81.9% | 84.3% | 0.0% / 0.7% / 0.0% / 1.4% | 84.2% | 0.68% |
| pcoh_mid / noise2 | 2.37 | 50.6 | 73.9% | 83.0% | 0.0% / 0.7% / 0.0% / 1.4% | 75.2% | 1.35% |
| pcorr_mid / none | 0.152 | inf | 82.0% | 84.3% | 0.0% / 0.7% / 0.0% / 1.4% | 84.3% | 0.68% |
| pcoh_mid / none | 2.37 | inf | 73.9% | 83.0% | 0.0% / 0.7% / 0.0% / 1.4% | 75.2% | 1.35% |
| (pcorr_mid < A OR pcoh_mid < 2.2 c) / noise2 | 0.152 | 50.6 | 86.7% | 93.4% | 0.0% / 0.7% / 0.0% / 1.4% | 88.7% | 1.35% |
| FIXED (pcorr_mid < 0.152 OR pcoh_mid < 1 c) / noise2 < 1e+09 | 0.152 | 1e+09 | 84.0% | 90.0% | 0.0% / 0.7% / 0.0% / 1.4% (3 of 592) | - | - |

## Machine lines called machine by class — (pcorr_mid < 0.152 OR pcoh_mid < 1 c) AND noise2 < 1e+09

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 439 | 137 | 86.6% |
| vehicles/engines/saws | 193 | 62 | 82.4% |
| fans/HVAC | 174 | 57 | 87.9% |
| mains/electrical | 146 | 30 | 79.5% |
| alarms/horns/bells/insects | 103 | 59 | 75.7% |
| DEMAND rooms/outdoor | 16 | 4 | 87.5% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 663 | 212 | 86.1% |
| mixed | 346 | 108 | 80.9% |
| intermittent-tonal | 62 | 29 | 79.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 301 lines, 86.4% called machine
- drifting lines (p5-p95 > 4 Hz): 69 lines, 75.4% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 90.0% called machine
- promotable stationary-tonal: 178 lines, 89.3% called machine
- promotable intermittent-tonal: 6 lines, 100.0% called machine

machine lines NOT called machine: 171 — noise proxy >= B (undecided, falls back to timing): 0; shared modulation >= A at low noise (machine looks voice-like): 171
voice-like machine lines by group: motors/pumps/appliances 59, vehicles/engines/saws 34, mains/electrical 30, alarms/horns/bells/insects 25, fans/HVAC 21, DEMAND rooms/outdoor 2

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 12 of 364 lines (3.3%); by family synthetic_dynamics 0/14, synthetic_repeat 6/180, synthetic_steady 6/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 137 lines (0.0%)

## The rule on the mixes

- **held_series** (real VocalSet same-pitch hold series, gaps 0.15-1 s): 210 voice lines / 98 streams, median 2 windows per line: **0.0% called machine** (lines with >= 5 windows: 0.0% of 55)

| voice_in_noise | lines | prominence p50 | called machine | undecided (noise >= B) |
|---|---|---|---|---|
| SNR +0: voice lines (held-program harmonics) | 238 | 27 | 1.7% (3.9% of 102 with >= 3 win) | 0.0% |
| - program clinical | 99 | 27 | 3.0% (8.1% of 37 with >= 3 win) | 0.0% |
| - program held_series | 115 | 28 | 0.9% (2.0% of 51 with >= 3 win) | 0.0% |
| - program sing | 1 | 45 | 0.0% (nan% of 0 with >= 3 win) | 0.0% |
| - program sustained_a | 23 | 23 | 0.0% (0.0% of 14 with >= 3 win) | 0.0% |
| SNR +0: machine lines, first <= 5 lead-phase windows | 1110 | 20 | 67.7% (89.3% of 842 with >= 3 win) | 0.0% |
| SNR +0: machine lines, first <= 5 voice-phase windows | 743 | 20 | 70.5% (84.0% of 624 with >= 3 win) | 0.0% |
| SNR +10: voice lines (held-program harmonics) | 274 | 36 | 0.0% (0.0% of 116 with >= 3 win) | 0.0% |
| - program clinical | 110 | 36 | 0.0% (0.0% of 39 with >= 3 win) | 0.0% |
| - program held_series | 136 | 37 | 0.0% (0.0% of 64 with >= 3 win) | 0.0% |
| - program sing | 1 | 49 | 0.0% (nan% of 0 with >= 3 win) | 0.0% |
| - program sustained_a | 27 | 29 | 0.0% (0.0% of 13 with >= 3 win) | 0.0% |
| SNR +10: machine lines, first <= 5 lead-phase windows | 1099 | 20 | 68.2% (89.2% of 840 with >= 3 win) | 0.0% |
| SNR +10: machine lines, first <= 5 voice-phase windows | 672 | 21 | 61.9% (82.9% of 502 with >= 3 win) | 0.0% |

| noise_gated (R8 adversary on real sources) | lines | called machine (first 5 windows) | called machine (on-windows only) |
|---|---|---|---|
| off 0.15 s every 5 s | 401 | 61.6% (83.7% of 295 with >= 3 win) | 66.3% (91.0% of 288 with >= 3 win) |
| off 0.15 s every 8 s | 410 | 65.4% (89.0% of 301 with >= 3 win) | 66.1% (90.6% of 297 with >= 3 win) |
| off 0.5 s every 5 s | 399 | 63.7% (88.2% of 288 with >= 3 win) | 66.2% (92.3% of 285 with >= 3 win) |
| off 0.5 s every 8 s | 404 | 64.6% (89.7% of 291 with >= 3 win) | 65.8% (92.0% of 289 with >= 3 win) |
| off 1.0 s every 5 s | 404 | 55.4% (82.7% of 271 with >= 3 win) | 61.2% (91.0% of 268 with >= 3 win) |
| off 1.0 s every 8 s | 418 | 62.7% (90.0% of 291 with >= 3 win) | 63.0% (90.0% of 291 with >= 3 win) |
