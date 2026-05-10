# Vocal weight — published acoustic correlates literature review

**Date:** 2026-05-09
**Companion to:** `measurements/vocal-weight-audit-2026-05-09.md`
**Scope:** Research-only literature review. Identifies which published acoustic measure(s) best correlate with perceived vocal weight in trans voice training. No code changes; no implementation proposals.

## TL;DR

- **Primary recommendation: CPP (cepstral peak prominence) computed on a long enough window to span multiple phonemes (≥ 1 s LTAS-style aggregation).** It is the only single measure with direct empirical linkage to thyroid-tilt-controlled "phonatory density" — the auditory-perceptual model that maps most cleanly to "vocal weight" as the term is used in trans voice pedagogy (Aaen et al. 2025). It also pairs with spectral tilt as the joint top predictor of perceived vocal effort (McKenna & Stepp 2018) and is a primary discriminator on the modal↔pressed adduction axis (which IS the heaviness axis, per Garellek's review). Caveat: CPP is **not vowel-independent** (Sampaio/Brockmann-Bauser 2021; multiple) — sustained-vowel reference values cannot be transferred to running speech without aggregation. Confounded with SPL.
- **Fallback recommendation: keep an LTAS-based spectral slope (in dB/octave) computed by linear regression over 0–5 kHz on a long-enough window**, OR retain the existing alpha-ratio-style band-energy ratio with explicit attribution to Frokjaer-Jensen & Prytz 1976 and longer aggregation. The current Syrinx metric IS a published measure (alpha ratio); the audit's "uncalibrated/custom" framing was correct that Syrinx hasn't validated it but wrong that it has no published basis.
- **Hardest finding to swallow: the term "vocal weight" has no consensus acoustic correlate published against perceptual ratings of "weight" specifically.** Adjacent constructs — phonatory density (Aaen), vocal effort (McKenna & Stepp, Sluijter & Van Heuven), breathiness (Hillenbrand & Houde), pressedness (CPP), brightness (LeAnn & Claire 2025) — each have validated acoustic correlates, but the trans-voice-training term "vocal weight" is a pedagogical compound of several. Using a single measure inevitably inherits one of these adjacent definitions.
- **Subjective-rating calibration is the only path to "vocal weight as a directly-validated construct."** Without per-user or population-level perceptual rating anchors, any acoustic-only meter will be reporting a proxy.
- **Hardy et al. 2020** — the most-cited acoustic-predictors-of-trans-voice-perception paper — did NOT include CPP, H1-H2, or spectral tilt in its acoustic battery. That gap reflects the field, not an oversight: source-spectrum measures are under-evaluated against perceived gender ratings.
- **Gender-symmetric literature is thin.** Most validation is on cisgender female dysphonia samples or musical-theatre singing samples. The transmasculine direction has measurable F0/formant data but essentially zero source-spectrum validation. A Syrinx ship needs to flag this.

---

## 1. The "vocal weight" construct

### 1.1 What does the term refer to?

There is **no peer-reviewed paper that defines "vocal weight" as an acoustic construct and then validates an acoustic measure against perceptual ratings of "weight" specifically.** The term lives at the intersection of three traditions, each with a different operational meaning:

1. **Singing pedagogy / voice classification.** "Vocal weight" distinguishes spinto vs. light lyric soprano, etc. Erickson (2020) and Stone & Erickson (2023) treat it as a perceptual category that experienced listeners agree on more than acoustic measures predict (*Journal of Voice*, "Inexperienced/Experienced Listeners' Perception of Timbre Dissimilarity"). The relevant acoustic predictors they identify aren't a single measure — they're the joint distribution of F0, formants, and spectral envelope.

2. **Functional voice / EGG science.** Aaen, Christoph, McGlashan et al. (2025), *Folia Phoniatrica et Logopaedica*, 77(4):319–331, PMID 39602908, formalize this as **"phonatory density"** — perceived heaviness/buzz of the voice — and tie it physiologically to the degree of forward-downward thyroid cartilage tilt, independent of F0. The acoustic measures that significantly differentiate their reduced-density (lighter) condition from full-density (heavier) condition: **negative correlations of CPP, SPL, and shimmer** (i.e., reduced-density voices have higher CPP, lower SPL, and lower shimmer). Contact quotient (Qx from EGG) was NOT significant. This is the only paper that operationalizes the heaviness construct with an explicit perceptual panel (33 singing teachers, 87% accuracy, κ=0.772) AND ties it to acoustic measures.

3. **Trans voice training pedagogy.** Hannon (2024) on transgender singers; Hirsch et al. (2017, 2018) on resonant voice approaches. Conroy, Karcher & Pasternak (2024) describe practitioners asking clients to "add muscular weight (tension) in the voice." The pedagogical term blends laryngeal source heaviness (TA-dominated phonation, thicker fold contact) with perceptual brightness/darkness — but no single tradition pins it to a measurable acoustic feature. The widely-shared TransVoiceLessons-style framing (TA dominance ↔ heavier, CT dominance ↔ lighter) maps onto the same construct that Aaen et al. operationalize via thyroid tilt.

### 1.2 Adjacent acoustic constructs that overlap

| Construct | Closest acoustic correlate | Validated against | Relationship to "vocal weight" |
|---|---|---|---|
| Phonatory density (Aaen 2025) | CPP, SPL, shimmer | Trained-listener panel, EGG | **Direct** — same construct, different name |
| Vocal effort (McKenna & Stepp 2018, Sluijter & Van Heuven 1996) | Spectral tilt + CPP + SPL | Listener perceptual ratings | Adjacent — heavier voices use more effort but effort ≠ weight |
| Breathiness (Hillenbrand & Houde 1996) | HNR (signal periodicity), spectral tilt | Perceptual breathiness ratings | Inverse — breathier = lighter, but breathiness is bidirectional from modal |
| Pressedness / adduction (Garellek 2019, Chai & Garellek 2022) | H1-H2 (low = pressed), CPP (high = pressed) | Linguistic phonation type | Adjacent — heavy ≠ pressed but they correlate |
| Brightness (LeAnn & Claire 2025) | CPP-smoothed (higher = brighter) | Perceptual ratings of non-binary speakers | Inverse — heavier voices typically darker |
| Voice quality severity / dysphonia (AVQI, CSID) | Multivariate composite | Clinical severity ratings | Tangential — pathology-focused; not the trans-training construct |

The construct's lack of a unique acoustic correlate is **a finding, not a search failure**. Treat any single-measure ship as approximating one of these adjacent constructs.

---

## 2. Per-candidate findings

### 2.1 CPP (cepstral peak prominence) and CPPS (smoothed)

**Definition.** Magnitude of the dominant peak in the cepstrum (spectrum of the log-magnitude spectrum), measured against a regression line fit to the cepstral baseline. CPPS is the same after spectral and quefrency smoothing. Defined originally by Hillenbrand, Cleveland & Erickson (1994) and refined by Awan et al. for AVQI/CSID.

**Empirical correlation with vocal weight constructs:**
- **Aaen et al. 2025 (the central paper for this review):** CPP shows a *significant negative correlation with phonatory density* — i.e., heavier voices have lower CPP. Aaen's panel rated 8 voice quality conditions; CPP differentiated reduced-density (lighter) from full-density (heavier). This is a direct correlation with the same construct trans voice training calls "weight."
- **McKenna & Stepp 2018 (*JASA* 144(3):1643):** CPP and spectral tilt jointly best predicted perceptual vocal effort. Effort is adjacent (heavier voices typically involve more effort) but distinct.
- **LeAnn & Claire 2025 (*J Voice*):** Non-binary AFAB participants show *higher CPPS* than cis comparators, interpreted as "brighter, more resonant" — i.e., lighter. Same direction as Aaen.
- **Lei et al. 2022 (PMID search'd via accelerometer paper):** "CPP and spectral tilt from passage reading most closely mirrored trends in perceived fatigue." Reinforces CPP-tilt as a joint pair.
- **Heman-Ackah et al. 2002, 2003, 2014; Murton et al. 2020:** Extensive validation of CPP/CPPS as a dysphonia-severity measure. **All clinical, not training contexts.**

**Vowel-content sensitivity (load-bearing):**
- **Sampaio et al. 2020 / 2021 (Brockmann-Bauser as co-author):** "Voice SPL as single factor and combined with f0 had a highly significant effect (P ≤ 0.001) on both CPP and CPPS." Vowel position within connected speech also significantly affects CPPS (P ≤ 0.03).
- **Brockmann-Bauser et al. 2021 (*J Voice*):** "Smoothed cepstral peak prominence is influenced by voice sound pressure level."
- **General consensus across PubMed CPP-vowel literature:** CPP is **vowel-dependent and SPL-dependent**. Sustained-vowel CPP values cannot be directly compared to running-speech CPP values; running-speech CPP from one corpus cannot be directly compared to running-speech CPP from another without controlling for SPL.
- **Mitigation:** LTAS-style aggregation across many phonemes washes out the vowel-position effect. CPPS computed on continuous speech of ≥ 1 s tends toward a stable value; sub-second windows are heavily phoneme-confounded.

**Implementation cost in Syrinx:**
- Already have 2048-pt FFT per frame. Cepstrum is one additional FFT/IFFT cycle on the log-magnitude spectrum, typically ≤ 2 ms on a Pixel 8 Pro WASM-class device.
- CPPS adds smoothing (typically 7-frame quefrency, 7-frame frame). Negligible cost.
- Aggregation window matters: per-frame CPP is noisy and vowel-confounded; ≥ 1 s rolling aggregation (similar to the gender worker's 0.75 s window or longer) is required for stability.
- Hop budget: comfortable. Could run every 6th frame like formants.

**Calibration approach:**
- **No published reference range that cleanly transfers to Syrinx use.** Murton et al. 2020 publish dysphonia-screening cutoffs for sustained-vowel CPP (around 14 dB threshold), but those are SPL-controlled clinical samples — not consumer mic + arbitrary speech.
- **Per-user calibration is the only honest path.** A CPP-vs-time trace surfaces relative changes ("you went from heavier to lighter compared to your last 30 s") rather than population-anchored absolutes. The Stone & Erickson (2023) work on experienced listeners' perception of vocal weight implies the CONSTRUCT is itself comparative across speakers, not absolute.

**Distinguishing dysphonia validation from training validation:**
- Most CPP validation (Heman-Ackah, Murton, Maryn, Awan, AVQI/CSID) is **clinical dysphonia severity**. Pathological roughness ≠ healthy voice modulation. The transfer is plausible but unvalidated.
- The two papers that validate CPP for *non-pathological voice modulation* are Aaen et al. 2025 (singers, eight quality conditions) and McKenna & Stepp 2018 (vocal effort, mixed sample). Both find CPP useful. Both samples are smaller and the variance structure differs from clinical dysphonia.

**Gender symmetry:**
- Aaen 2025 sample is mixed-gender singers; effects reported jointly. LeAnn & Claire 2025 is AFAB non-binary vs cis comparators — focused on assigned-female direction. Hillenbrand & Houde 1996 mixed.
- **No CPP validation specifically against transmasculine training outcomes.** Worth flagging in any ship doc.

**Verdict.** Strongest single-measure candidate. Validated for the closest analog construct (phonatory density). Vowel-confounded at frame scale; vowel-stable with ≥ 1 s aggregation. Correlation direction (lighter = higher CPP) matches both trans pedagogy and Aaen physiology. Implementation cheap.

---

### 2.2 H1-H2 (and corrected H1*-H2*)

**Definition.** Amplitude difference between first and second harmonics in the log-magnitude spectrum. Higher H1-H2 = breathier (open phase dominant); lower H1-H2 = creaky/pressed (closed phase dominant). Iseli & Alwan 2004 introduced formant-corrected H1*-H2* to account for first-formant proximity inflating the harmonic amplitudes.

**Empirical correlation with vocal weight:**
- **Garellek 2019 (*The Phonetics of Voice* in Routledge Handbook):** H1-H2 is THE primary measure of phonation type in the linguistic-phonetics literature. Creaky < modal < breathy on the H1-H2 axis. To the extent "heavy" maps onto pressed/creaky-end phonation (TA-dominant, more adducted), H1-H2 should be lower for heavier voices.
- **Hanson & Chuang 1999 (*JASA*):** Among male speakers, H1-H2 and H1-A3 distinguish glottal source characteristics that "may greatly contribute to gender." Direct linkage to gender perception.
- **Chai & Garellek 2022 (*JASA*):** Detailed methodology paper on H1-H2 as a phonation type measure. Notes "uncorrected H1-H2 for [i] = H1-H2 for [a]" comparison FAILS — vowels at high vs low F1 produce systematically different uncorrected values. Strongly recommends formant correction (Iseli-Alwan).
- **Simpson 2012 (*Journal of Phonetics*, "The first and second harmonics should not be used to measure breathiness in male and female voices"):** Argues H1-H2 has fundamental gender-asymmetric problems and should be avoided as a breathiness measure.
- **Park et al. 2019 (*JSLHR*):** H1-H2 relates to breathiness perception in healthy speakers but not strongly enough to recommend as a sole measure.

**Vowel-content sensitivity:**
- **Highly vowel-confounded without correction.** Iseli-Alwan H1*-H2* correction is mandatory for cross-vowel use. Even with correction, residual vowel effects exist (Chai & Garellek 2022).
- **Mitigation:** Compute only on voiced frames where F1 has been measured (we already have this). Apply Iseli-Alwan correction using F1 + bandwidth.

**Implementation cost in Syrinx:**
- Need reliable harmonic identification across F0 range. F0 is already known per frame from SwiftF0; H1 and H2 are by definition the spectral peaks at F0 and 2*F0. Practical: window the FFT bins around expected harmonic locations, take the maximum.
- Reliability degrades for high F0 (above ~300 Hz, harmonics get sparse in 2048-pt FFT at 48 kHz). Typical female speaking F0 200–250 Hz is fine.
- Iseli-Alwan correction needs F1 frequency and bandwidth. We have F1 from Burg LPC; bandwidth requires extracting it from the LPC roots (small extra step).
- Hop budget: cheap. Per-frame computation.

**Calibration approach:**
- **Reference values exist by phonation type (Garellek 2019 review) but are language-and-speaker-pool dependent.** No clean Syrinx-applicable thresholds.
- **Per-user trend is more robust than absolute values.** "Your H1*-H2* trended down over the last minute" reads as "your phonation became more pressed/heavy."

**Distinguishing dysphonia validation from training validation:**
- H1-H2 is primarily a *linguistic phonetics* measure (creaky/breathy/modal in tonal languages like Mandarin, Mazatec, Yi). It IS a non-pathological, phonation-type measure by design. This is its strongest asset for trans-training contexts.
- Less direct dysphonia validation than CPP.

**Gender symmetry:**
- Simpson 2012 explicitly warns of gender-asymmetric performance.
- Hanson & Chuang 1999 evaluated male speakers specifically to address that women had been over-studied — implying H1-H2 was previously skewed toward female-voice validation.
- Realistic ship caveat: H1-H2 results need separate validation per voice direction.

**Verdict.** Theoretically the cleanest measure for "modal vs pressed" axis (which IS the heaviness axis). Practical issues: requires Iseli-Alwan correction and is criticized in the literature for gender-asymmetric reliability. Implementation moderate cost. **Best paired with CPP, not used standalone.**

---

### 2.3 Spectral tilt slope (linear regression on log-magnitude spectrum)

**Definition.** Slope (dB/octave) of a linear regression fit to the log-magnitude spectrum, typically over 0–5 kHz or 0–8 kHz. Sundberg's voice-source spectrum slope assumes ~ -12 dB/octave for relaxed phonation. Trained singers and high-effort voices show *less negative* (flatter) tilt.

**Empirical correlation with vocal weight constructs:**
- **Sluijter & Van Heuven 1996 (*JASA*, 976 citations):** Foundational. "If a speaker produces more vocal effort, higher frequencies become more prominent" — increased effort = decrease of negative tilt or even positive tilt. Relevant for the effort↔weight adjacency but not weight itself.
- **Mendoza, Valencia, Munoz, Trujillo 1996 (*J Voice*):** LTAS slope distinguishes male vs female voices. Female voices have steeper negative slope on average (less high-frequency energy, modulo the F0 effect on harmonic density).
- **Neuhaus, Scherer & Whitfield 2024 (*J Voice*):** Source spectral tilt is one of three primary acoustic predictors of perceived gender (with F0 and implied vocal tract length). Direct linkage to gender perception.
- **Hardy et al. 2020 (*J Voice*) — IMPORTANT NEGATIVE FINDING:** The most-cited trans-voice-acoustic-predictors paper explicitly DID NOT include spectral tilt or cepstral measures in its battery. Their predictors of gender attribution: F0, formants, SPL, speech rate. Either the source-spectrum measures aren't strong predictors against this study's perceptual rating method, or — more likely — the authors simply didn't evaluate them. Don't read this as evidence against tilt; read it as a gap in the literature.
- **Hillenbrand & Houde 1996 (*JSLHR*):** Spectral tilt accounts for 70-85% of variance in breathiness ratings in continuous speech, and 92% (joint with periodicity) in sustained vowels.

**Vowel-content sensitivity:**
- **Frame-scale spectral tilt is heavily vowel-confounded.** A high-F1 vowel like /a/ has different spectral envelope than low-F1 /i/, so per-frame tilt slope reflects formant placement more than glottal source.
- **LTAS aggregation is the standard mitigation.** Computing the slope over 1 s+ of speech effectively averages across the formant distribution, leaving the source-spectrum component dominant. Mendoza 1996, Master et al. all use LTAS aggregation specifically for this reason.
- **Practical recommendation: any spectral-slope measure on running speech needs ≥ 1 s aggregation.** Sub-second tilt is contaminated by vowel content.

**Implementation cost:**
- Already compute FFT per frame. Linear regression on log-magnitude bins is trivial.
- Aggregation across 1+ s of voiced frames is the only added complexity.
- Same hop budget as CPP.

**Calibration approach:**
- Reference values exist (Sundberg's -12 dB/octave for relaxed phonation; Mendoza's male-vs-female mean values). All from sustained vowels or highly controlled samples.
- For consumer mic + running speech, per-user calibration is more honest.

**Distinguishing dysphonia validation from training validation:**
- Hillenbrand & Houde 1996 is dysphonic; Sluijter & Van Heuven 1996 and Neuhaus 2024 are non-pathological. Both regimes validated.

**Gender symmetry:**
- Mendoza 1996 reports both male and female slopes. Neuhaus 2024 examines gender perception bidirectionally. Better gender-symmetric coverage than CPP or H1-H2.

**Verdict.** Solid second-choice measure. Vowel-robust *with* LTAS aggregation; vowel-confounded *without* it. Direct linkage to gender perception (Neuhaus 2024). The current Syrinx band-energy ratio is essentially a coarse two-bin approximation of this. Replacing the two-bin ratio with a linear-regression slope over 0–5 kHz on a 1+ s aggregated LTAS would be a strict improvement using the same family of math.

---

### 2.4 Alpha ratio (Frokjaer-Jensen & Prytz 1976)

**Definition.** Ratio of energy above 1000 Hz to energy below 1000 Hz, expressed in dB. Some variants use 0–1000 vs 1000–5000 Hz; some use the 50–1000 vs 1–5 kHz bands of Frokjaer-Jensen & Prytz original.

**Empirical correlation with vocal weight constructs:**
- **Wang & Zhao 2024 (*PMID search result*):** Alpha ratio increases with vocal effort. Singing > speaking on alpha ratio.
- **Guzman et al. 2013:** Alpha ratio used to evaluate vocal warm-up effects on pop singers. Validated as effort/loudness-sensitive measure.
- **Various unnamed clinical studies:** Alpha ratio used as a vocal-fatigue and aging indicator (decreases with vocal aging in women).
- **No direct validation against perceived gender or "vocal weight" specifically.**

**Vowel-content sensitivity:**
- **Same as spectral tilt slope:** vowel-confounded at frame scale, vowel-stable on LTAS aggregation.

**Implementation cost:**
- **Already implemented in Syrinx** — the existing "spectralTilt" metric is essentially a two-bin alpha ratio (0–1000 vs 1000–4000). This means the audit's framing of the current metric as "uncalibrated, custom" is technically correct (Syrinx hasn't validated it, hasn't smoothed it, hasn't documented it as alpha ratio) but not "without published basis."

**Calibration approach:**
- Reference values exist by speaking style and trained vs untrained voices, but they're all population-level and corpus-specific.

**Distinguishing dysphonia validation from training validation:**
- Alpha ratio is primarily an *effort and loudness* measure, validated in singing pedagogy and vocal-fatigue work. Non-pathological context.

**Gender symmetry:**
- No specific gender-symmetric validation found.

**Verdict.** The current Syrinx metric is essentially this. The fix isn't necessarily replacement — it's: (a) explicit attribution as alpha ratio, (b) longer aggregation window to wash out vowel content, (c) calibration anchor or per-user trend display. If Syrinx wants to ship a single source-spectrum measure with the lowest implementation delta, this is it.

---

### 2.5 Other candidates surveyed

#### Soft Phonation Index (SPI)
A multivariate index from the MDVP suite. The literature is sparse and clinical. No direct validation against trans-voice perceptual ratings. **Not recommended.**

#### AVQI (Acoustic Voice Quality Index — Maryn & Weenink 2015)
A weighted combination of 6 acoustic features (CPPS, HNR, shimmer-local, slope-LTAS, tilt-LTAS, intermediate metrics) calibrated against dysphonia severity ratings. **CPPS is the strongest contributor**. AVQI is heavily validated for clinical dysphonia screening but explicitly trained against pathology severity, not voice modulation. The component CPPS is more transferable than the composite. **Not recommended as a composite; useful as a citation that CPPS is the highest-loading single feature.**

#### CSID (Cepstral Spectral Index of Dysphonia — Awan & Roy)
Same family as AVQI. Same caveat: dysphonia-validated, not training-validated. **Not recommended for this use case.**

#### HNR (harmonics-to-noise ratio) and HNR derivatives
Already in the Syrinx pipeline. Hillenbrand & Houde 1996 showed HNR is the best single predictor of breathiness in sustained vowels (92% variance with periodicity measure). For weight/heaviness specifically, less direct. HNR is bidirectional from modal (low HNR can mean breathy OR creaky) and so isn't a clean weight axis. **Useful as a complement (already shipped) but not a primary weight measure.**

#### Strength of Excitation (SoE)
Used in glottal source inverse filtering. Computationally heavier and more sensitive to mic conditions. Few consumer voice-tool deployments. **Not recommended.**

#### Glottal source inverse filtering (GIF / IAIF)
Theoretically the cleanest source-vs-tract separation. Practically: brittle on consumer mics, requires accurate formant tracking, sensitive to phase distortions. **Not recommended for browser deployment.**

#### Cepstral spectral entropy
Limited literature; mostly speech-recognition / emotion-recognition contexts. **Not recommended.**

---

## 3. Trans voice training tool survey

This section documents what existing tools claim to measure and the (limited) academic evaluation thereof.

### 3.1 Christella VoiceUp
- **Ahmed, Kim & Hoffmann 2022 (*Convergence*):** "This app can help you change your voice: Authenticity and authority in mobile applications for transgender voice training" — describes VoiceUp as "more robust and explicitly designed for voice training for transgender people" but documents that user-perceived feedback is limited.
- **Bush et al. 2024 (*J Voice* 38(5):1251.e1):** "Considerations for Voice and Communication Training Software for Transgender and Nonbinary People." Surveyed 21 trans participants. Identified four critical implementation areas: feedback mechanisms, accountability, automated objective-setting, training elements beyond pitch. Finding: "Existing apps like VoiceUp provide little feedback to the user despite their availability."
- **Acoustic measures actually displayed:** Pitch (F0), timing/cadence prompts. No source-spectrum measures publicly documented.

### 3.2 EVA (MTF / FTM)
- **Ahmed 2020 (dissertation):** Discusses EVA app design assumptions. Includes pitch analyzer and minimal spectral feedback.
- **Acoustic measures displayed:** Pitch (e.g., "Pitch 1 lesson trains your ear to hear A3 / 220 Hz"), some spectral visualizations. No published validation of the spectral measures used.

### 3.3 TruVox (Weese et al. 2025, *JMIR Formative Research*)
- "TruVox Web-Based Software for Vocal Pitch Training in Transgender Women." Documents real-time *resonance* biofeedback — implementation details not in the abstract; the tool focuses on pitch-and-resonance training.
- **Acoustic measures displayed:** Pitch + automated resonance (formant-based, based on the abstract phrasing).

### 3.4 Voice Tools (Android)
- No peer-reviewed academic evaluation found. Marketing material describes pitch, formant, and "weight" displays — the latter without published methodology. The user reports the comparable Voice Tools weight readout doesn't match Syrinx's, which is consistent with each tool inventing its own un-published "weight" formula.

### 3.5 TransVoiceLessons / Zheanna Erose pedagogy
- Educational content (YouTube), not peer-reviewed. The "vocal weight" framing (TA dominance vs CT dominance, thicker vs thinner folds) is the most widely-shared *pedagogical* framing of the construct in trans-voice training. The Aaen et al. 2025 phonatory-density model is the closest peer-reviewed analog.

### 3.6 Christella, EVA, Voice Tools, TruVox — synthesis
**No tool publishes its acoustic measures with peer-reviewed validation.** The Bush et al. 2024 survey explicitly documents that the field is nascent and lacks rigorous evaluation. There is no consensus measurement protocol; each tool defines vocal weight (or omits it) per the developer's intuition. This is a gap Syrinx could fill credibly by publishing what it ships and how it validates it — even if the "best" measure is a published one (CPP or LTAS slope) rather than a novel one.

---

## 4. Synthesis (Stage L2)

### 4.1 Score matrix

Scoring the four candidates on the audit's four axes, plus a fifth row for gender-symmetric coverage. Scale: ●● = strong evidence; ● = moderate; ○ = weak; ✕ = adverse.

| Axis | CPP / CPPS | H1*-H2* | Spectral tilt slope (LTAS) | Alpha ratio (current) |
|---|---|---|---|---|
| Empirical correlation with vocal weight construct | ●● (Aaen 2025 direct) | ● (modal↔pressed axis) | ● (effort/gender adjacent) | ○ (effort proxy only) |
| Vowel-content robustness | ○ frame / ●● aggregated | ○ uncorrected / ● corrected | ○ frame / ●● aggregated | ○ frame / ● aggregated |
| Implementation cost in Syrinx | ● (1 cepstrum + window) | ● (peak ID + Iseli-Alwan correction) | ●● (already have FFT, just regress) | ●● (already implemented) |
| Calibration availability | ○ (clinical only, doesn't transfer) | ○ (linguistic only, language-bound) | ○ (sustained-vowel only) | ○ (none) |
| Gender-symmetric validation | ● (Aaen mixed; LeAnn AFAB-only) | ○ (Simpson 2012 explicit warning) | ● (Mendoza 96 + Neuhaus 24 both directions) | ○ (no specific work) |

### 4.2 Recommendation

**Primary: CPPS aggregated over ≥ 1 s of voiced speech.**

Rationale:
1. Aaen et al. 2025 is the only paper that operationalizes "vocal weight" (as phonatory density) with a perceptual panel AND ties it to a single acoustic measure — that measure is CPP. Direction matches trans pedagogy: lighter = higher CPP.
2. The vowel-confounded and SPL-confounded weaknesses are addressed by the standard mitigation (LTAS-style ≥ 1 s aggregation). Brockmann-Bauser's SPL confound matters most for absolute clinical thresholds; for relative trend display in Syrinx it's manageable.
3. McKenna & Stepp 2018 + Lei et al. 2022 + LeAnn & Claire 2025 all converge on CPP as a primary or co-primary correlate of perceived effort/brightness/weight.
4. Implementation cost is comparable to existing formant LPC.
5. The construct overlap with brightness (LeAnn 2025) is acceptable — bright/dark IS adjacent to light/heavy in trans pedagogy.

**Fallback: LTAS-based spectral slope (linear regression in dB/octave over 0–5 kHz) on the same ≥ 1 s aggregation window.**

Rationale:
1. Strict improvement over the current alpha ratio: same family of math, more information per Hz.
2. Direct gender-perception linkage (Neuhaus, Scherer & Whitfield 2024).
3. Better gender-symmetric coverage than CPP.
4. Cheapest to implement (already have the FFT).
5. Proper attribution as a published measure replaces the current "uncalibrated/custom" framing.

**If shipping ONE measure:** CPPS. If shipping a small panel: CPPS + LTAS slope (the McKenna & Stepp 2018 effort prediction pair). H1*-H2* could be added later as a phonation-type axis with a separate display, but the gender-asymmetry warning (Simpson 2012) makes it riskier as a primary metric.

### 4.3 Gender symmetry

The literature is uneven across voice-modulation directions. CPP has the cleanest symmetric validation (mixed-gender singer panels). H1-H2 has a documented gender-asymmetric reliability concern. LTAS slope has matched-pair gender data going back to Mendoza 1996. Hardy et al. 2020 — the trans-specific study — used mostly transfeminine participants; transmasculine voice modulation has thinner acoustic-measure validation across the board.

**Ship implication:** any shipped weight measure should be validated on the Hillenbrand corpus (or comparable) for both M and F groups before being claimed gender-symmetric. The existing Syrinx convention of running gender-symmetric metrics on Hillenbrand applies cleanly here.

### 4.4 Subjective-rating calibration — does the literature suggest this is needed regardless?

**Yes.** "Vocal weight" as a perceptual construct does not have an absolute acoustic anchor in the literature. Stone & Erickson 2023 explicitly find that experienced listeners agree on weight categorization more than acoustic measures predict. Aaen et al. 2025 use a 33-singing-teacher panel to anchor their density categories — they don't claim the acoustic measures alone are sufficient.

**What this means for Syrinx:**
- A shipped measure (CPPS or LTAS slope) is honestly framed as a *correlate* of vocal weight, not a *measurement* of it.
- For population-level reference ranges, a Syrinx-internal listener-rating effort would be needed: collect speech samples from Hillenbrand or similar, have raters score on a perceived weight scale, regress acoustic measure against the ratings to derive a calibration curve.
- For per-user use, a relative trend display ("over the last minute, your CPPS went from X to Y") sidesteps the calibration issue at the cost of removing absolute targets.
- This is not a one-meter-swap problem. It's a "ship a literature-grounded measure with explicit caveats and a roadmap for calibration" problem.

### 4.5 The architecture-doc inversion

Noted only — the audit document mentioned the docs say "more negative = heavier" while the code returns positive. That is a documentation bug regardless of which measure ships. Out of scope for this review.

---

## 5. Open questions / what the literature can't answer

The following need Syrinx-internal measurement to resolve. Enumerated only; not proposed here.

1. **Does CPPS computed on a Web Audio pipeline (consumer mic, possibly with platform-level AGC and noise suppression) produce stable values across the Hillenbrand corpus and the user's own real-mic captures?** The clinical CPPS literature uses studio-grade recordings.

2. **What aggregation window length minimizes vowel-content variance while preserving meaningful weight-modulation signal?** 1 s is the conventional minimum from LTAS practice but isn't validated for this specific use case.

3. **What is the empirical CPPS distribution for Syrinx users producing self-rated "lighter" vs "heavier" voice?** This requires within-user data with self-labels, then between-user aggregation.

4. **Does CPPS or LTAS slope (or both jointly) better predict listener-rated perceived weight on a small Syrinx-collected corpus?** Without this, the choice between primary and fallback is theory-driven, not empirical.

5. **What is the SPL confound's practical magnitude for Syrinx use?** Brockmann-Bauser shows it exists; the Syrinx-specific question is whether typical-use SPL variation would generate trend-direction noise that masks weight modulation.

6. **Does the metric work gender-symmetrically on Syrinx's actual user population?** Hillenbrand validation is necessary but may not be sufficient — the user population includes voices in transition (training-induced acoustic instability) that aren't in Hillenbrand.

7. **What is the minimum perceptually-meaningful change in CPPS or LTAS slope for "I went from heavier to lighter"?** Without a JND-equivalent threshold, a real-time meter can't decide what counts as a meaningful trend update.

8. **Should Syrinx publish its measure-and-validation (filling the Bush et al. 2024 gap)?** The trans-voice-tool field is documented as nascent and under-evaluated. A measurement-grounded ship from Syrinx could be a publishable contribution.

---

## Bibliography (selected, anchor citations only)

- Aaen, M., Christoph, N., McGlashan, J., et al. (2025). Correlating Degree of Thyroid Tilt Independent of f₀ Control as a Mechanism for Phonatory Density with EGG and Acoustic Measures across Loudness Conditions. *Folia Phoniatrica et Logopaedica*, 77(4), 319–331. PMID 39602908.
- Ahmed, A., Kim, J., & Hoffmann, A. L. (2022). "This app can help you change your voice": Authenticity and authority in mobile applications for transgender voice training. *Convergence*.
- Awan, S. N., & Roy, N. (2009). Outcomes measurement in voice disorders: Application of an acoustic index of dysphonia severity. *J Speech Lang Hear Res*.
- Brockmann-Bauser, M., Van Stan, J. H., Sampaio, M. C., et al. (2021). Effects of vocal intensity and fundamental frequency on cepstral peak prominence in patients with voice disorders and vocally healthy controls. *J Voice*.
- Bush, E. J., Krueger, B. I., Cody, M., Clapp, J. D., Novak, V. D. (2024). Considerations for Voice and Communication Training Software for Transgender and Nonbinary People. *J Voice*, 38(5), 1251.e1–1251.e20.
- Carew, L., Dacakis, G., & Oates, J. (2007). The effectiveness of oral resonance therapy on the perception of femininity of voice in male-to-female transsexuals. *J Voice*.
- Chai, Y., & Garellek, M. (2022). On H1–H2 as an acoustic measure of linguistic phonation type. *JASA*.
- Conroy, E. R., Karcher, A. M., & Pasternak, K. (2024). An interdisciplinary approach to gender affirming voice training. (Source via Hannon 2024 reference chain.)
- Frokjaer-Jensen, B., & Prytz, S. (1976). Registration of voice quality. *Bruel and Kjaer Technical Review*. (Original alpha ratio — secondary citations only available.)
- Garellek, M. (2019). The phonetics of voice. In *The Routledge Handbook of Phonetics*, Chapter 4. https://pages.ucsd.edu/~mgarellek/files/Garellek_Phonetics_of_Voice_Handbook_final.pdf
- Hannon, S. (2024). Understanding the Effects of Hormone Treatments on the Transgender Singer.
- Hanson, H. M., & Chuang, E. S. (1999). Glottal characteristics of male speakers: Acoustic correlates and comparison with female data. *JASA*.
- Hardy, T. L. D., Rieger, J. M., Wells, K., & Boliek, C. A. (2020). Acoustic Predictors of Gender Attribution, Masculinity-Femininity, and Vocal Naturalness Ratings Amongst Transgender and Cisgender Speakers. *J Voice*, 34(2), 300.e11–300.e26. PMID 30503396.
- Heman-Ackah, Y. D., Michael, D. D., & Goding Jr, G. S. (2002). The relationship between cepstral peak prominence and selected parameters of dysphonia. *J Voice*.
- Hillenbrand, J., Cleveland, R., & Erickson, R. L. (1994). Acoustic correlates of breathy vocal quality. *J Speech Lang Hear Res*.
- Hillenbrand, J., & Houde, R. A. (1996). Acoustic correlates of breathy vocal quality: Dysphonic voices and continuous speech. *JSLHR*.
- Hirsch, S., et al. (2017, 2018). Various chapters on resonant voice training in transgender voice therapy. (See Hirsch 2018 chapter in *Voice and Communication Therapy for the Transgender/Gender Diverse Client*.)
- Iseli, M., & Alwan, A. (2004). An improved correction formula for the estimation of harmonic magnitudes and its application to open quotient estimation. *Proc. ICASSP*.
- LeAnn, B., & Claire, P. L. (2025). Bright voice quality and fundamental frequency variation in non-binary speakers. *J Voice*.
- Lei, Z., et al. (2022). Neck-surface accelerometers for vocal health monitoring (CPP and spectral tilt as fatigue predictors).
- Maryn, Y., & Weenink, D. (2015). Objective dysphonia measures in the program Praat: Smoothed cepstral peak prominence and acoustic voice quality index. *J Voice*.
- McKenna, V. S., & Stepp, C. E. (2018). The relationship between acoustical and perceptual measures of vocal effort. *JASA*, 144(3), 1643. PMID 30424674.
- Mendoza, E., Valencia, N., Muñoz, J., & Trujillo, H. (1996). Differences in voice quality between men and women: Use of the long-term average spectrum (LTAS). *J Voice*.
- Mills, M., & Stoneham, G. (2017, 2020). The Voice Book for Trans and Non-Binary People; Voice and Communication Therapy with Trans and Non-Binary People.
- Murton, O., Hillman, R., & Mehta, D. (2020). Cepstral peak prominence values for clinical voice evaluation. *AJSLP*.
- Neuhaus, T. J., Scherer, R. C., & Whitfield, J. A. (2024). Gender Perception of Speech: Dependence on Fundamental Frequency, Implied Vocal Tract Length, and Source Spectral Tilt. *J Voice*.
- Sampaio, M. C., Brockmann-Bauser, M., et al. (2020/2021). Effect of fundamental frequency, vocal intensity, sample duration, and vowel context on cepstral and spectral measures.
- Simpson, A. P. (2012). The first and second harmonics should not be used to measure breathiness in male and female voices. *Journal of Phonetics*.
- Sluijter, A. M. C., & Van Heuven, V. J. (1996). Spectral balance as an acoustic correlate of linguistic stress. *JASA*.
- Stone, T. C., & Erickson, M. L. (2023). Experienced listeners' perception of timbre dissimilarity within and between voice categories. *J Voice*.
- Sundberg, J. (various). The Science of the Singing Voice; voice-source spectrum slope work.
- Ternström, S., Bohman, M., & Södersten, M. (2006). Loud speech over noise: Some spectral attributes, with gender differences.
- Weese, et al. (2025). TruVox Web-Based Software for Vocal Pitch Training in Transgender Women. *JMIR Formative Research*.

---

**End of literature review. Document path: `c:\Coding Projects\Syrinx\measurements\vocal-weight-literature-2026-05-09.md`.**
