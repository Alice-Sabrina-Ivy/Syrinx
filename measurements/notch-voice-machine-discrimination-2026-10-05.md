# Notch voice-vs-machine line discrimination — DISCRIMINATE phase (DRAFT, 2026-10-05)

> **Follow-up (2026-10-05, CANDIDATE phase):** the shipped use of this feature, and why
> neither the machine-confirmed 5 s promotion nor any breath re-birth survived
> the real-noise oracle, is in
> [noise-notch-voice-discrimination-2026-10-05.md](noise-notch-voice-discrimination-2026-10-05.md).

Branch `notch-voice-discrimination` (notch module = bc42ad0's). **No tuning
change** — this file measures whether a voice line and a machine line can be
told apart directly. Data are the real corpora of
[notch-realdata-corpora-2026-10-05.md](notch-realdata-corpora-2026-10-05.md).
Scripts: `scripts/notch-adversarial/realdata/linefeat*.py`. The generated
tables are copied into
[notch-voice-machine-2026-10-05/](notch-voice-machine-2026-10-05/).
Every number here and in those tables is computed on the public corpora only
(recomputed 2026-10-05; see Reproduce). Results on the private session
recordings are kept outside this repository.

## Question

The persistent-peak notch decides a line is an "interferer" from how stable it
is and from onset and timing context. A held note and a hum are both stable,
narrow lines, so every timing rule protects one kind of held note at the cost
of letting some kind of interferer through.

The hypothesis is that a voice line has its own micro-structure — fast F0
wander, vibrato, tremor, shimmer, and harmonics that move together — while
motors, mains and electronics are mechanically steady over short time spans.
If true, the notch could compute this online and use it to decide promotion.

**Requirement:** keep at least 99 % of real held-voice lines classified as
voice, then measure what fraction of real machine lines are classified as
machine.

## Method

**Lines.** Lines are found exactly where the notch would find them. The tool
is `census.py`'s 1:1 port of `observe()`: 512 ms Hann window, 16384-point FFT,
50–460 Hz, 8× the band median, −26 dB relative floor, narrow at ±5 Hz, 10 Hz
minimum separation. It runs every 100 ms. Lines are tracked with the notch's
3 Hz association and 2 s miss tolerance, and only lines in 80–400 Hz are kept.

- A **voice line** is a track sitting on k × the held segment's F0 (k = 1–8,
  within ±3 %) inside a held segment.
  - Lines with wide vibrato fail the notch's narrowness test, so they are never
    tracked and are not at risk.
  - This is why VocalSet contributes only its straighter holds.
- A **machine line** is any track in a non-speech noise clip. DEMAND rooms with
  talkers are excluded.

**Per-line measurement.** This is online-cheap: per 25 ms chunk and per
tracked line, two windowed DFT bins.

- The line's complex DFT coefficient is taken at the track's causal EMA
  frequency f_ref, using a 64 ms (1024-sample) Hann window ending at each chunk
  boundary, and again on the window one chunk earlier.
- The phase advance gives the instantaneous frequency (IF), unambiguous within
  ±20 Hz. |X| gives the line's amplitude.
- The same is computed at 2 f_ref, the line's own 2nd partial.

**Features.** Each 1 s window (40 IF samples) gives:

- **fast** (> ~8 Hz): the residual after a 5-point (125 ms) moving average.
- **mid** (~0.5–8 Hz: wander, vibrato, tremor): the moving average minus a
  linear trend.
- **`corr_mid` / `coh_mid`:** the mid-band correlation between the line and its
  2f partner, and their shared modulation in cents (signed √cov).
- **Shimmer analogues:** `am_*`.
- **Relative-harmonic-level variation:** `hr_*`.
- **`h21`:** the partner level relative to the line.
- **`snr`:** the line prominence over the band median, in dB, from the notch's
  own FFT.
- **Line level, POOLED across windows:**
  - `pcorr_mid` = Σ cov / √(Σ var₁ Σ var₂)
  - `pcoh_mid` = √(mean cov), in cents

  These are sufficient statistics a notch track can accumulate causally.

