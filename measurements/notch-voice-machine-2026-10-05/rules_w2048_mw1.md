evidence floor: >= 1 window(s) per line (dropped 0 voice / 0 machine lines)

# Explicit 'confidently machine' rules (voice_w2048 / noise_w2048)

voice lines (typical, clean + degradations) 2162; machine lines 1881 (promotable 229)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | -0.237 | 154 | 12.0% | 5.2% | 0.2% / 0.0% / 0.7% / 1.4% | 12.4% | 0.97% |
| pcoh_mid / fm_fast | -3.13 | 154 | 14.0% | 4.8% | 0.2% / 0.0% / 0.4% / 2.0% | 16.9% | 1.71% |
| pcorr_mid / noise2 | 0.34 | 5.57 | 29.9% | 50.7% | 0.2% / 0.5% / 1.5% / 1.6% | 29.9% | 1.25% |
| pcoh_mid / noise2 | 1.26 | 6.52 | 30.7% | 53.7% | 0.4% / 0.4% / 1.5% / 1.8% | 31.7% | 1.53% |
| pcorr_mid / none | -0.237 | inf | 12.0% | 5.2% | 0.2% / 0.0% / 0.7% / 1.4% | 12.3% | 0.74% |
| pcoh_mid / none | -3.13 | inf | 14.0% | 4.8% | 0.2% / 0.0% / 0.4% / 2.0% | 15.5% | 0.83% |
| (pcorr_mid < A OR pcoh_mid < 1.2 c) / noise2 | 0.0999 | 6.36 | 30.5% | 52.4% | 0.4% / 0.5% / 1.5% / 1.6% | 32.4% | 1.85% |

## Machine lines called machine by class — pcoh_mid < 1.26 AND noise2 < 6.52

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 34.7% |
| vehicles/engines/saws | 476 | 109 | 27.7% |
| alarms/horns/bells/insects | 265 | 105 | 22.3% |
| fans/HVAC | 257 | 59 | 23.7% |
| mains/electrical | 186 | 32 | 46.2% |
| DEMAND rooms/outdoor | 40 | 5 | 30.0% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 37.0% |
| mixed | 680 | 195 | 22.4% |
| intermittent-tonal | 149 | 36 | 25.5% |
| broadband | 25 | 13 | 32.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 39.5% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 22.4% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 53.7% called machine
- promotable stationary-tonal: 178 lines, 58.4% called machine
- promotable intermittent-tonal: 6 lines, 16.7% called machine

machine lines NOT called machine: 1303 — noise proxy >= B (undecided, falls back to timing): 1044; shared modulation >= A at low noise (machine looks voice-like): 259
voice-like machine lines by group: motors/pumps/appliances 85, vehicles/engines/saws 75, alarms/horns/bells/insects 39, mains/electrical 30, fans/HVAC 21, DEMAND rooms/outdoor 9

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 44 of 364 lines (12.1%); by family synthetic_dynamics 0/14, synthetic_repeat 25/180, synthetic_steady 19/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 352 lines (0.0%)

## The rule on the mixes

