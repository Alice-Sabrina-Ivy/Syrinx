# Vocal weight calibration research

Research date: 2026-05-11. Author: Claude (research agent). For: Alice / Syrinx ship-decide.

Scope: this is a research/measurement document about the **calibration UX layer** for Syrinx's CPP-based vocal-weight gauge. The CPP algorithm choice is settled (see [measurements/maryn-cpps-design-2026-05-10.md](maryn-cpps-design-2026-05-10.md)); the question is what reference frame the gauge should display CPP against.

Triggering concern: Syrinx currently uses a per-session self-anchored baseline (first ~30 s of voiced speech → μ, σ → gauge in ±2σ). The user surfaced four flaws: (1) starting-point anchoring, (2) staleness as the user improves, (3) baseline pollution from mixed-mode exploration, (4) no cross-session continuity. This document surveys how other tools handle the same problem and recommends a path for Syrinx.

---

## 1. TL;DR

- **Primary recommendation: hybrid self+target with persistent cross-session anchors.** Capture a baseline once per user (persisted in IndexedDB, not per-session), let the user optionally record or pick a target sample, display the gauge as a journey from saved-baseline → current → saved-target. This is structurally what TruVox (NYU/Cincinnati, Journal of Voice 2025) does for resonance and is the closest match in the field to what Syrinx needs for vocal weight.
- **Fallback recommendation: population-anchored + optional self-overlay.** If implementing target recording is out of scope, ship a fixed CPP scale anchored to published normative ranges (Hillenbrand-style; CPP norms are well-established in the SLP literature) with the per-session self-baseline as an *overlay marker* rather than the gauge zero. This addresses the staleness problem without requiring target-recording infrastructure.
- **The field has no consensus on vocal-weight calibration UX specifically.** Existing tools either don't measure vocal weight at all (Voice Tools, Voice Analyst, VoiceUp, Acoustic Gender — all pitch+resonance, no weight metric), or measure related quantities under different names (Renee Yoxon, Undead Voice, Sandy Hirsch teach vocal weight as a perceptual concept with proprioceptive feedback, not as an acoustic metric). Syrinx would be roughly first-in-class for a CPP-as-vocal-weight gauge in a self-training app, which means we're partially defining the convention rather than following one.
- **The community-research literature explicitly flags Syrinx's exact problem.** Bush et al. 2024 (Journal of Voice) identified "automated goal setting" as one of four core features users want from voice training software, and noted "current voice training technologies fail to define clear goals." This is a known gap, not an unsolved one — TruVox 2025 is the field's current best answer.
- **Honest acknowledgment of the limit of this research.** No public source provides a defensible numerical mapping from "vocal weight CPP value" to "perceived weight position on a Lighter↔Heavier bar." Population norms exist for CPP-as-voice-quality, but mapping perceived vocal weight onto CPP is not in the published literature. The recommendation below covers the calibration UX without claiming we've solved the perceived-weight↔CPP mapping question, which would need its own listener study to ship-quality answer.

---

## 2. Stage A: existing tools

### 2.1 TruVox (NYU BITS Lab + University of Cincinnati, web-based, free)

The most directly relevant comparator. Open-access research-validated tool, published in Journal of Voice 2025 (McAllister et al.) and JMIR Formative Research 2025 (Weese et al.).

- **What it measures:** Resonance via LPC-derived vocal tract frequency peaks (real-time spectrum visualization). Pitch as a separate module. Does *not* currently surface a vocal-weight metric.
- **Calibration approach:** Per-user baseline + targets. From the published methodology description: targets are "based on their own voice at baseline, and adding targets for [training goals]." Built-in resonance targets for English vowel sounds are provided as starting reference points. Future versions plan automated resonance tracking with individualized targets.
- **Reference range displayed:** Visual peaks against the user's own baseline plus the target overlay. Brighter visualization for higher frequencies (associated with feminine perception), darker for lower frequencies (masculine perception). Not a single scalar gauge — a spectrum view.
- **Goal-setting workflow:** SLP-supported in the published study ("the SLP will assess each participant's baseline ability to modify their pitch and resonance"), but the software supports unsupported use as well.
- **Feedback mechanism:** Real-time visual biofeedback during exercises, plus structured progressive practice routines (vowels → words → sentences).
- **Source confidence:** High. Peer-reviewed publications with methodology documented. URL: https://wp.nyu.edu/bitslab/ (NYU BITS Lab page); paper at Journal of Voice 2025 (McAllister et al., usability testing, 21 transfeminine participants).

### 2.2 Christella VoiceUp (Christella Antoni, iOS+Android, paid; SLP-developed)

- **What it measures:** Pitch primarily. Has structured lessons on pitch, resonance, intonation, breath control (10-min/day curriculum, ~2 hours of content). No vocal-weight metric surfaced in the user-facing analytics.
- **Calibration approach:** Fixed 220 Hz pitch target ("feminine target of 220 Hz") referenced in academic descriptions of the app's methodology. Visual feedback shows red below target, green at/above target. The 220 Hz figure corresponds to A3 and is treated as a static threshold rather than a per-user calibrated value.
- **Reference range displayed:** Binary above/below 220 Hz at most granular; the app is more curriculum-oriented than gauge-oriented.
- **Goal-setting workflow:** Curriculum-driven (3-stage course) rather than user-set goals.
- **Feedback mechanism:** Prerecorded video lessons + limited real-time pitch feedback. Academic reviews characterize it as "basic … has not been systematically evaluated" compared to newer research-validated tools (Bush et al. cite this assessment indirectly via the gap analysis).
- **Vocal weight handling:** None as a quantified gauge. Vocal weight is taught conceptually via exercises but not measured.
- **Source confidence:** Medium. App marketing material + academic citations; app store details are visible only through SLP-side product pages (Speechtools.co/voiceup returned 500 errors during research). The 220 Hz fixed-target claim is cited in academic literature but not in primary marketing material I could access.

