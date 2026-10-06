evidence floor: >= 5 window(s) per line (dropped 2070 voice / 1313 machine lines)

# Explicit 'confidently machine' rules (voice_deg / noise)

voice lines (typical, clean + degradations) 97; machine lines 568 (promotable 227)

| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |
|---|---|---|---|---|---|---|---|
| pcorr_mid / fm_fast | 0.276 | 188 | 93.7% | 94.3% | 0.0% / 0.0% / 0.0% / 0.0% | 94.4% | 0.00% |
| pcoh_mid / fm_fast | 2.97 | 188 | 81.7% | 85.5% | 0.0% / 0.0% / 0.0% / 0.0% | 81.5% | 0.00% |
| pcorr_mid / noise2 | 0.276 | 45.9 | 93.7% | 94.3% | 0.0% / 0.0% / 0.0% / 0.0% | 94.4% | 0.00% |
| pcoh_mid / noise2 | 2.97 | 45.9 | 81.7% | 85.5% | 0.0% / 0.0% / 0.0% / 0.0% | 81.5% | 0.00% |
| pcorr_mid / none | 0.276 | inf | 93.8% | 94.3% | 0.0% / 0.0% / 0.0% / 0.0% | 94.5% | 0.00% |
| pcoh_mid / none | 2.97 | inf | 81.9% | 85.5% | 0.0% / 0.0% / 0.0% / 0.0% | 81.7% | 0.00% |
| (pcorr_mid < A OR pcoh_mid < 3 c) / noise2 | 0.276 | 45.9 | 96.7% | 98.2% | 0.0% / 0.0% / 0.0% / 0.0% | 96.5% | 0.00% |

## Machine lines called machine by class — (pcorr_mid < 0.276 OR pcoh_mid < 3 c) AND noise2 < 45.9

| mgroup | lines | clips | called machine |
|---|---|---|---|
| motors/pumps/appliances | 271 | 80 | 97.4% |
| fans/HVAC | 152 | 55 | 98.0% |
| mains/electrical | 120 | 30 | 93.3% |
| vehicles/engines/saws | 14 | 3 | 100.0% |
| DEMAND rooms/outdoor | 11 | 4 | 90.9% |

| label | lines | clips | called machine |
|---|---|---|---|
| stationary-tonal | 356 | 95 | 97.8% |
| mixed | 189 | 69 | 96.3% |
| intermittent-tonal | 23 | 8 | 82.6% |

- mains-locked lines (k x 50/60 Hz +-0.5 Hz): 202 lines, 96.5% called machine
- drifting lines (p5-p95 > 4 Hz): 26 lines, 88.5% called machine
- promotable lines (span >= 5 s, duty >= 0.9): 227 lines, 98.2% called machine
- promotable stationary-tonal: 178 lines, 97.8% called machine
- promotable intermittent-tonal: 6 lines, 100.0% called machine

machine lines NOT called machine: 19 — noise proxy >= B (undecided, falls back to timing): 1; shared modulation >= A at low noise (machine looks voice-like): 18
voice-like machine lines by group: mains/electrical 8, motors/pumps/appliances 6, fans/HVAC 3, DEMAND rooms/outdoor 1

## Supplements (clean): voice lines called machine by the rule

- synthetic suite holds (synth.mjs): 198 of 364 lines (54.4%); by family synthetic_dynamics 2/14, synthetic_repeat 96/180, synthetic_steady 98/156, synthetic_vowelchange 2/14
- clinical / atypical real voice (PVQD severity >= 20, VOICED pathological): 0 of 11 lines (0.0%)

## The rule on the mixes

