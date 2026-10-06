evidence floor: >= 2 window(s) per line (dropped 929 voice / 515 machine lines)

# Explicit 'confidently machine' rules (voice_deg / noise)

voice lines (typical, clean + degradations) 1238; machine lines 1366 (promotable 229)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | 0.152 | 215 | 81.9% | 84.7% | 0.0% / 0.3% / 0.0% / 1.8% | 78.6% | 0.81% |
| pcoh_mid / fm_fast | 1.99 | 215 | 69.9% | 81.7% | 0.6% / 0.9% / 0.6% / 1.8% | 68.2% | 1.29% |
| pcorr_mid / noise2 | 0.152 | 50.6 | 81.9% | 84.7% | 0.0% / 0.3% / 0.0% / 1.8% | 78.6% | 0.81% |
| pcoh_mid / noise2 | 1.99 | 50.6 | 70.0% | 81.7% | 0.6% / 0.9% / 0.6% / 1.8% | 68.3% | 1.29% |
| pcorr_mid / none | 0.152 | inf | 82.0% | 84.7% | 0.0% / 0.3% / 0.0% / 1.8% | 78.7% | 0.81% |
| pcoh_mid / none | 1.99 | inf | 70.0% | 81.7% | 0.6% / 0.9% / 0.6% / 1.8% | 68.3% | 1.29% |
| (pcorr_mid < A OR pcoh_mid < 1.8 c) / noise2 | 0.152 | 50.6 | 85.3% | 92.6% | 0.3% / 0.6% / 0.3% / 1.8% | 82.5% | 1.62% |

## Machine lines called machine by class — (pcorr_mid < 0.152 OR pcoh_mid < 1.8 c) AND noise2 < 50.6

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 520 | 148 | 86.7% |
| vehicles/engines/saws | 295 | 85 | 82.7% |
| fans/HVAC | 194 | 58 | 89.2% |
| alarms/horns/bells/insects | 173 | 83 | 83.2% |
| mains/electrical | 160 | 31 | 82.5% |
| DEMAND rooms/outdoor | 24 | 5 | 87.5% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 816 | 231 | 87.0% |
| mixed | 450 | 144 | 83.1% |
| intermittent-tonal | 97 | 33 | 80.4% |
| broadband | 3 | 2 | 100.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 351 lines, 88.0% called machine
- drifting lines (p5-p95 > 4 Hz): 112 lines, 77.7% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 92.6% called machine
- promotable stationary-tonal: 178 lines, 92.1% called machine
- promotable intermittent-tonal: 6 lines, 100.0% called machine

machine lines NOT called machine: 201 — noise proxy >= B (undecided, falls back to timing): 1; shared modulation >= A at low noise (machine looks voice-like): 200
voice-like machine lines by group: motors/pumps/appliances 69, vehicles/engines/saws 51, mains/electrical 28, alarms/horns/bells/insects 28, fans/HVAC 21, DEMAND rooms/outdoor 3

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 90 of 364 lines (24.7%); by family synthetic_dynamics 0/14, synthetic_repeat 45/180, synthetic_steady 45/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 216 lines (0.0%)

## The rule on the mixes