### 2.3 Voice Tools (DEVExtras, Android+iOS, free with ads)

- **What it measures:** Pitch and volume in real time. Tone-matching practice (user plays reference tone, tries to match). Mentions "tones tailored for trans women (lower female spectrum) and trans men (upper male spectrum)." No vocal-weight metric.
- **Calibration approach:** User-set min/max pitch targets. No automatic baseline capture. No vocal-weight calibration.
- **Reference range displayed:** Pitch trace + user-set target band. Tone-matching reference tones at fixed frequencies.
- **Goal-setting workflow:** User manually sets pitch min/max.
- **Feedback mechanism:** Real-time pitch graph + replay (last 5–30 s).
- **Source confidence:** High. Direct from devextras.com/voicetools and Play Store description.

### 2.4 Voice Analyst (Speechtools, iOS+Android, paid; SLP-clinical)

- **What it measures:** Pitch (60 Hz – 2 kHz, "accurate to within 5 cents") and volume. Cloud storage, telehealth integration. No vocal-weight metric. Designed broadly for SLP clients including Parkinson's, brain injury, singers, trans voice.
- **Calibration approach:** User-set min/max pitch and volume targets. No automated baseline calibration.
- **Reference range displayed:** Pitch trace + user-set targets.
- **Goal-setting workflow:** User (or clinician) sets the targets.
- **Feedback mechanism:** Real-time + recording playback for offline review and telehealth.
- **Source confidence:** High. Direct from speechtools.co/voiceanalyst.

### 2.5 Acoustic Gender (Luna McNulty, Brown University research project, web)

- **What it measures:** Two-axis pitch × resonance scatter plot. Statistical summaries (mean, median, SD). No vocal-weight metric.
- **Calibration approach:** Median-of-clip — no fixed reference values. Each clip is summarized statistically against typical-male (bottom-left) and typical-female (top-right) clusters drawn from a CC-BY-licensed reference corpus.
- **Reference range displayed:** Population reference clusters (male/female) visually anchored in the 2D space, with the user's clip plotted as scatter relative to them.
- **Goal-setting workflow:** No explicit goal — user is invited to "pick a less extreme target which you can reach comfortably." Tool explicitly emphasizes "no sharp cutoffs."
- **Feedback mechanism:** Offline analysis of uploaded recordings, not real-time. Includes audio playback at specific scatter-plot points for hearing what a position sounds like.
- **Source confidence:** High. Direct from acousticgender.space. Notably one of the few tools that explicitly anchors to a population reference rather than a fixed-threshold target.

### 2.6 Resona (web-based, transgender/nonbinary focus, free, browser-local processing)

- **What it measures:** Real-time FFT waterfall spectrogram. Pitch and resonance via visual inspection. No quantified vocal-weight gauge.
- **Calibration approach:** None surfaced — user reads the spectrogram themselves.
- **Reference range displayed:** Spectrogram axes are absolute frequency; no per-user anchoring.
- **Goal-setting workflow:** No goal-setting layer.
- **Feedback mechanism:** Pure visualization, no scoring. Privacy emphasis (local processing).
- **Source confidence:** Medium. Source via secondary descriptions (resona.app TLS error during fetch).

### 2.7 VoiceShift (Communication Domain Pty Ltd, iOS+Android, freemium; Australian SLP-developed)

- **What it measures:** Pitch analysis. Custom lesson programs for "brightening or darkening" the voice. No quantified vocal-weight metric.
- **Calibration approach:** Free-form — user builds a custom program. No documented auto-baseline.
- **Reference range displayed:** Not specified in marketing material.
- **Goal-setting workflow:** Curriculum-style; user picks lesson pathways.
- **Feedback mechanism:** Curriculum + pitch feedback. A "voice review" feature is in development.
- **Source confidence:** Medium. Marketing material from voiceshift.app; specific feedback mechanisms not documented in primary sources.

### 2.8 InFormant (in-formant.app)

- **What it measures:** Formant analysis, real-time spectrum. Targeted at researchers/clinicians; not voice-training-specific.
- **Calibration approach:** None — research tool, raw output.
- **Source confidence:** Low for this comparison — not a voice-training app, just a measurement tool.

### 2.9 1-Minute Voice Warm-Up / DAF PRO / Swallow Prompt (Speechtools)

Out of scope. Not voice-quality measurement tools.

### 2.10 Synthesis: what existing tools do for vocal weight specifically

**No surveyed tool surfaces a quantified vocal-weight gauge.** Pitch and resonance dominate the market. Vocal weight is universally taught as a perceptual + proprioceptive concept (Renee Yoxon "vocal weight exercises," Undead Voice "first pillar," Sandy Hirsch's chapter in Adler/Hirsch/Pickering's Voice and Communication Therapy for the Transgender/Gender Diverse Client, 3rd ed.). Closest acoustic proxies in clinical use:

- **CPP / CPPs (cepstral peak prominence)** — used in clinical voice-quality assessment (Lin et al. 2023, Leyns et al. 2023, Eng 2021 on transgender voice outcomes). Published reference ranges depend on speaker sex, age, language, task, and software (Praat vs ADSV). Not deployed in any consumer voice-training app surveyed.
- **Closed quotient (CQ) / open quotient (OQ)** — historically used as a vocal-weight proxy in voice science. Acquired via electroglottography (EGG), not from a microphone signal. Outside Syrinx's measurement capability.
- **Spectral tilt** — Syrinx's previous vocal-weight gauge used this. Has the same calibration problem CPP does.

