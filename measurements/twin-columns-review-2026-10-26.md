# Twin-columns UI review — 2026-10-26

An independent review-and-fix pass over branch `ui-twin-columns` (base `beta`; reviewed head a708db1). The branch redraws the Dashboard's cue strip as two vertical meters ("twin columns") and the "Likely heard as" panel as a half-circle dome. This is a UI review only: no private data was used, no audio / DSP worker was changed, and nothing under CLAUDE.md hard rule 3 was touched. The owner's settled decisions were not reopened: the look, neutral resonance, pitch green / red with a filled or hollow thumb, soft band fills, the panel's row layout, and the phone meter cap with the panel below the first screen.

## Method

**Five reviewers, one lens each, working independently.** Each verified its claims by reading code or running it:

- (a) cue-strip correctness, including the trace-vs-strip question below;
- (b) the dome panel;
- (c) responsive layout of the built app;
- (d) accessibility;
- (e) tests and smokes.

**One skeptical verifier per group of medium / high findings.** Each tried to refute or reproduce them; what survived was fixed.

**Browser.** All browser work used:

- the built `dist/`, served by `vite preview`;
- headless Chrome for Testing (Chromium 1243) via puppeteer-core;
- Chrome's fake mic playing a synthetic 48 kHz voiced glide (110 → 220 Hz with formants, 4.5 s voiced / 1.5 s pauses);
- the "Likely heard as" panel forced through its states with `scripts/heard-as/panel-force.mjs`, with the model hosts blocked.

LibriSpeech is not available in this environment.

**Probe sizes:**

| Group | Sizes |
|---|---|
| Phones (DPR 3, touch) | 320×568, 360×690, 375×667, 390×844, 412×915, 430×932 |
| Tablets | 768×1024, 820×1180 |
| Desktop | 1024×600, 1180×820, 1280×800, 1366×657, 1920×1080, 2560×1440 |
| Landscape | 844×390, 915×412 |
| Short-desktop range | 1024–1250 wide × 560–800 tall |
| Height sweeps | 860–1040 px tall in 2–4 px steps, at widths 360, 390, 412, 430, 448 and 768 |

At each size the probe checked the panel on and off, at scroll top and at scroll end, for:

- horizontal scroll;
- text overlaps and clipped labels;
- content cut by the practice dock;
- inner scrollbars;
- dome-sentence lines sliced at the fold.

## Findings

Severity is the verified one. **Fixed** commits are on `ui-twin-columns`.