**Populations.**

- **Typical real voice:** PVQD with CAPE-V severity < 20, VOICED healthy,
  VocalSet and vocadito. That gives 1 164 windows and 559 lines
  (k = 1: 421, k = 2: 99, k = 3: 30, k = 4: 9).
- **Machine:** 16 052 windows and 1 881 lines from 479 clips. The machine side
  uses each line's first ≤ 5 windows, which is the evidence available around
  the notch's 5 s promotion.
- **Promotable:** span ≥ 5 s and duty ≥ 0.9, 229 lines.
- **Degraded voice:** voice measured again with white noise at +20, +10 and
  0 dB relative to the held-segment RMS.
- **Mixes:** `held_series`, `voice_in_noise` (+10 / 0 dB) and `noise_gated`
  from the data phase, measured the same way.

**Statistics.** AUC is computed per feature. Thresholds keep 99 % of voice
lines. Grouped 5-fold CV uses groups by singer for VocalSet and by clip
otherwise, and it also covers the threshold selection itself.

## 1. A trap first: the voice corpora are 20–30 dB cleaner than the machine lines

Line prominence, p10 / p50 / p90:

| Population | p10 | p50 | p90 |
|---|---|---|---|
| Typical voice | 42 dB | 51 dB | 65 dB |
| Machine | 13 dB | 19 dB | 32 dB |
| Promotable machine | 16 dB | 23 dB | 39 dB |

Several features therefore look excellent for the wrong reason:

| Feature | AUC, window level, clean voice |
|---|---|
| `snr` | 0.979 |
| fast-band AM (`am_fast`) | 0.960 |
| fast-band relative-harmonic level (`hr_fast`) | 0.973 |
| fast FM (`fm_fast`, `fm_d1`) | 0.89–0.90 |

Their direction says the voice is *steadier* than the machine. That is estimation noise
on weak machine lines, not physics. A quiet or distant voice would fail these
features, so they are marked `*` (confounded) in the tables. They are excluded
from every rule below, and the degraded-voice sets exist to expose this
confound.

## 2. The signature that is real: harmonics that move together (shared mid-band FM)

Window level, by line prominence (p10 / p50 / p90):

| prominence | machine `fm_mid` (c) | machine `coh_mid` (c) | machine `corr_mid` | voice `fm_mid` (c) | voice `corr_mid` |
|---|---|---|---|---|---|
| 15–20 dB | 2.4 / 6 / 22 | −6.3 / 0.4 / 5.9 | −0.30 / 0.01 / 0.33 | — | — |
| 30–40 dB | 0.34 / 1.5 / 9.2 | −3.1 / 0.1 / 4 | −0.33 / 0.03 / 0.43 | 4.2 / 5.7 / 10 | 0.96 / 0.99 / 1 |
| 50–99 dB | 0.01 / 0.27 / 3.3 | −0.9 / 0.0 / 0.7 | −0.37 / −0.05 / 0.33 | 3.1 / 5.2 / 8.8 | 0.98 / 1 / 1 |

- **Machine lines.** At every prominence, a machine line has no modulation
  shared with its 2f partner. The median correlation is about 0, even at 50+ dB
  where the IF noise is only about 0.3 c.
- **Voice lines.** A voice line's partials wander together: correlation is
  about 1, with 3–12 c of shared modulation.
- **Fast-band features.** Fast-band jitter and shimmer carry no usable
  separation once the confound is removed.
- **Amplitude micro-variation.** Weaker than the shared-modulation signature.
  The voice has *lower* `am_mid` and `hr_mid` than the machine lines, which
  again reflects the machine's noise.

**Clean, line level** (typical voice, thresholds keep 99 %):

| feature | AUC | machine called machine | promotable called machine |
|---|---|---|---|
| `pcorr_mid` | 0.997 | 99.2 % | 99.6 % |
| `corr_mid` (median of windows) | 0.997 | 99.2 % | 99.6 % |
| `mid_fast` (mid / fast FM ratio) | 0.988 | 93.5 % | 98.3 % |
| `pcoh_mid` | 0.873 | 64.4 % | 80.3 % |
| `fm_mid` alone | 0.59 | 23.5 % | 30.1 % |

