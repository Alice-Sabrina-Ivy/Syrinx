evidence floor: >= 1 window(s) per line (dropped 0 voice / 0 machine lines)

# Explicit 'confidently machine' rules (voice_deg / noise)

voice lines (typical, clean + degradations) 2167; machine lines 1881 (promotable 229)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | -0.169 | 255 | 16.0% | 3.5% | 0.2% / 0.0% / 1.3% / 2.0% | 15.2% | 0.88% |
| pcoh_mid / fm_fast | -3.52 | 255 | 19.9% | 3.9% | 0.0% / 0.0% / 0.7% / 2.0% | 18.5% | 0.55% |
| pcorr_mid / noise2 | 0.155 | 8.57 | 28.1% | 45.4% | 0.2% / 0.4% / 1.8% / 1.4% | 29.3% | 1.20% |
| pcoh_mid / noise2 | 0.778 | 10.6 | 26.6% | 47.6% | 0.2% / 0.2% / 1.8% / 1.8% | 27.1% | 1.43% |
| pcorr_mid / none | -0.169 | inf | 16.0% | 3.5% | 0.2% / 0.0% / 1.3% / 2.0% | 15.2% | 0.88% |
| pcoh_mid / none | -3.52 | inf | 20.0% | 3.9% | 0.0% / 0.0% / 0.7% / 2.0% | 18.6% | 0.55% |
| (pcorr_mid < A OR pcoh_mid < 0.75 c) / noise2 | 0.155 | 8.57 | 28.8% | 48.9% | 0.2% / 0.4% / 1.8% / 1.4% | 30.1% | 1.43% |

## Machine lines called machine by class — (pcorr_mid < 0.155 OR pcoh_mid < 0.75 c) AND noise2 < 8.57

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 657 | 169 | 31.1% |
| vehicles/engines/saws | 476 | 109 | 25.8% |
| alarms/horns/bells/insects | 265 | 105 | 24.5% |
| fans/HVAC | 257 | 59 | 19.5% |
| mains/electrical | 186 | 32 | 45.7% |
| DEMAND rooms/outdoor | 40 | 5 | 35.0% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 1027 | 235 | 35.5% |
| mixed | 680 | 195 | 19.6% |
| intermittent-tonal | 149 | 36 | 22.1% |
| broadband | 25 | 13 | 40.0% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 405 lines, 35.8% called machine
- drifting lines (p5-p95 > 4 Hz): 183 lines, 22.4% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 229 lines, 48.9% called machine
- promotable stationary-tonal: 178 lines, 56.2% called machine
- promotable intermittent-tonal: 6 lines, 0.0% called machine

machine lines NOT called machine: 1340 — noise proxy >= B (undecided, falls back to timing): 1149; shared modulation >= A at low noise (machine looks voice-like): 191
voice-like machine lines by group: motors/pumps/appliances 65, vehicles/engines/saws 51, alarms/horns/bells/insects 27, mains/electrical 26, fans/HVAC 18, DEMAND rooms/outdoor 4

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 7 of 364 lines (1.9%); by family synthetic_dynamics 0/14, synthetic_repeat 3/180, synthetic_steady 4/156, synthetic_vowelchange 0/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 352 lines (0.0%)

## The rule on the mixes