| # | Lens | Sev. | Finding | Verdict |
|---|---|---|---|---|
| 1 | e, d | high | **Steadiness "i" hit area at 360 px.** About 9 % of its 44 px hit area landed on the resonance column: the SVG first, then the meter box. A tap there did nothing, and `cue-strip-smoke --viewport=p360` would fail its hit-area check. | **Fixed**, bd202fb: `z-10` on the compact button, as the strip's own info toggles have. The first attempt (62d9126, `pointer-events-none` on the meter SVG) did not fix it; the verifier caught that, and the SVG change stays as harmless decoration hygiene. Hit areas are now 1.0 at 360 / 402 / 448 / 890×360 / 1280×800 in both directions. |
| 2 | a | medium | **Trace and strip disagree** (the reported phone screenshot). The trace's glow dot stays on the last painted point for 500 ms. Meanwhile the hook clears `pitchLevel` at once when the paint gate holds back an octave-class jump (200 ms with the real throttle) or the voice gate hides a frame (300–450 ms), and leaves it null for up to 175 ms after the trace paints at voice onset. In those windows the trace shows a live dot at "now" while the Pitch column shows "— Hz" with no thumb. The hook, PitchTrace and the model are unchanged from beta, so beta behaves the same. This branch makes it visible: a 22–34 px "—" beside an empty meter, instead of a 14 px header. | **Fixed**, 3c78b8f: the glow is drawn only while `(voiced \|\| holding) && pitchLevel != null`, the same props the strip reads. Posted, painted and recorded values are unchanged. `visual-check.mjs`: 33/33, trace pixels identical. |
| 3 | c | medium | **Phone fold cuts the dome's sentence.** On portrait phones with a visible height of about 921–963 px (e.g. 430×932, at every width from 360 to 768), the end of the first screen cut a line of the dome's sentence in half. Above ~923 px the trace (240 px cap) and the meters (270 px cap) stop growing, while the fold keeps moving down. New compared with beta. | **Fixed**, bd202fb: `phonefold` variant (index.css). In that band the trace takes `calc(100dvh − 678px)`, so the sentence starts just below the fold. Re-probed at widths 360 / 412 / 430 and heights 900–1000 (4 px steps plus 921 / 963 / 964): no line cut. The trace steps from 240 to 285 px at 963 → 964. |
| 4 | c | medium | **Short-desktop column scrolls.** At 1024–1179 px wide and under 800 px tall (1024×768, 1100×768, 1150×768, 1024×700, 1100×657, 1024×799) the right-hand column scrolled 14 px and clipped the caveat / More. With the column at its 420 px floor, the text beside the 220 px row-layout dome wrapped one more line (panel 269 px instead of the 253 px the meter formula assumes). New compared with beta. | **Fixed**, bd202fb: the 220 px dome only from 1180 px wide (`deskwide`), 200 px below. No scroll at all of those sizes, nor at 1179 / 1180×768, 1366×657 / 768. |
| 5 | c | low/med | **Laptop windows under 648 px tall** (e.g. 1366×640, a 1366×768 laptop with a bookmarks bar) scrolled the column, because the meters hit their 120 px floor. Not a regression: beta scrolled more at the same sizes. | **Fixed**, bd202fb: short-desktop floor lowered to 100 px, the height short landscape already uses. No scroll down to 628 px tall. Below that it still scrolls (1366×620 by 6 px, 1024×600 by 26 px). |
| 6 | e | medium | **Vacuous phone warning check.** The smoke's phone check for the pitch-only warning could never fail. Its rule was "if any sentence line shows at scrollTop 0, so does the warning", and on phones the sentence is below the first screen by design. Beta required the warning on the first screen at 448×890. CLAUDE.md still claimed that. | **Fixed**, b0414c5. Every viewport now requires the warning directly under the dome (≤ 60 px; measured 6–44 px). Phones also require that no sentence line is sliced by the first screen's end. CLAUDE.md now states the reduced guarantee. |
| 7 | e | medium | **Band labels untested.** `meterGeometry`, `stackLabels` and `bandLabels` had no unit test and no smoke check. The verifier found no overlap at any reachable height (8,352 cases), so this was a test gap, not a product bug. | **Fixed**, b0414c5: moved unchanged to `src/components/cueMeterGeometry.js`, plus `tests/audio/cue-meter-geometry-test.js` (in `test:unit`). It covers 3,232 cases: meter heights 100–300 px × 4 directions × 2 cues × 4 tiers. It checks: no labels touching; labels inside the track and left of the outline; full words from 150 px; one "target" word. A mutation (stacking gap −6 px) makes it fail. Cue-strip values are identical in `visual-check.mjs`. |
| 8 | e | medium | **Dome orientation checked in DOM order only.** The smoke checked the dome's tenths and the key row by DOM order and attributes. Beta compared on-screen rects, so a CSS mirror or a reordered key row would now pass. | **Fixed**, b0414c5: tenth 0's centre must be left of tenth 9's, and the "would say man" key must come before "would say woman" in reading order (left of it in one row, above it when stacked). Logic verified on forced states at 360 / 402 / 448 / 890×360 / 1280×800 / 1366×657 / 1100×768. |
| 9 | e | medium | **"Sentence inside the dome" barely exercised.** The check ran only on the two live voices' readings at the smoke's one viewport, never at the row layout. | **Fixed**, b0414c5: `lab-layout-smoke` part 5 runs it on every forced shown estimate. Ran here: 68 states × p360, p448, desktop, 1366×657, 890×448 — 35/35 pass. The check also fails if it ran on no state at all. |
| 10 | e | low | **Row-layout assertion missing.** The desktop-column check claimed "row layout" but never asserted it, and the value it collected read "grid" in both layouts. | **Fixed**, a1fed1c: requires a 200 / 220 px dome with its key beside it. Also now checks 1100×768 and 1024×628. Verified on the built app. |
| 11 | e | low | **"Reads upwards" passed without the bands.** It passed whenever the resonance bands had not loaded. | **Fixed**, a1fed1c: waits for the bands and requires both columns. |
| 12 | a | low | **Idle trail re-rendered both columns 4× a second.** While idle, the trail returned a new empty array on every tick. | **Fixed**, 62d9126. |
| 13 | a, e | low | **Stale CLAUDE.md wording.** It still described the single-word labels, "trail marks", "bands outlined (≥ 3:1)" and the best-guess ring. | **Fixed**, b0414c5. |
| 14 | b, d | low | **Dome sentence smaller in the row layout.** The sentence is drawn at `min(16px, 5.4cqw)`: 10.8 px in a 200 px dome and 11.9 px in a 220 px dome, below the 12 px unsure line (beta: 14 px `text-sm`). It also does not follow the user's font size (px, not rem), and has 10–18 px of slack inside the hollow under WCAG text spacing. | **Not fixed.** A floor (e.g. 12 px) overflows the hollow of the 200 px dome (~4.7 px spare at 10.8 px), and the row layout is a settled decision. **Owner's call:** accept it, or make the hollow follow the text size. |
| 15 | d | low | **Sentence read as two lines.** Screen readers in browse mode meet the dome sentence as two text nodes (two `block` spans). | **Not fixed.** No reliably better cross-reader markup (`aria-label` on a `<p>` is not reliably read). Beta's naturally wrapped single run was also read per visual line by some readers. |
| 16 | d | low | **Value read twice, possibly different.** Each column's 1 Hz screen-reader summary is followed by the visible number, so a reader can hear two values that disagree. | **Not fixed.** Behaves as on beta. Possible follow-up: `aria-hidden` on the visible value block. |
| 17 | c | low | **Sideways scroll at 320 px.** At 320×568 the scroll area scrolls sideways by 15 px: the "Resonance · approx. (i)" title row does not wrap, and its hit area overflows. "↑ higher" also crosses the column divider. | **Not fixed.** Below the app's stated 360 px minimum. Possible follow-up: `overflow-x-clip` on the scroll area, or hiding "· approx." below ~340 px. |
| 18 | c | low | **Tablet fold cuts the warning.** At 768×1024 the first screen's end cuts the pitch-only warning's first line (same mechanism as #3, at a taller height). The sentence itself is not cut. | **Not fixed.** Low. |
| 19 | b | — | Dome arcs vs tenths, rounding, stripes, mirror symmetry, the words fixture (unchanged), one panel height in 82 states × 7 viewports, forced colours, and the `data-*` hooks. | **Checked**, no defect. |
| 20 | a | — | Every cue-strip state, thumb vs value, chevrons, start ring / change line, androgynous / exploring targets, reduced motion, and every `data-*` hook the smokes and tests read. | **Checked**, no regression. |
| 21 | d | — | Focus order and visible focus, live regions (0 mutations of the only live region in 10 s of listening), contrast of new text (≥ 7.1:1), and forced colours light / dark. | **Checked**, no defect. |

## Checks run on the fixed head

- `npm run lint`: clean.
- `npm run test:unit`: 74/74 scripts pass, including the new `cue-meter-geometry-test.js`.
- `npm run build`: OK.
- `scripts/main-thread/visual-check.mjs` against the pre-fix tree (Chrome for Testing, via a temporary copy with the local Chrome path): 33/33. Trace pixels and cue-strip ticks are identical.
- `scripts/resonance-lab/lab-layout-smoke.mjs --layout=0 --panel=0` (part 5, forced states, synthetic WAV, local Chrome via a temporary copy): 35/35.
- Hit areas with the smoke's own `hitAreas()` code: all 1.0 at five viewports and both directions.
- Viewport probe re-run on the fixed build (the sizes above). No horizontal scroll, overlaps, dock cuts or inner scroll were found, except the known low items (#5 below 628 px, #17 at 320 px). The probe also counts the screen-reader-only "Mic off" label (a 1 px box) as clipped; that is expected.

## Still needs the owner's PC

The full browser smokes need the LibriSpeech speech WAVs (`scripts/cue-strip-smoke-wavs.mjs --r1=…`), which only the owner's PC has:

- `cue-strip-smoke.mjs` at every viewport (phone, p402, p360, landscape, desktop), including `--pitch-only` and `--pitch-only-late`. These exercise the new on-screen-order, warning-under-dome, row-layout and band-wait assertions with live voices.
- `lab-layout-smoke.mjs` parts 1–4 (live speech, model download).
- The phone check of the `phonefold` band on a real device whose visible height falls in 921–963 px.