`fm_mid` on the line alone does not work, because estimation noise looks like
modulation. It takes the second partial to separate shared modulation from
noise.

## 3. Noise erodes the voice's coherence — with 1 s of evidence the operating point collapses

A typical voice line keeps `pcorr_mid` ≥ the clean 99 % threshold in this
share of cases:

| condition | voice lines kept | voice line prominence p50 |
|---|---|---|
| clean | 98.9 % | 51 dB |
| white noise +20 dB | 97.5 % | 42 dB |
| white noise +10 dB | 90.1 % | 35 dB |
| white noise 0 dB | 67.7 % | 27 dB |

- Keeping 99 % of voice lines pooled over clean plus every degradation, with
  any amount of evidence, pushes the threshold below zero. Then only 16–20 % of
  machine lines, and 4–7 % of promotable ones, are called machine.
- No 2-D noise-gated rule or CV logistic combination of non-confounded
  features fixes this at 1 window (`linefeat_rules.py`, `--minwin=1`).
  - The best CV logistic reaches 82 % machine, but only by keeping 98.6 % of
    degraded voice.
  - A 128 ms DFT window is worse at every evidence level.

## 4. Evidence accumulation is the lever

The single-window voice lines carry nearly all the hard cases. Most failures
are short holds whose single 1 s window straddles a gap or onset. Requiring N
pooled windows per line before deciding gives the following.

Machine called machine; voice error pooled over clean, +20, +10 and 0 dB:

| evidence ≥ | voice lines | machine lines | `pcorr_mid` thr | machine called (CV) | promotable | voice called machine, CV |
|---|---|---|---|---|---|---|
| 1 window | 2 167 | 1 881 | −0.17 | 15.2 % | 3.5 % | 0.88 % |
| 2 windows | 1 238 | 1 366 | 0.152 | 78.7 % | 84.7 % | 0.81 % |
| **3 windows** | 592 | 1 071 | 0.152 | **84.3 %** | 84.3 % | **0.68 %** |
| 5 windows | 97 | 568 | 0.276 | 94.5 % | 94.3 % | 0.00 % (n = 97, too few) |

**Recommended rule for the next phase:**

> machine iff ≥ 3 s of pooled evidence AND (`pcorr_mid` < 0.15 OR `pcoh_mid` < 1 c)

- The 1 c shared-modulation floor was chosen *a priori*, not fitted. Apart
  from the three misclassified lines below, no real voice line with ≥ 3
  windows has less than 2.3 c of shared modulation (p0.5 = 2.34 c). Mains
  grid wander, ballasts and transformers sit at 0.2–0.9 c, coherent but tiny.
- **Machine:** 84.0 % called machine (promotable 90.0 %).
- **Voice:** 3 of 592 voice lines called machine (0.51 %, Wilson 95 % CI
  0.17–1.48 %).
  - By condition: clean 0.0 %, +20 dB 0.7 %, +10 dB 0.0 %, 0 dB 1.4 %.
  - All three are one VocalSet singer's straight-tone /i/ at 270 Hz: 3 c of
    modulation, with H2 at −18 dB.
  - The ≥ 3-window voice set comes from only 120 clips: PVQD 59, VOICED 38,
    VocalSet 23.

By class (machine lines with ≥ 3 windows):

| class | lines | clips | called machine |
|---|---|---|---|
| motors / pumps / appliances | 439 | 137 | 86.6 % |
| fans / HVAC | 174 | 57 | 87.9 % |
| vehicles / engines / saws | 193 | 62 | 82.4 % |
| mains / electrical | 146 | 30 | 79.5 % |
| alarms / horns / bells / insects | 103 | 59 | 75.7 % |
| census stationary-tonal | 663 | 212 | 86.1 % |
| census intermittent-tonal | 62 | 29 | 79.0 % |
| census mixed | 346 | 108 | 80.9 % |
| mains-locked lines (k × 50/60 Hz ± 0.5) | 301 | — | 86.4 % |
| drifting lines (p5–p95 > 4 Hz) | 69 | — | 75.4 % |
| promotable stationary-tonal | 178 | — | 89.3 % |
| promotable intermittent-tonal | 6 | — | 6 / 6 |

