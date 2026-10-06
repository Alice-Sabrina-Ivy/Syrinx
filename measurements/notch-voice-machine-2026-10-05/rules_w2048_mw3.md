evidence floor: >= 3 window(s) per line (dropped 1570 voice / 810 machine lines)

# Explicit 'confidently machine' rules (voice_w2048 / noise_w2048)

voice lines (typical, clean + degradations) 592; machine lines 1071 (promotable 229)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | -0.102 | 154 | 26.1% | 20.1% | 0.0% / 0.0% / 0.0% / 1.4% | 38.1% | 0.51% |
| pcoh_mid / fm_fast | 2.19 | 3.76 | 24.8% | 42.8% | 0.0% / 0.0% / 0.0% / 1.4% | 35.9% | 0.51% |
| pcorr_mid / noise2 | 0.334 | 7.87 | 51.4% | 61.6% | 0.7% / 0.0% / 0.7% / 1.4% | 58.6% | 1.18% |
| pcoh_mid / noise2 | 2.19 | 8.82 | 56.1% | 70.7% | 0.0% / 0.0% / 0.7% / 1.4% | 59.3% | 0.68% |
| pcorr_mid / none | -0.102 | inf | 26.1% | 20.1% | 0.0% / 0.0% / 0.0% / 1.4% | 38.1% | 0.51% |
| pcoh_mid / none | -1.77 | inf | 24.0% | 8.3% | 0.0% / 0.0% / 0.0% / 1.4% | 35.9% | 0.51% |
| (pcorr_mid < A OR pcoh_mid < 2.2 c) / noise2 | 0.0703 | 8.82 | 56.5% | 70.7% | 0.0% / 0.0% / 0.7% / 1.4% | 62.5% | 1.01% |

## Machine lines called machine by class — (pcorr_mid < 0.0703 OR pcoh_mid < 2.2 c) AND noise2 < 8.82

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 439 | 137 | 60.8% |
| vehicles/engines/saws | 193 | 62 | 51.8% |
| fans/HVAC | 174 | 57 | 44.8% |
| mains/electrical | 146 | 30 | 65.1% |
| alarms/horns/bells/insects | 103 | 59 | 52.4% |
| DEMAND rooms/outdoor | 16 | 4 | 68.8% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 663 | 212 | 62.3% |
| mixed | 346 | 108 | 46.2% |
| intermittent-tonal | 62 | 29 | 51.6% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 301 lines, 62.1% called machine
- drifting lines (p5-p95 > 4 Hz): 69 lines, 39.1% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 70.7% called machine
- promotable stationary-tonal: 178 lines, 75.8% called machine
- promotable intermittent-tonal: 6 lines, 33.3% called machine

machine lines NOT called machine: 466 — noise proxy >= B (undecided, falls back to timing): 397; shared modulation >= A at low noise (machine looks voice-like): 69
voice-like machine lines by group: motors/pumps/appliances 24, mains/electrical 15, vehicles/engines/saws 13, fans/HVAC 8, alarms/horns/bells/insects 7, DEMAND rooms/outdoor 2

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 184 of 364 lines (50.5%); by family synthetic_dynamics 0/14, synthetic_repeat 96/180, synthetic_steady 88/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 136 lines (0.0%)

## The rule on the mixes

