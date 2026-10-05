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

## Machine lines called machine by class — (pcorr_mid < 0.152 OR pcoh_mid < 2.2 c) AND noise2 < 50.6

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 439 | 137 | 89.7% |
| vehicles/engines/saws | 193 | 62 | 83.9% |
| fans/HVAC | 174 | 57 | 90.2% |
| mains/electrical | 146 | 30 | 81.5% |
| alarms/horns/bells/insects | 103 | 59 | 80.6% |
| DEMAND rooms/outdoor | 16 | 4 | 87.5% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 663 | 212 | 88.8% |
| mixed | 346 | 108 | 83.8% |
| intermittent-tonal | 62 | 29 | 80.6% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 301 lines, 89.0% called machine
- drifting lines (p5-p95 > 4 Hz): 69 lines, 79.7% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 93.4% called machine
- promotable stationary-tonal: 178 lines, 93.3% called machine
- promotable intermittent-tonal: 6 lines, 100.0% called machine

machine lines NOT called machine: 142 — noise proxy >= B (undecided, falls back to timing): 1; shared modulation >= A at low noise (machine looks voice-like): 141
voice-like machine lines by group: motors/pumps/appliances 45, vehicles/engines/saws 31, mains/electrical 27, alarms/horns/bells/insects 19, fans/HVAC 17, DEMAND rooms/outdoor 2

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 181 of 364 lines (49.7%); by family synthetic_dynamics 0/14, synthetic_repeat 96/180, synthetic_steady 85/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 137 lines (0.0%)

## The rule on the mixes