**Machines that look like a voice** (171 lines). These have real shared
modulation of 2–27 c, so the hypothesis "machines are mechanically steady" is
false for them:

- combustion engines, chainsaws and helicopters (speed variation);
- fridge compressors;
- church bells and sirens;
- "electronics whine";
- several mains-hum recordings, including freesound 438501. That clip is the
  data phase's R8-pattern electrical buzz: 4 c of coherent modulation on every
  harmonic.

## 5. End-to-end mixes (same rule, ≥ 3 windows)

| stream set | lines (≥ 3 windows) | called machine |
|---|---|---|
| held_series, real VocalSet same-pitch hold series (gaps 0.15–1 s) — all lines | 210 | **0.0 %** (≥ 5 windows: 0 / 55; CI ≤ 1.8 %) |
| voice_in_noise +10 dB, voice lines | 116 | **0.0 %** (CI ≤ 3.2 %) |
| voice_in_noise +10 dB, machine lines, lead / during voice | 840 / 502 | 89.2 % / 82.9 % |
| voice_in_noise **0 dB**, voice lines | 102 | **3.9 %** (CI 1.5–9.7 %); clinical program 3 / 37, held_series 1 / 51 |
| voice_in_noise 0 dB, machine lines, lead / during voice | 842 / 624 | 89.3 % / 84.0 % |
| noise_gated (R8 adversary, real sources) | 271–301 per cell | 82.7–90.0 % (on-windows only 90–92 %) |

The 0 dB voice failures sit in strong real tonal noise: engine idle, an
electric motor, an air conditioner. In the engine-idle case, a machine line
18–20 Hz away falls inside the 64 ms window's ±31 Hz main lobe and beats with
the voice partial. That is a structural limit of this estimator, not a
threshold choice. In the other cases no machine line is that close; presumably
broadband engine or motor noise at the partial lowers the IF SNR (not
verified).

## 6. Supplements

- **Clinical / atypical voice** (PVQD severity ≥ 20, pathological VOICED):
  0 / 137 called machine. Pathological jitter only helps.
- **The adversarial suite's synthetic holds** (`synth.mjs`): 12 / 364 called
  machine (3.3 %).
  - The cause is the `steady` scenarios, which have 0 c wander and only 0.5 %
    cycle jitter. They carry a median of 1.5 c shared modulation, below every
    real voice measured.
  - **The suite cannot validate this rule until its synthetic voice carries
    realistic wander.** In the real data, the p1 shared modulation over ≥ 3
    windows is 2.4 c and the median is about 6 c.
- **The private session recordings.** Results on the private session
  recordings are kept outside this repository.
- **128 ms DFT window** (`--win=2048`): worse at every evidence level. At
  3 windows, the CV result for `pcorr_mid` alone is 38 % and for the
  3-threshold rule 62.5 %. Keep 64 ms.

## Verdict (honest)

**There is a real, physical, large-margin feature: shared mid-band frequency
modulation across a line's partials (`pcorr_mid` / `pcoh_mid`).**

- Voice harmonics wander together by 2–12 c. Steady machine lines show no
  shared wander, at any SNR.
- On clean recordings it separates almost perfectly (AUC 0.997).
- With ≥ 3 s of pooled evidence, a simple causal rule calls 84 % of real
  machine lines (90 % of promotable ones) machine. It misclassifies ≤ 1 % of
  real held-voice lines through +10 dB noise, and 0 / 210 real repeated-hold
  series lines. This is exactly the family bc42ad0 blanks.
- It is cheap online: two windowed DFT bins per tracked line per 25 ms chunk,
  about 2 × 1024 complex multiply-adds per line (about 25 k for 12 tracks), plus
  three running sums per track. That is negligible next to the AC detector.