Calibration approaches found across tools, ranked by sophistication:

| Approach | Examples | Captures starting point | Handles improvement | Cross-session |
|---|---|---|---|---|
| Fixed numerical target | VoiceUp (220 Hz pitch) | No | Yes (once user exceeds, they exceed) | Yes (target is static) |
| User-set targets | Voice Tools, Voice Analyst | User decides | User decides | If user persists settings |
| Population-anchored 2D | Acoustic Gender | Implicitly (scatter shows where user lands) | Yes | Yes (scale is fixed) |
| Per-session self-anchored | **Syrinx current** | Yes (anchored to today's voice) | **No (re-anchors each session)** | **No** |
| Self + target overlay | TruVox | Yes (saved baseline) | Yes (target is stable) | Yes |
| Pure visualization | Resona, InFormant | N/A | N/A | N/A |
| Perceptual + proprioceptive | Renee Yoxon, Undead Voice, Hirsch | Coach-mediated | Coach-mediated | Coach-mediated |

---

## 3. Stage B: community wants + literature

### 3.1 Bush et al. 2024 (Journal of Voice, "Considerations for Voice and Communication Training Software for Transgender and Nonbinary People")

The most directly load-bearing reference for this research question. Cited 19+ times as of mid-2025 (Google Scholar). Identified four core features users want:

1. **Feedback** — real-time and terminal (post-exercise) feedback options
2. **Accountability** — long-term performance monitoring and reminders
3. **Automated goal setting** — system establishes objectives without manual SLP setup
4. **Diverse training characteristics** — explicitly "training characteristics other than pitch"

The paper additionally noted: *"current voice training technologies fail to define clear goals"* and flagged the *"risks of overemphasizing goals"* (i.e., goal-rigidity that demotivates users when the metric stalls). Subsequent papers (Hancock 2025 collaborative-goals questionnaire, McAllister 2025 TruVox usability study) operationalize this — Hancock explicitly advocates "collaborative goal setting at the start of therapy."

Key takeaway for Syrinx: the gap Syrinx is trying to fill is the *exact gap* the field has flagged. Autonomous goal-setting is wanted, and rigidly-fixed goals are explicitly cautioned against. Per-session self-anchored baselines fail at goal-setting entirely (no goal exists). Fixed-threshold targets fail at the demotivation risk.

### 3.2 McAllister et al. 2025 (Journal of Voice, TruVox usability study)

21-participant in-person usability study. Participants requested:
- Performance tracking across sessions
- Goal-setting features
- Ease of use without preparation

System Usability Scale 79.8/100 (above the 68 industry-average threshold for "good"). The methodology of baseline + per-user-added targets was *positively received* — no critique that baseline-derivation was bad.

This is the strongest data point that *baseline + target* is the empirically-validated approach in this exact problem space.

### 3.3 Weese et al. 2025 (JMIR Formative Research, TruVox pitch module)

Demonstrated that within-session performance improvements were statistically significant on 9 of 10 exercises (p values 0.001 – 0.095). Methodology is exercise-based ("perform 10 repetitions"), with per-exercise targets rather than per-session baseline re-anchoring. The pitch module uses fixed-frequency targets tied to musical notes; resonance module uses baseline-derived targets.

### 3.4 Hancock (George Washington University, multiple papers including 2017, 2025)

NIH-funded researcher leading WPATH SOC 8 voice section. Repeated theme across her work: **individualized goal-setting > population norms**. Quote from 2017 work: practitioners should *"individualize goals on the basis of the patient's needs and perceptions."* 2025 work developed a questionnaire (VCSQ-PFAB) specifically to inform collaborative goal-setting.

This is field consensus from the SLP side: rigid numerical targets are not the right framing. The target should emerge from collaborative conversation about the user's perceptual goals, not from a population mean.

### 3.5 Adler, Hirsch, Pickering — Voice and Communication Therapy for the Transgender/Gender Diverse Client (3rd ed., Plural Publishing)

The field's standard clinical textbook for trans voice therapy. Sandy Hirsch's chapters specifically address vocal weight (via thick-fold/thin-fold concepts and Estill-derived figures). Methodology is **perceptual demonstration + proprioceptive feedback**, not acoustic measurement. The clinical approach is "feel and hear the difference" through guided exercises, with the SLP serving as the calibration mechanism — not an instrument.

### 3.6 Vocal Congruence Project (vocalcongruence.org)

Free resource collection. Explicitly recommends weekly baseline-comparison recordings: *"By comparing your current voice to your baseline voice, you can hear the full range you've covered, in addition to the incremental progress week to week."* This is human-perceptual cross-session comparison without quantification. The methodology is sound for users; it's not directly portable to Syrinx without persisting recordings.

### 3.7 Community discussion (r/transvoice, Discord channels)

**Direct fetch was blocked** (Reddit access restricted in research environment, DDG rate-limited after extensive queries). Indirect reports surfaced via search-result snippets:

- ADHD/executive-function challenges were cited as causing inconsistent training, which compounds the staleness problem (sporadic users won't have a stable "improving" baseline trajectory).
- Apps are frequently characterized as "lacking clear goals" — same critique as Bush et al. 2024.
- The community emphasis on subjective comparison (weekly recordings, perceptual feedback from listeners on r/transvoice's audio-share threads) suggests the *acoustic-gauge-as-progress-indicator* framing is not what most users currently rely on for vocal weight. Most users get vocal-weight feedback perceptually, not quantitatively.

**Honest gap:** I couldn't fetch r/transvoice directly to confirm community-specific complaints about vocal-weight gauges. The literature picture is more confident than the community-direct picture.

### 3.8 Field consensus / lack thereof

**Strong field consensus on:**
- Personalized/collaborative goals beat population norms (Hancock, Bush et al., McAllister et al.)
- Baseline + target framing is empirically validated for resonance training (TruVox)
- Vocal weight is taught perceptually, not measured numerically, in clinical practice

**Lack of consensus on:**
- Whether vocal weight should be quantified at all in self-training apps (no surveyed app does)
- How to derive a target value for vocal weight (no published methodology)
- How to map perceived weight to CPP specifically (no published mapping)

**Field gap Syrinx is entering:** vocal-weight-as-real-time-gauge is unclaimed territory. We should design conservatively, document limits honestly, and not claim a methodology we haven't validated.

---

## 4. Stage C: calibration approaches catalog

### 4.1 Self-anchored (Syrinx current)

- **Mechanism:** First N seconds of voiced speech → μ, σ. Gauge scale = (cpp − μ) / σ in ±2σ.
- **Pros:** Zero user input. Always produces a visible signal regardless of starting voice. Works without population data. Adapts to the individual user's CPP range, which avoids the absolute-CPP normative-range problem.
- **Cons:** All four flaws the user identified — starting-point anchoring, staleness, exploration-pollution, no cross-session continuity. Per-session re-anchoring means "I worked hard this session" feedback degrades over time as the baseline catches up to the trained voice.
- **Implementation cost:** Already shipped. Free.

### 4.2 Population-anchored fixed scale

- **Mechanism:** Gauge axis is absolute CPP in dB. Scale is anchored to published CPP norms (e.g., CPP ~10–15 dB for typical voiced speech; lower = more dysphonic/breathy; higher = clearer/more periodic). Specific endpoints would need a calibration pass mapping perceived vocal weight to CPP — see §6 open question.
- **Pros:** Stable across sessions and users. No baseline polution. User sees consistent feedback over months. Direct cross-session progress visible.
- **Cons:** CPP norms in the literature are for clinical voice-quality assessment (dysphonia detection), not for vocal-weight perception specifically. **The mapping from "CPP value" to "perceived as lighter/heavier" is not in the published literature.** Without that mapping, the population scale is grounded but not validated for this purpose. Also: absolute CPP varies with microphone, room acoustics, sustained-vowel-vs-running-speech task, language. Mobile vs desktop microphones may produce different CPP values for the same voice (calibration risk).
- **Implementation cost:** Low-ish. Need to lock CPP measurement methodology against a published reference (Maryn et al. is the dominant CPPs spec; Syrinx already uses Maryn variant per [maryn-cpps-design-2026-05-10.md](maryn-cpps-design-2026-05-10.md)). The endpoint values themselves are the open question.
- **Specific trans-voice-training risk:** Population norms in published CPP work are typically not split by sex × age × language in a way that maps clearly to "what should a transfeminine voice aim for." This isn't fatal — the gauge can still display absolute CPP — but the *target band* on the scale would be guessed rather than derived.

### 4.3 Target-anchored (user records or selects target voice)

- **Mechanism:** User records a sample of their target voice (could be their own attempt at target, or a sample they admire) during onboarding. Gauge displays current CPP relative to target CPP, with the user's saved baseline as the "starting point" marker.
- **Pros:** Directly addresses Hancock-style individualized goals. The target voice carries the user's personal definition of "lighter" rather than relying on population norms. Stable across sessions because the target is saved.
- **Cons:** Requires user to *have* a target voice in mind. Discovery-phase users (first few weeks of training) may not know what they want yet, and the target-recording UX has a high cold-start cost. CPP of a target sample is computed on a different recording session/microphone/environment than the user's live audio, which means absolute-CPP comparison has a calibration drift. Mitigated by always re-recording the target at the same session as the current voice when target is being captured — but then the target re-anchors too.
- **Implementation cost:** Medium. UI for target capture, IndexedDB persistence (Syrinx already has Dexie infra), some sort of "this is your target" workflow.

### 4.4 Hybrid self+target (TruVox-style; recommended)

- **Mechanism:** Persisted self-baseline (one-time capture, not per-session) + optional persisted target. Gauge shows current position along the journey from saved baseline → current → saved target. Per-session re-baseline can be triggered explicitly ("update my baseline") but isn't automatic.
- **Pros:** Combines the strengths. Baseline marker shows "where I started" (motivational; not stale). Target shows "where I'm going" (Hancock-individualized). Current value shows "where I am right now" (real-time feedback). Cross-session continuity by construction.
- **Cons:** Two anchors to manage in the UI, somewhat busier than a single gauge. Target is still subjective — user may pick a target that doesn't correspond to their actual goal, requiring an "update target" flow.
- **Implementation cost:** Medium. Same as 4.3 plus baseline persistence (cheap given Dexie infra). Most of the cost is UX design, not engineering.

### 4.5 Self-anchored with persistence (no target)

- **Mechanism:** Capture baseline once, persist, never auto-re-baseline. Same gauge math as current (μ ± 2σ), but the μ/σ are saved permanently after first session.
- **Pros:** Solves the staleness problem (baseline doesn't drift). Cheaper than adding target capture. Cross-session continuity.
- **Cons:** Still suffers from starting-point problem — user has no target to aim for. If first session captured a non-representative baseline (mixed modes, illness, low energy), it's stuck. Needs at minimum a "re-baseline now" button for explicit user intervention.
- **Implementation cost:** Low. Persistence + a manual re-baseline button. Smallest delta from current ship.

### 4.6 Goal-tracking (explicit milestone-based)

- **Mechanism:** User sets explicit milestones ("reach lighter than my current 25th percentile by Week 4"). Gauge displays progress toward milestone.
- **Pros:** Matches gamification mental models. Highly motivating when working.
- **Cons:** Bush et al. 2024 explicitly cautioned about overemphasizing goals — users who plateau feel demotivated. Requires the user to set milestones, which is a planning task many users won't do well at the start.
- **Implementation cost:** High. Milestone tracking, notifications, plateau-detection UX. Out of proportion for the calibration question alone.

### 4.7 Subjective rating + acoustic measure

- **Mechanism:** Listener (or self-) rates perceived weight on a Likert scale during calibration; acoustic measure is mapped to perceptual rating.
- **Pros:** Most theoretically grounded — directly maps the acoustic to the perceptual.
- **Cons:** Out of scope per prior project decision (subjective rating infrastructure is months of work). Would require a panel-rated reference set (Aaen-2025-style methodology, mentioned in the prompt).
- **Implementation cost:** Very high. Explicitly excluded.

---

## 5. Stage D: recommendation for Syrinx

### 5.1 Primary recommendation: hybrid self+target with persisted baseline

Implement §4.4. Concretely:

1. **First-session onboarding**: capture a CPP baseline over ~30 s of voiced speech (existing mechanic). **Persist it to IndexedDB** rather than discarding at session end. Mark it as "your starting voice."
2. **Optional target capture**: present a UX flow ("record a sample of the voice you're working toward, or skip for now") at onboarding or via settings. Allow re-recording at any time. If captured, compute target CPP from the same Maryn-style pipeline and persist.
3. **Gauge display**: scale axis goes from saved-baseline CPP to either (a) saved-target CPP if set, or (b) baseline + 1 SD in the "lighter" direction as a soft default if not set. Current CPP renders as a marker on that scale. Baseline shows as a distinct "start" tick; target (if set) shows as a distinct "goal" tick. Gauge polarity (Lighter↔Heavier) is determined by sign of (target − baseline) — handles both feminization and masculinization users without conditionals.
4. **Explicit re-baseline**: user can re-baseline from settings (NOT automatic). When triggered, save the new baseline alongside (or replacing) the old one — design choice: probably "replace, with a one-time confirmation," to avoid baseline-clutter.
5. **No automatic baseline drift**. The current per-session re-baselining is the exact bug we're fixing.

This is structurally what TruVox does for resonance and is the only approach in this research that addresses all four user-identified flaws:
- Starting-point anchoring → solved by allowing target as a separate anchor
- Staleness → solved by not auto-re-baselining
- Exploration-pollution → mitigated (baseline is set deliberately, not from arbitrary first 30 s of subsequent sessions)
- Cross-session continuity → built-in (baseline persisted)

### 5.2 Fallback recommendation: persisted self-baseline only (no target)

If the target-recording UX is more work than the ship timeline allows, the minimum viable fix is §4.5. Save the baseline, expose a "re-baseline now" button, otherwise leave the gauge math alone. This is a one-day implementation that addresses staleness and cross-session continuity without the target-UX surface area. Starting-point anchoring is not fully addressed — the user still has no goal — but the deterioration over months is fixed.

### 5.3 What NOT to ship (and why)

- **Pure population-anchored (§4.2)** — CPP-to-perceived-vocal-weight mapping is not in the published literature. Shipping fixed Lighter/Heavier endpoints would require derivation work that is out of scope for this calibration ship (it's a listener-study question, not a research-paper-citation question). Population endpoints could be added *as an overlay* later (e.g., "typical CPP range for trained feminine voice is X–Y"), but should not be the gauge's primary scale.
- **Goal-tracking milestones (§4.6)** — Bush et al.'s caution on goal-overemphasis is the right caution. Don't gamify before validating the underlying gauge.
- **Subjective rating (§4.7)** — explicitly out of scope per prior project decision.

### 5.4 Tradeoffs accepted under the primary recommendation

- **The target is user-subjective.** Two users with the same target ("lighter") may pick different reference voices and end up with different CPP targets. This is fine — Hancock's research argues this is actually correct (individualized goals), and the gauge math is internally consistent for each user.
- **CPP measurement drift across recording sessions remains.** If the target was recorded on the same mic/room as today's session, comparison is clean. If recorded weeks ago on a different mic, there's drift. Honest mitigation: re-record target periodically; document the recommendation in onboarding.
- **The Lighter↔Heavier semantics are inferred from sign-of-difference, not from absolute CPP.** This means a user training to be heavier (e.g., transmasculine) sees the gauge oriented the same way as a transfeminine user; both see "moving toward target" rendered consistently. Gauge labeling needs to reflect this (probably: "your starting voice" / "your target voice" rather than fixed "Lighter" / "Heavier" anchors).
- **First-session UX adds a target-capture step.** This is friction at onboarding. Mitigation: make it skippable, default to "no target set" which falls back to §4.5 behavior. User can add a target later.
- **The CPP-to-perceived-weight mapping is still unvalidated.** A user might record a "lighter" target whose CPP is actually *higher* than baseline (depending on what dimensions of weight the user is perceiving — breathiness vs brightness vs effort). The gauge will then show movement toward target as their CPP rises, which may or may not correspond to perceived weight change. This is a known limit. The mitigation is honest documentation in the UI ("this gauge tracks acoustic similarity to your target; it does not guarantee perceptual weight match"). A future listener-study could validate the mapping.

### 5.5 Confidence level in this recommendation

- High that hybrid self+target is empirically the strongest approach (TruVox 2025, Hancock papers, Bush 2024 all converge).
- Medium-high that it's the right fit for Syrinx specifically (we have IndexedDB infra, real-time CPP, and a single-user/single-device deployment model — this is mid-cost work, not infra-fork work).
- Medium that vocal weight should be quantified at all in a self-training app (no surveyed app does it, suggesting either the field hasn't tried yet or has tried and concluded it's not useful enough to ship). Syrinx is partially defining the convention here.

---

## 6. Open questions / what this research can't answer

1. **CPP-to-perceived-weight mapping.** No published research directly maps CPP values to perceived vocal weight. Mapping it would require a listener-rating study (out of scope for this ship). Workaround: ship the user-subjective target mechanism, document the unvalidated-mapping limit honestly in-app.

2. **Cross-microphone CPP calibration drift.** Maryn CPPs is microphone-and-distance-sensitive. Users who change devices (phone → laptop, headset → built-in mic) will see CPP shifts that aren't voice changes. Mitigation: recommend re-baselining when device changes; possibly add a brief "calibration tone" capture to estimate the offset. This is a measurement-engineering question, not a calibration-UX question, and is properly investigated separately.

3. **Whether "target voice" UX actually gets used in practice.** TruVox's usability study showed users *wanted* target-setting, but didn't measure how often users persisted with a target vs. defaulted to "no target." Could be a low-engagement feature. Mitigation: ship the fallback (§4.5) regardless so users who skip target capture still get value.

4. **Direct r/transvoice community sentiment on vocal-weight gauges.** Reddit and Discord weren't directly fetchable during this research. Subjective community priorities on this exact question may shift the design — e.g., if r/transvoice users are vocal about wanting absolute scales (population-anchored) over self-relative scales. Worth a follow-up read of the subreddit by the user before final ship.

5. **Whether 30 s is enough baseline capture.** Maryn-style CPPs is stable across utterances, but if the user's first 30 s isn't representative (mostly silence, illness, voice fatigue) the baseline anchor is bad. TruVox uses longer baselines in clinician-supervised flows. Worth empirical measurement: how much CPP variance exists across 30 s windows from the same speaker within the same session. (Out of scope here; punt to a measurement followup if the ship calls for it.)

6. **Should baseline and target be re-derivable?** I.e., should the user be able to delete and re-record either anchor cleanly, vs. accumulate a history of baselines for visualizing "the user's voice over months"? The persistence-history version is more powerful but a bigger UX investment. Probably ship single-baseline + single-target first, add history later if requested.

---

## 7. Sources

Peer-reviewed:
- Bush EJ, Krueger BI, Cody M, Clapp JD, Novak VD. *Considerations for Voice and Communication Training Software for Transgender and Nonbinary People.* Journal of Voice, 2024.
- McAllister et al. *TruVox: Design and Usability Testing of a Web-Based Software Module That Provides Visual-Acoustic Biofeedback for Vocal Tract Resonance.* Journal of Voice, 2025.
- Weese et al. *TruVox Vocal Pitch Training.* JMIR Formative Research, 2025.
- Hancock AB et al. (2017, 2025) — individualized goal-setting in trans voice therapy; VCSQ-PFAB questionnaire.
- Adler RK, Hirsch S, Pickering J. *Voice and Communication Therapy for the Transgender/Gender Diverse Client: A Comprehensive Clinical Guide,* 3rd ed., Plural Publishing.
- Dacakis G, Oates J. *TVQ-MtF (Transsexual Voice Questionnaire for Male-to-Female)* — perceptual self-rating instrument.
- Lin et al. 2023, Leyns et al. 2023, Eng 2021 — CPP/CPPs in transgender voice therapy outcomes.

Tools surveyed (URLs accessed during research):
- TruVox: https://wp.nyu.edu/bitslab/
- Christella VoiceUp: https://speechtools.co (overview page only; product page returned 500)
- Voice Tools (DEVExtras): https://devextras.com/voicetools
- Voice Analyst (Speechtools): https://speechtools.co/voiceanalyst (description fetched)
- Acoustic Gender: https://acousticgender.space
- Resona: secondary description (resona.app TLS error)
- VoiceShift: https://voiceshift.app
- Vocal Congruence Project: vocalcongruence.org (overview only; deep pages returned ECONNREFUSED)
- Friture: https://friture.org (general audio analyzer, no vocal-weight metric — confirmed)
- InFormant: https://in-formant.app (research tool, no calibration UX)

Reference Wikipedia articles (background context):
- https://en.wikipedia.org/wiki/Voice_feminization
- https://en.wikipedia.org/wiki/Voice_therapy
- https://en.wikipedia.org/wiki/Estill_Voice_Training

Community resources (referenced indirectly via search snippets only; direct fetch blocked):
- r/transvoice (Reddit access blocked in research environment)
- Renee Yoxon: reneeyoxon.com (overview page only; blog post 404)
- Undead Voice: undeadvoice.com (overview only; methodology not documented publicly)

### Research-environment limitations honest disclosure

- Reddit, Discord, Startpage, and several voice-training-coach sites were blocked or returned errors during fetch.
- DuckDuckGo search rate-limited me into CAPTCHAs after extensive querying. Google Scholar remained accessible and provided most of the academic citations.
- Several primary app pages (Christella VoiceUp, Voice Analyst, Renee Yoxon blog) returned 404 or 500 errors at the URLs I had. Where this happened, I noted it inline and used secondary sources (academic citations describing the apps, store-listing aggregators) which are less authoritative but were the best available.
- The recommendation in §5.1 leans heavily on TruVox 2025 because it's the closest direct analog and is well-documented in peer-reviewed work. If TruVox's methodology turns out to differ in ways the published abstracts didn't capture, the recommendation may need adjustment. The full TruVox paper at ScienceDirect was paywalled (403 during fetch) — accessing it via institutional library would strengthen this recommendation but does not change the structural finding.

---

## 8. Appendix — supplemental r/transvoice + SLP-blog research (2026-05-11)

Open question #4 from §6 (community sentiment uncaptured during initial research) was addressed via a second pass using the Byparr proxy at `http://10.0.0.117:8192/v1` to bypass Cloudflare on Reddit. 11 sources retrieved; signal converges with the main recommendation.

### 8.1 Tooling note — what worked

Byparr handled `old.reddit.com` thread URLs reliably (after one cold-start 500 error). `www.reddit.com` URLs returned cookie/challenge-pages; `old.reddit.com` returned full rendered HTML with comment text. DuckDuckGo via byparr worked for fan-out search; Google was CAPTCHA-blocked. Susan's Place forum returned 403 (likely user-agent/referrer gating beyond byparr's handling).

| Source | Method | Result |
|---|---|---|
| r/transvoice search "vocal weight" | Byparr → reddit search page | ✓ thread index recovered |
| r/transvoice thread bodies (7 fetched) | Byparr → old.reddit.com | ✓ comments + post text recovered |
| r/transvoice search "TruVox" | Byparr → reddit search page | ✓ zero relevant thread matches |
| DuckDuckGo Hancock/Yoxon/SLP commentary searches | Byparr → DDG | ✓ partial — surface results recovered, deep mining limited |
| Susan's Place forum search | Byparr → susans.org | ✗ 403 from origin |
| Google search | Byparr → google.com | ✗ CAPTCHA block |
| Genieus Communication SLP blog | Byparr → genieuscommunication.com | ✓ full page recovered |

### 8.2 Community signal on vocal weight as a quantified gauge

**Threads consulted** (paraphrased findings; URLs included for verification rather than verbatim quotes per privacy constraint):

- *Tools to measure resonance/vocal weight?* (r/transvoice, 4 yr old). User explicitly asks for vocal-weight measurement tools. A community voice coach (flair: "voice coach") responds: there is no accurate way to measure vocal weight currently available, and even with the best setup imaginable it would not be accurate. Multiple commenters second this. The poster's framing — "I know there's pitch measuring apps; I couldn't find anything similar for resonance or vocal weight" — confirms the §2.10 finding that no surveyed tool surfaces vocal weight.

- *Can someone explain Vocal weight as simply as possible?* (r/transvoice, ~1 yr old). Top responses come from community voice coaches. They describe vocal weight as **biomechanical** (vocal-fold mass involvement during phonation) and **perceptual** ("a softer or more weighty effect to the sound") — never as an acoustic measurement target. The community-recognized voice teacher `TheTransApocalypse` (flair: "Voice Feminization Teacher") describes weight as "the force you put into your voice, which can be heard as a kind of buzzing or rumbling quality" and notes biomechanics via thick-fold/thin-fold framing.

- *What \*is\* vocal weight?* (r/transvoice, 1 mo old). The same teacher (`TheTransApocalypse`) gives the most direct acoustic-to-perceptual statement found in the community research: **"Acoustically, vocal weight is more or less analogous to the spectral slope or spectral rolloff point of your sound."** This validates the Syrinx-style approach (using a spectral/cepstral measure as a vocal-weight correlate) — it's congruent with the community's understanding of what the measure should reflect. CPP and spectral tilt are related (both spectral-shape descriptors); Syrinx's CPP-based gauge is consistent with how the community already thinks about the acoustic side of weight.

- *How did you do it (Vocal weight)?* (r/transvoice, 2 mo old). The poster, 1 year into voice feminization, is "stuck on vocal weight" and asks how others modulated theirs. Community responses emphasize **listening + imitation + proprioception**, not measurement. One response uses "baseline" naturally: "Does the quality get lighter than baseline at that pitch?" — community vocabulary for "compared to your usual voice" already includes the word "baseline."

- *[Tool] I built a voice analyzer because I wanted more than a pitch number* (r/transvoice, 15 days old — directly contemporary). A community member built their own voice analyzer (ASR + forced alignment + per-phoneme formants + z-scores against a reference distribution). Most relevant comments:
  - **"The most difficult part is base unit and baseline setting, it requires extensive knowledge of physiology and analysis"** — community member articulating that baseline-setting is the hard problem. Confirms the audit-level question Syrinx is currently working on.
  - **"I'd love a way to track progress with time, not just list the previous sessions"** — direct request for cross-session continuity. Maps exactly onto the §5.1 recommendation's "persisted baseline / cross-session anchor" property.
  - Some skepticism about NN-based gauges of voice quality; agreement that direct acoustic measurements (pitch, formants, presumably similar for CPP) are more trustworthy than NN predictions.
  - The tool builder iterated mid-thread to "reduce the appearance of numbers" and "redistribute attention so direct measurements take visual priority" — community-derived UX feedback that gauges shouldn't lead with raw numbers. Aligns with Syrinx's σ-distance + correlate-framing UI choices.

- *Feedback after finding a baseline/beta femme voice* (r/transvoice, ~2 yr old). Title alone confirms community usage of "baseline" as a meaningful concept for "the voice I've worked out so far."

- *Trying to make my baseline voice pass better* (r/transvoice). Same lexical pattern — "baseline voice" used naturally.

### 8.3 TruVox-specific community discussion: essentially zero

Direct search of r/transvoice for "TruVox" returned no relevant threads. Cross-checked via DuckDuckGo for `"TruVox" site:reddit.com /r/transvoice` — same zero. This is itself a finding worth surfacing:

- TruVox is published in *Journal of Voice* 2025 (peer-reviewed, NYU BITS Lab, free, web-based — all positive distribution attributes) and has accumulated zero r/transvoice community footprint as of mid-2026.
- Either: (a) it's too new for community pickup (paper is months old), (b) it's not getting traction in the self-training community despite SLP validation, or (c) it's been discussed under different names. Cannot disambiguate from search alone.
- **Implication for Syrinx:** the TruVox precedent in §5.1 is academically-grounded but not yet community-validated. Don't treat TruVox's empirical-usability validation as evidence that the community at large will receive the same approach well. Honest framing.

### 8.4 SLP / voice-coach commentary on quantified vocal weight

**Genie Gokhman (SLP, Ottawa) — Genius Communication blog "Vocal Weight in Gender Voice Therapy"** (`genieuscommunication.com/blog/blog-weight-in-gender-affirming-voice-therapy`). The post teaches vocal weight perceptually and biomechanically — vocal-fold thickness, how to listen for it, how to feel it. **No quantified-gauge concept**; the entire approach is perceptual + proprioceptive demonstration. Aligns with the §2.10 synthesis that the clinical convention is perceptual instruction, not acoustic measurement.

`TheTransApocalypse` (community-recognized voice feminization teacher on r/transvoice). Spectral-slope framing of weight is congruent with the acoustic measure Syrinx ships. They explicitly bridge from acoustic-side ("spectral slope") to perceptual-side ("buzzing or rumbling quality") in plain-language community posts — exactly the bridge a Syrinx gauge needs to communicate.

Renee Yoxon, Undead Voice, Sandy Hirsch — primary sites either 404'd or paywalled during the direct-fetch attempt; secondary discussion in community threads reinforces that all three teach perceptual + proprioceptive methodology, not quantified gauges. (No retrieval-confirmed direct quote.)

### 8.5 What changed in the recommendation post-supplemental

**Nothing structural — §5.1 stands.** The supplemental research strengthens rather than alters the primary recommendation:

1. **Community uses "baseline" as a natural vocabulary item** — the §5.1 UI labeling ("your starting voice / your target voice") is congruent with community discourse. The recommendation already aligned, but now we have evidence.

2. **Community-built tool's iteration history mirrors Syrinx's design path** — same recognition that direct acoustic measurements over NN outputs are more honest; same UX recognition that raw numbers should not dominate visual hierarchy. Reinforces Syrinx's σ-distance + correlate-framing UI choices.

3. **"Track progress with time" is a directly-articulated community request** — this maps exactly onto the §5.1 cross-session persistence property. Direct community validation that the staleness/no-continuity flaws the user surfaced are real flaws felt by community members.

4. **TheTransApocalypse's spectral-slope framing of weight** is the closest community-language anchor for how Syrinx's CPP gauge will be interpreted. The §5.1 in-app correlate-framing ("tracks acoustic similarity, does not guarantee perceptual weight match") is the right honesty bar — it doesn't claim more than what community-recognized voice teachers already say acoustically about weight.

5. **Zero community discussion of TruVox** weakens the "peer-reviewed precedent therefore community-tested" framing. **Updated framing:** §5.1's hybrid self+target approach has *academic* validation (TruVox 2025, Bush 2024, Hancock work) but has not been empirically tested at the community-adoption level. This is not a blocker for ship, but should be in the PR description's honesty bar.

### 8.6 Tradeoffs no longer hidden

The supplemental research surfaces one item that should be explicit in the PR description that wasn't in the original recommendation:

- **Vocal weight is taught perceptually by the trans-voice-training community and SLP clinical convention. A quantified gauge is a new modality, not a replacement for perceptual training.** Syrinx's gauge complements perceptual training (gives an objective trace that confirms or contradicts the user's perception) but doesn't substitute for it. The in-app subtitle / tooltip should make this distinction. Recommend: "Your gauge tracks acoustic similarity to your target. Use it alongside your ear, not instead of it."

### 8.7 Updated confidence assessment

- **High** that hybrid self+target is the empirically strongest approach for a quantified gauge (TruVox 2025, Hancock 2017/2025, Bush 2024, plus now-confirmed community request for "track progress with time" + community-natural "baseline" vocabulary).
- **High** that the recommendation handles the community signal correctly (no contradicting evidence surfaced; multiple convergent signals).
- **Medium** that quantified vocal-weight feedback adds value beyond perceptual training as conventionally taught — the community currently teaches it perceptually for sound reasons. Syrinx is partially defining a new modality. The in-app framing must reflect that.
- **Confidence in TruVox-as-precedent** dropped slightly: it's an SLP-validated approach with zero r/transvoice community footprint. Still the best analog, but its empirical-community-validation status is weaker than the peer-reviewed status alone suggested.

### 8.8 Honest disclosure of remaining gaps

- Discord communities not searched (no Byparr-equipped Discord search workflow available).
- Susan's Place forum returned 403; community-on-vocal-weight signal from that forum unconfirmed.
- Renee Yoxon, Undead Voice, Sandy Hirsch primary content not directly retrieved — secondary signal only.
- 60-90 minute research budget used ~50 minutes; diminishing returns from further byparr queries on this corpus.