**It is not good enough to drive notch promotion alone:**

1. **Strong noise.** At 0 dB voice-to-noise in strong real tonal noise, 3.9 %
   of voice lines with enough evidence look machine-like (CI up to about 10 %).
   The notch would then cut a held note around 5 s.
2. **Machines that wander like voices.** About 15 % of real machine lines carry
   coherent wander like a voice and would never be notched: engines,
   compressors, bells and sirens, some mains buzz including the one real
   R8-pattern clip.
3. **Thin evidence on long holds.** The population most at risk — real holds
   of 5–20 s — is thinly sampled: 97 line-conditions.
   The ≥ 3-window voice set comes from 120 clips, mostly clinical /a/.
4. **Under 3 s, nothing separates.** Below about 3 s of evidence there is no
   usable separation, so the feature cannot speed up the 5 s promotion.

**Proposal for the next phase** (to be measured end-to-end with the real
worker, not adopted on these numbers): use coherence as a third state on top
of bc42ad0's timing rules, not as a replacement.

| state | condition (over ≥ 3 s pooled) | effect |
|---|---|---|
| voice-confirmed | `pcorr` ≥ ~0.5 AND `pcoh` ≥ ~2 c | block promotion. Protects repeated holds, glides and speech-into-hold. Cost: the about 15 % FM-coherent machines stay un-notched. |
| machine-confirmed | `pcorr` < 0.15 OR `pcoh` < 1 c | allow the 5 s clock even for onset-born or re-born tracks. Fixes switch-on and R8-intermittent sources (82–90 % of real gated sources classified). Cost: a held note in ≤ 0 dB tonal noise may be notched early. |
| otherwise | — | today's timing rules. |

Prerequisites: the synthetic suite's voices need realistic wander, and real
long holds (≥ 5 s) need to be recorded.

## Reproduce (repo root)

```bash
R=scripts/notch-adversarial/realdata
python $R/linefeat.py --kind=voice --degrade=white:20,10,0 --out=deg --jobs=5   # -> build/notchvd/linefeat/voice_deg.csv
python $R/linefeat.py --kind=noise --jobs=5                                     # -> noise.csv
for s in held_series voice_in_noise noise_gated; do python $R/linefeat.py --kind=mix --set=$s --jobs=5; done
python $R/linefeat.py --kind=voice --degrade=white:20,10,0 --win=2048 --out=w2048 --jobs=5   # window-length check
python $R/linefeat.py --kind=noise --win=2048 --out=w2048 --jobs=5
python $R/linefeat_analyze.py --voice=voice_deg --out=report_deg                # sections 1-3, AUC tables
python $R/linefeat_analyze.py --voice=voice_w2048 --noise=noise_w2048 --out=report_w2048
for mw in 1 2 3 5; do python $R/linefeat_rules.py --voice=voice_deg --minwin=$mw --out=rules_w1024_mw$mw --mixtag=_none; done
python $R/linefeat_rules.py --voice=voice_w2048 --noise=noise_w2048 --minwin=1 --out=rules_w2048_mw1 --mixtag=_none   # and --minwin=3 --out=rules_w2048_mw3
python $R/linefeat_rules.py --voice=voice_deg --minwin=3 --force=pcorr_mid,pcoh_mid,noise2 --fixed=0.152,1.0,1e9 --out=rules_final   # sections 4-6
```

The committed tables (recomputed 2026-10-05) use only the public-source rows
of the cached per-line features, with the commands above. A build without the
opt-in `sessions` source (`fetch_voice.py` default) gives the same rows:
features are computed and seeded per clip id.
The `voice_in_noise` rows cover the 784 data-phase streams whose voice program
is public; a public-only rebuild draws the `other` programs afresh, so those
rows can differ slightly. The `rules_*` files also carry the "Supplements"
section the current `linefeat_rules.py` prints.

Runtime: about 10 min per corpus with 5 workers; mixes about 25 min.
