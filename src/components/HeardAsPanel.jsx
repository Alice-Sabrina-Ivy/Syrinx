// HeardAsPanel.jsx — "Likely heard as · Experimental" (ON by default since
// 2026-10-25, user decision: it downloads by itself and has no turn-on button;
// until then it was opt-in with an off row and a "Turn on · up to N MB"
// button). Settings' switch is the only way to turn it off; off, the panel
// renders nothing. The user chose to ship it as a clearly labelled
// experiment with its known weaknesses disclosed.
//
// THE DOME (owner's choice 2026-10-25, the "Gauges" mockup's panel beside the
// "Twin columns" meters): the split bar below, bent into a semicircle of ten
// tenth-segments — "would say man" from the LEFT foot in deep indigo, "would
// say woman" from the RIGHT foot in light indigo, the tenths between striped
// (could go either way), 2 px of panel between segments, a tick above the
// top at the middle; the sentence centred INSIDE the dome on two lines; under
// it a key row (would say man / could go either way / would say woman), then
// the pitch-only note's slot, the unsure line, the legend, the caveat + More.
// Drawing only: numbers, words, colours and every state are the split bar's
// (heardAsAxisModel.js unchanged); geometry in heardAsDome.js. The sentence is
// drawn over the dome by an overlay placed after the pitch-only note in the
// DOM, so screen readers still meet the bar's description, the note (when on)
// and then the sentence, as with the bar. Hidden states keep the dome on
// screen, its segments empty and greyed, with the reason under it.
//
// Until 2026-10-25 (the text below describes that bar; its rules all hold):
// Shows how listeners in published studies
// might hear the voice on ONE SPLIT BAR (user decision 2026-10-20; it
// replaced the 2026-10-07 axis with a shaded range and a ring): ten tenths of
// listeners, "would say man" filling from the left (the cue strip's
// orientation) in deep indigo, "would say woman" from the right in light
// indigo — each solid part the LOW end of its range — and the part between
// them striped (could go either way; a pattern, so it never relies on colour
// alone), a small deep / light colour key beside the end words "would say man"
// / "would say woman"; no best-guess mark (review 2026-10-20: a mark at the
// split point sat over the end word of the answer FEWER listeners would give,
// so it read backwards). Under it, in larger text,
// one sentence for the side the panel's best guess favours, that guess
// rounded to a whole tenth ("About 9 in 10 listeners would say man"; user
// decisions 2026-10-21 — until then both sides as ranges, "About 5–10 in 10
// would say man · about 0–5 in 10 would say woman", which read as confusing,
// and then, briefly, the middle of the range, which read about a tenth low)
// and the unsure / neither share as one text line — never a single verdict,
// no percent signs, the same words and colours in every direction. Two shades of ONE colour: never the app's green / red (on / off
// target) or amber (experimental / warning), never pink / blue; the shades
// are theme tokens in src/index.css (--color-heard-man / --color-heard-woman,
// >= 3:1 against the panel and each other; Windows high-contrast mode:
// solid / striped / hollow in system colours). When the range spans 8
// tenths or more it is mostly stripes, the unsure line is dropped and it says
// "Could go either way — listeners would be split" (user decision 2026-10-21
// (1): it said "Can't tell yet", which promised that waiting helps; "Can't
// tell yet" is now only in the "short" reason — no reading yet); it says the
// same, keeping the unsure line, when the range is not wide but the best
// guess rounds to 5 in 10 (none inside the tested range today). An estimate older than 2 s says
// "Older reading" in its legend line (nothing is dimmed: dimming took text
// below WCAG contrast). The first caveat sentence stays on screen; the rest
// of it and the long explanation are behind "More". Layout numbers and words:
// heardAsAxisModel.js (unit-tested; the unsure words are the 2026-10-07
// axis's, unchanged; the range sentence is the 2026-10-21 one-side best-guess form). Updates every 2 s from the last ~8 s of running speech
// (src/ml/heard-as.js); hides with a reason otherwise — within 250 ms when a
// held note starts. While it shows no reading, the 250 ms check also asks for
// one and shows it as soon as it is ready (2026-10-21, H3 of
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md: the 2 s timer
// added ~1 s to the first reading); once shown, it updates on the 2 s timer.
// That extra check never feeds the pitch-only warning (its update stream stays
// the 2 s one, plus the held-note hides).
// Constants, errors and the evidence for every caveat sentence:
// measurements/heard-as-calibration-2026-10-07.md.
//
// One height in every state (2026-10-20 review: switching between "Keep
// talking", "Can't tell yet" (now "Could go either way") and a range with its "unsure" line moved More,
// Save Session and the notes box by up to ~100 px several times a minute;
// user decision 2026-10-20 (2)). While it shows no estimate (loading, model
// error, "Keep talking", …) the panel keeps the bar on screen, empty and
// greyed, with the reason in the summary sentence's slot, and the text area
// under the bar is as tall as its tallest state: invisible copies of every
// summary sentence, unsure line, the longest legend and every reason share
// its grid cell. Drawing only — no estimate or word changes. The pitch-only
// note's room is reserved too, from switch-on (review 2026-10-20: adding it
// at the note's first appearance moved Save Session and the notes box down by
// ~36-51 px on phones, once per switch-on; extraNote, unused by the app, is
// not reserved).
// scripts/resonance-lab/lab-layout-smoke.mjs checks it with the panel on, in
// live speech and in every forced state (scripts/heard-as/panel-force.mjs);
// scripts/heard-as/panel-shots.mjs takes screenshots of the states.
//
// Notes, shown only while the estimate is, and AT MOST ONE at a time
// (review round 2): the pitch-only-change warning
// (src/ml/pitch-only-warning.js, updated here on the panel's cadence from
// `pitchOnlyRef`; [data-heard-as-note="pitch-only"], data-pitch-only="1")
// sits directly under the axis, so it stays on the first screen wherever the
// axis does; while it is on, the `extraNote` prop (rendered as given
// otherwise, below the range lines) is left out. The old pitch–resonance
// conflict note ("Pitch and resonance point different ways …") was removed
// by user decision 2026-10-07 (E); the pitch-only warning is the panel's
// only built-in note. The warning compares with this session's start — same words in
// every direction. It works when the panel is switched on later too (KS-Q5,
// user decision 2026-10-13, measurement note §8.9): the hook feeds the
// module from the start of listening, and the update() calls here are the
// same either way. Screen readers hear it through a live region that stays
// mounted while the panel is on ([data-heard-as-live]; a region mounted
// together with its text is often not announced), kept through brief hides.
// measurements/heard-as-pitch-only-warning-2026-10-07.md,
// measurements/heard-as-panel-review-2-2026-10-07.md
//
// The gender worker runs only while this is on (useAudioPipeline
// setHeardAsEnabled); off, nothing runs and nothing downloads. On, the first
// listen downloads up to HEARD_AS_DOWNLOAD_MB (src/ml/heard-as-download.js),
// shown as "Loading voice model… N %" in the panel. Hidden reasons come from heard-as.js estimate(); "short" is
// split into "short" / "unvoiced" (whisper) by heardAsAxisModel.js
// shortReason. Since 2026-10-08 only voiced windows count toward the reading
// (heard-as.js logitMinVoicedMs; measurements/heard-as-voiced-windows-2026-10-08.md).

import { useEffect, useId, useRef, useState } from "react";
import { heardAsShares } from "../ml/heard-as";
import { heardAsAxis, AXIS_ENDS, shortReason, quickCheck } from "./heardAsAxisModel";
import { DOME, DOME_PATHS, domeKinds, domeLines, EITHER_WORDS } from "./heardAsDome";
import { HEARD_AS_CALIBRATION } from "../ml/heardAsCalibration";
import { PITCH_ONLY_TEXT } from "../ml/pitch-only-warning";

const STALE_MS = 2000;
const HIDE_CHECK_MS = 250;

// The caveat: its first sentence stays on screen, the rest opens with "More"
// (user decision 2026-10-20: the long explanation behind "More"). Words
// unchanged; HEARD_AS_CAVEAT is the whole of it.
export const HEARD_AS_CAVEAT_SHORT = "Experimental guess at how listeners in published studies might hear you — not a verdict.";
export const HEARD_AS_CAVEAT_MORE =
  "Fitted on trans and cis men's voices, women's voices and computer-altered voices; not tested on trans " +
  "women or nonbinary speakers. It follows pitch more than listeners do: change your pitch without changing " +
  "resonance and it usually shows a bigger change than listeners would hear — sometimes by more than half of " +
  "them — in either direction. Listener groups disagree a lot. Adults' speaking voice only.";
export const HEARD_AS_CAVEAT = `${HEARD_AS_CAVEAT_SHORT} ${HEARD_AS_CAVEAT_MORE}`;

// User decision B (2026-10-07): disclose, in neutral words, that it can't
// tell the user's voice from another voice nearby. The speech detector and
// the classifier score whichever voice they hear — the follow-up probes in
// measurements/low-voice-noise-2026-10-07.md found a nearby voice (a person,
// a TV, a podcast) scored as if it were the user's, whichever sex.
export const ONE_TALKER_TEXT =
  "It works best when you're the only one talking: it can't tell your voice from someone else's nearby, " +
  "or from a TV, radio or podcast, and it guesses for whichever voice it hears.";

// User decision A (2026-10-07): whisper gets no reading. Since 2026-10-08
// only classified windows whose own span holds >= 200 ms of voiced pitch
// count toward the reading (heard-as.js; measurements/heard-as-voiced-windows-2026-10-08.md).
export const WHISPER_TEXT =
  "Whispering gets no reading: it only uses stretches with voiced (pitched) sound, so whispered parts between your voiced speech don't count either.";

// How often the pitch-only warning catches a pitch-only change — the adopted
// rule's own held-out test (A40+KP8-3+DS10, user override 2026-10-12;
// measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6): the test
// split's pitch-shifted sessions in the Meyer failure set, 71 of its 96
// readers (42 women, 29 men; 68 at phase 0), phase-averaged — within 10 s
// 0.863 (male base) / 0.843 (female base), within 15 s 0.919 / 0.906; some
// readers lose most of their hits (one man 7 of the 8 male-base hits lost
// against the old rule) — hence "about 70 people", "about 85 in 100",
// "about 90 in 100", "fewer for some voices". (Until 2026-10-12: "missed
// about 4 in 10", §8.2's S0 figure on 39 LibriSpeech test-other sessions.)
export const PITCH_ONLY_MISSES_TEXT =
  "The note about pitch-only changes doesn't catch every change: in tests on about 70 people it caught about 85 in 100 pitch-only changes within 10 seconds and about 90 in 100 within 15 seconds, and fewer for some voices — so no note doesn't mean the guess is right.";

// The late switch-on (KS-Q5, adopted by user decision 2026-10-13 over its
// pre-registered test's FAIL, 29 of 30 checks; measurements/heard-as-pitch-
// only-warning-2026-10-07.md §8.8, §8.9 and its "Decisions 2026-10-13").
// Replaces "The note about pitch-only changes needs this panel to be on, and
// finished loading, when you start talking …". §8.8's fresh test pool,
// phase-averaged hits within 10 s of the pitch-only shift with the panel
// switched on at ~30 / 60 / 120 s: male base 0.945 / 0.937 / 0.921 ("about 9
// in 10"), female base 0.750 / 0.742 / 0.746 ("about 3 in 4"); the same test
// with the panel on from the start 0.929 / 0.746 ("about as many as in the
// same test with the panel on from the start" — the misses line above gives
// §8.6's other test, about 85 in 100); 69 readers in its failure sets (32
// men, 37 women; "about 70 other people" — none of them in §8.6's test
// split, which the misses line's "about 70 people" describes). "About 20
// seconds of readings" = the Q5 window (20 s of audio from the first shown
// estimate after the start window and the switch-on, then until at least 5
// quiet ones are in); "half a minute to a minute" = when the start window
// closes (§8.6 addendum: median 30-36 s, 95th percentile 42-50 s). The last
// sentence is the limit that remains: a panel whose first update came before
// the cue filled (about 5 s of voiced speech, whenever that comes; about 10 s
// into a session on the recorded streams: "on before you start talking") but
// that showed no estimate in the start window — its model still downloading,
// or the user on another of the app's tabs (Pitch, History, Voice Shaper,
// Resonance lab: off the practice view the panel makes no updates; a
// different browser tab did not stop it in §8.9's round-3 test). The text names only the download
// (user decisions 2026-10-18, §8.9: assume the user uses Syrinx in one tab;
// "on before you start talking … of talking", round 3's suggested wording).
// (Until the decisions of 2026-10-13: "… within 10 seconds — about as many
// as with the panel on from the start. If the panel is already on when you
// start talking but shows no reading … (for example while it is still
// downloading), the note may not appear …". Until 2026-10-18: "… If the
// panel is on from your first few seconds of listening but shows no reading
// during roughly your first half-minute to a minute (for example while it is
// still downloading, or while you are on another tab), the note may not
// appear …".)
export const PITCH_ONLY_LATE_TEXT =
  "You can turn this panel on at any time. If you turn it on after you've started talking, the note about pitch-only changes still compares with how you sounded at the start, but it needs about 20 seconds of readings before it can appear. In a test on about 70 other people with the panel turned on half a minute to two minutes in, it then caught about 9 in 10 pitch-only changes in men's voices and about 3 in 4 in women's voices within 10 seconds — about as many as in the same test with the panel on from the start. If the panel is on before you start talking but shows no reading during roughly your first half-minute to a minute of talking (for example while it is still downloading), the note may not appear until you stop and start listening again.";

// The pitch-only warning's false alarms (natural reading, the share of the
// updates where the panel showed an estimate — eligible updates, the base of
// every figure in the line; §8.6, §8.9 and its "Decisions 2026-10-13"). 192
// people = §8.6's test split (96 readers, panel on from the start) + §8.8's
// test pool (96 other readers). Men: 0.26 % (§8.6, update-weighted; 0.27 %
// reader-balanced), 0.36 % (§8.8, panel on from the start), 0.34-0.39 %
// (§8.8, KS-Q5 switched on at ~30 / 60 / 120 s) — "about 3 to 4 in 1,000";
// women 0.00 %, 0.01 %, 0.00-0.02 % — "almost never". "Some expressive
// speakers": at least two men among the 192 are far above that — §8.8's
// ls3792 at 11.84 % with the panel on from the start and up to 16.76 % with
// KS-Q5 switched on at ~120 s ("up to about 1 in 6"; the check KS-Q5
// failed), and §8.6's ls3783 at 6.6 %. "For one man whose pitch rose a long
// way in a few places" is ls3792: 6.3-9.5 st above his reference in three
// stretches.
// (Until the decisions of 2026-10-13: "A single expressive speaker can see it
// much more often: one man … saw it on about 1 in 8 to 1 in 6 updates …";
// before that, "In tests on 96 people … about 3 in 1,000 … up to about 1 in
// 15", §8.6's test split.)
export const PITCH_ONLY_FALSE_ALARM_TEXT =
  "The note about pitch-only changes can also appear when you haven't deliberately changed your voice, if your pitch varies a lot as you talk. In tests on 192 people reading aloud that happened on about 3 to 4 in 1,000 updates for men's voices and almost never for women's, also when the panel was turned on later. Some expressive speakers see it much more often — up to about 1 in 6 updates where the panel showed an estimate, for one man whose pitch rose a long way in a few places.";

// Replaces "In background noise, low voices are recognised as speech less
// often …" (that described the old pitch-voicing gate). With the speech
// detector, the panel's own rule — >= 3 s of voiced pitch in 8 s until
// 2026-10-21, 2 s since (measurements/heard-as-low-pitch-and-pauses-2026-10-21.md;
// the noise numbers below were measured with 3 s, not re-run) — is what
// keeps it hidden: on 38 LibriSpeech talkers in noise / channel conditions
// (measurements/heard-as-voiced-windows-2026-10-08.md) men's readings were
// shown less often than women's (10 dB pink / real noise 46 vs 58-59 %,
// phone / laptop mic 48-51 vs 60-61 %, quiet 56 vs 63 %); reverb did not
// hide it longer.
export const NOISE_TEXT =
  "It needs a few seconds of your voiced (pitched) speech. In background noise or through a phone or laptop microphone it may stay hidden longer — more often for low voices, whose pitch is harder to pick out.";

// What it does not cover, and where it hides. Until the 2026-10-21 review:
// "… Held notes and very high or low voices hide it; …". With the 2 s rule
// (measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §8.5) voices
// below the 81 Hz tested floor get readings: the pitch worker drops most
// frames below 75 Hz, so the pooled pitch (median of the posted frames) reads
// ~1.14x too high and the range rule does not fire; at the voice's own pitch
// the reading would sit ~0.47 logit further toward "man" (men's readings stay
// "would say man"; a woman's voice lowered to 75 Hz changes "Could go either
// way" ("Can't tell yet" when measured) / side in about a third of its readings).
export const RANGE_LIMITS_TEXT =
  "Singing, children's voices, held vowels and single words are not supported. Held notes and very high voices hide it. Very low voices (below about 80 Hz) can get a reading, but it is less reliable: their pitch is hard to pick out, and the reading leans toward “would say woman”. Singing and children are not detected — don't use it for them.";

// "Can't tell yet" (since 2026-10-21 "Could go either way": a shown reading
// that spans most of the scale) per sex (measurements/heard-as-voiced-windows-2026-10-08.md):
// on 80 LibriSpeech readers ~13 % of women's and ~7 % of men's shown
// readings, mostly from a few voices that get it nearly always.
export const CANT_TELL_TEXT =
  "Some voices get \u201cCould go either way\u201d most of the time. In tests on 80 audiobook readers that happened more often for women's voices (about 13 in 100 readings) than for men's (about 7 in 100), mostly for a few voices.";

// Loading: p = the classifier's download share (null before any progress
// arrives); at 100 % it is still loading its engine (the ONNX Runtime files
// report no progress) — 2026-10-19 review N-3.
const loadingText = (p) => (p == null ? "Loading voice model…"
  : p >= 100 ? "Starting voice model — the first time this also downloads its engine…"
    : `Loading voice model… ${p} %`);
const REASONS = {
  loading: loadingText,
  error: () => "Unavailable — the voice model couldn't run. Switch it off and on to try again, or reload the page",
  listening: () => "Waiting for running speech",
  sustained: () => "Needs running speech — held vowels and notes don't count",
  short: () => "Can't tell yet — keep talking, it needs a few seconds of running speech",
  unvoiced: () => "Needs voiced (pitched) speech — whispering gets no reading, and loud noise can hide your pitch",
  stale: () => "Waiting for running speech",
  outside: () => "Outside the range it was tested on — no guess shown",
};

// (Until the dome, 2026-10-25, it ended "· striped = could go either way";
// the key row under the dome now says that with its striped key.)
const legendText = (stale) => `${stale ? "Older reading — waiting for more speech · " : ""}From your last ~8 s of speech · updates every 2 s`;

// Every text each line can show, from the same word functions the panel uses
// (heardAsAxis on a grid of ranges; every reason), laid out invisibly so the
// panel's height never depends on which one is showing. All of them, not just
// the longest: italic and medium text differ in width, so the longest string
// is not always the tallest. (The sentence needs no reserve since the dome,
// 2026-10-25: it sits inside the dome, whose box is fixed.)
const RESERVE = (() => {
  const unsure = new Set();
  const v = [0.001, 0.049, 0.051, 0.949, 0.951, 0.999];
  for (let k = 0; k <= 40; k++) v.push(k / 40);
  for (const lo of v) for (const hi of v) {
    if (hi < lo) continue;
    for (const u of [0, 1]) {
      const a = heardAsAxis({ s: (lo + hi) / 2, sLow: lo, sHigh: hi, centre: { unsure: u } });
      if (a.unsureText) unsure.add(a.unsureText);
    }
  }
  for (let n = 1; n <= 9; n++) unsure.add(`About ${n} in 10 might be unsure or say neither`);
  return {
    unsure: [...unsure].map((t) => ({ t })),
    legend: legendText(true),
    note: PITCH_ONLY_TEXT,
    reasons: [...new Set(Object.entries(REASONS).flatMap(([k, f]) => (k === "loading" ? [f(null), f(99), f(100)] : [f()])))].map((t) => ({ t })),
  };
})();

// Several texts in one grid cell (invisible inside a reserve layer): as tall
// as the tallest of them. `render` draws one text the way the panel does.
const Reserve = ({ texts, className = "", render = (x) => x.t }) => (
  <div className={`grid grid-cols-1 ${className}`}>
    {texts.map((x) => <div key={x.t} className="col-start-1 row-start-1">{render(x)}</div>)}
  </div>
);
// Under the dome everything is centred, like the dome (the caveat and More
// list stay left-aligned: running text). Balanced wrapping (text-wrap: balance
// never changes the number of lines, so the reserve copies keep their height).
//
// ROW LAYOUT (heardrow: desktop windows under 800 px tall and short
// landscape, src/index.css; 2026-10-26 review: on 1366 x 768 / 1280 x 800
// laptops the centred dome pushed the panel's lower half into an inner
// scroll of the right-hand column, and in short landscape the panel was
// taller than the screen): the dome at the left (200 px wide; 220 px on
// desktop, where its key column beside it is taller anyway), its key (one
// item per line in a narrow column), unsure line and legend beside it, the
// pitch-only note and the caveat full width under them. A grid whose first
// three rows the dome spans (the axis element a subgrid, so the dome and its
// key stay one element and the note still follows it directly in the DOM);
// every layer of the one-height grid uses the same grid, so the reserve still
// holds.
const ROW_GRID = "heardrow:grid heardrow:grid-cols-[200px_minmax(0,1fr)] deskshort:grid-cols-[220px_minmax(0,1fr)] heardrow:grid-rows-[auto_auto_1fr_auto_auto] heardrow:gap-x-3 heardrow:items-start";
const ROW_AXIS = "heardrow:col-[1/-1] heardrow:row-[1/4] heardrow:grid heardrow:grid-cols-subgrid heardrow:grid-rows-subgrid";
const UNSURE_CLS = "mt-1 text-xs leading-snug tabular-nums text-center text-balance heardrow:col-start-2 heardrow:row-start-2 heardrow:text-left";
const LEGEND_CLS = "mt-0.5 text-[11px] leading-snug text-center text-balance heardrow:col-start-2 heardrow:row-start-3 heardrow:text-left";
const NOTE_CLS = "mt-1.5 text-[11px] leading-snug text-center text-balance heardrow:col-[1/-1] heardrow:row-start-4 heardrow:text-left";
const REASON_CLS = "mt-1.5 text-sm leading-snug text-center text-balance heardrow:col-start-2 heardrow:row-start-2 heardrow:text-left heardrow:mt-1";

export function HeardAsSwitch({ on, onChange, label = "Likely heard as · Experimental" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`hc-switch relative w-10 h-5 shrink-0 rounded-full transition-colors cursor-pointer before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] ${on ? "bg-purple-600" : "bg-neutral-700"}`}
    >
      <span className={`hc-switch-thumb absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

// The dome's box: at most 300 px wide (the mockup's size on a 448-px phone),
// the full width of narrower panels, centred; its height follows the viewBox.
// Row layout: at the left (200 / 220 px, the grid's first column), over the
// grid's first three rows.
const DOME_BOX = "block w-full max-w-[300px] mx-auto aspect-[300/157] h-auto heardrow:col-start-1 heardrow:row-[1/4] heardrow:mx-0";
const VIEWBOX = `0 0 ${DOME.w} ${DOME.h}`;

// The tick above the top of the dome: the middle, 5 in 10.
const DomeTick = ({ grey = false }) => (
  <line x1={DOME.cx} y1={DOME.tickTop} x2={DOME.cx} y2={DOME.tickBottom} strokeWidth={1.25}
    className={grey ? "heard-dome-tick-grey stroke-neutral-700" : "heard-dome-tick stroke-neutral-500"} />
);

// The key row under the dome: a small key in each shade beside its words —
// deep by "would say man" (left), striped by "could go either way" (middle),
// light by "would say woman" (right); greyed outlines under the empty dome.
// One row while there is room for it (>= 330 px), else the end words on the
// first row and "could go either way" centred under them (a container query
// on the row's own width: the panel's width never changes while speaking, so
// neither does the row's height). In the row layout's narrow column (under
// 230 px) one item per line, each key at the left. Windows high contrast:
// keys solid / striped / hollow like the dome (src/index.css).
const KEY_CLS = "heard-key inline-block w-2.5 h-2.5 rounded-sm shrink-0";
const KEY_ITEM = "inline-flex items-center gap-1 whitespace-nowrap";
function DomeKey({ grey = false }) {
  const key = (kind) => (grey
    ? <span className={`${KEY_CLS} heard-key-empty border border-neutral-700`} />
    : <span className={`${KEY_CLS} heard-${kind}`} data-axis-key={kind} />);
  return (
    <div className="@container mx-auto mt-1 max-w-[360px] heardrow:col-start-2 heardrow:row-start-1 heardrow:mx-0 heardrow:mt-0.5" aria-hidden="true">
      <div className="grid grid-cols-[auto_auto_auto] justify-between gap-x-2 gap-y-0.5 text-[11px] leading-4 text-neutral-400 @max-[330px]:grid-cols-[auto_auto] @max-[230px]:grid-cols-1 @max-[230px]:gap-y-1" data-axis-ends="">
        <span className={KEY_ITEM}>{key("man")}{AXIS_ENDS.left}</span>
        <span className={`${KEY_ITEM} @max-[330px]:col-span-2 @max-[330px]:row-start-2 @max-[330px]:justify-self-center @max-[230px]:col-span-1 @max-[230px]:row-start-auto @max-[230px]:justify-self-start`}>{key("either")}{EITHER_WORDS}</span>
        <span className={`${KEY_ITEM} justify-self-end @max-[230px]:justify-self-start @max-[230px]:flex-row-reverse`}>{AXIS_ENDS.right}{key("woman")}</span>
      </div>
    </div>
  );
}

// The man <-> woman dome (owner's choice 2026-10-25; the split bar of user
// decision 2026-10-20 bent into a semicircle): ten tenth-segments — deep
// indigo from the left foot (the low end of "would say man"), light indigo
// from the right foot (the low end of "would say woman"), striped between
// them (could go either way); the key row under it. No best-guess mark (see
// the top of this file). Colours: src/index.css (.heard-*). Purely visual
// (role img labelled with the bar's own description only; the sentence drawn
// inside the dome is plain text placed after the pitch-only note, so it is
// read once). The segments change between tenths with no transition (an SVG
// transition re-runs the main-thread pipeline every frame;
// main-thread-cpu-2026-10-08.md §3 F6). data-split-part groups the tenths of
// each kind (empty kinds left out), each tenth data-tenth / data-tenth-kind.
function HeardAsAxis({ axis }) {
  const pid = `heard-either-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const kinds = domeKinds(axis);
  const groups = ["man", "either", "woman"].map((k) => [k, kinds.flatMap((x, i) => (x === k ? [i] : []))]).filter(([, ix]) => ix.length > 0);
  return (
    <div className={ROW_AXIS} data-heard-as-axis="" data-axis-wide={axis.wide ? "1" : "0"} data-split-man={axis.man.toFixed(1)}
      data-split-woman={axis.woman.toFixed(1)} data-split-guess={axis.guess.toFixed(3)}>
      <svg className={`heard-dome ${DOME_BOX}`} viewBox={VIEWBOX} role="img" aria-label={axis.srText} data-split-bar="">
        <defs>
          <pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="heard-pat-woman" />
            <rect width="3" height="6" className="heard-pat-man" />
          </pattern>
        </defs>
        <DomeTick />
        {groups.map(([k, ix]) => (
          <g key={k} className={`heard-seg-${k}`} fill={k === "either" ? `url(#${pid})` : undefined} data-split-part={k}>
            {ix.map((i) => <path key={i} d={DOME_PATHS[i]} data-tenth={i} data-tenth-kind={k} />)}
          </g>
        ))}
      </svg>
      <DomeKey />
    </div>
  );
}

// The dome with no estimate on it (ten empty, greyed segments, a grey tick
// and greyed keys): kept on screen while the panel says why it shows none,
// so the panel keeps its height. Same boxes as HeardAsAxis; hidden from
// screen readers (the reason text says it all).
function EmptyAxis() {
  return (
    <div aria-hidden="true" className={ROW_AXIS} data-heard-as-axis-empty="">
      <svg className={`heard-dome ${DOME_BOX}`} viewBox={VIEWBOX}>
        <DomeTick grey />
        {DOME_PATHS.map((d, i) => (
          <path key={i} d={d} strokeWidth={1} className="heard-seg-empty fill-neutral-800/30 stroke-neutral-700" />
        ))}
      </svg>
      <DomeKey grey />
    </div>
  );
}

// The sentence inside the dome: an overlay exactly over the dome's box (same
// width rule and aspect ratio, at the top of the shown block), its two lines
// (domeLines) at the bottom of the dome's hollow, centred. Font and spacing
// follow the dome's width (cqw of the overlay, a size container), 16 px at the
// full 300 px. Placed after the pitch-only note in the DOM (see the top of
// this file); pointer-events none so it never covers anything.
const DOME_TEXT_BOX = "@container pointer-events-none absolute inset-x-0 top-0 mx-auto w-full max-w-[300px] aspect-[300/157] flex flex-col items-center justify-end heardrow:right-auto heardrow:mx-0 heardrow:w-[200px] deskshort:w-[220px]";
const DOME_TEXT_STYLE = { fontSize: "min(16px, 5.4cqw)", marginBottom: "4.6cqw", lineHeight: 1.35 };

export function HeardAsPanel({
  enabled,
  modelStatus,
  modelProgress,
  heardAsRef,
  audioClockRef,
  genderStateRef,
  resonanceRef,
  pitchOnlyRef = null,
  extraNote = null,
}) {
  const [view, setView] = useState({ hidden: "listening" });
  const [more, setMore] = useState(false);
  const statusRef = useRef(modelStatus);
  useEffect(() => { statusRef.current = modelStatus; });
  const shownRef = useRef(false);
  const computeRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const show = (v) => { shownRef.current = !v.hidden; setView(v); };
    // Every update — hidden ones too — goes to the pitch-only warning: a
    // hidden-panel update (lnF0 null) shows nothing but keeps its run through
    // a brief hide (src/ml/pitch-only-warning.js). (The hook's warning object
    // lives for the whole page; captured for the cleanup.)
    // Each update also carries the share the panel draws (the warning's
    // "the estimate moved too" gate; null when hidden) and the audio clock.
    const warning = pitchOnlyRef?.current ?? null;
    const warn = (lnF0, share = null) => warning?.update({
      lnF0, resonance: resonanceRef?.current ?? null, share, audioMs: audioClockRef?.current ?? null,
    }) === true;
    const hide = (why) => { warn(null); show({ hidden: why, live: warning?.held() === true }); };
    const compute = () => {
      const st = statusRef.current;
      if (st === "error") { hide("error"); return; }
      if (st !== "ready") { hide("loading"); return; }
      const now = audioClockRef?.current;
      const voiceState = genderStateRef?.current?.state ?? null;
      const e = now == null ? { hidden: "listening" } : heardAsRef.current.estimate(now, voiceState);
      if (e.hidden) { hide(shortReason(e, HEARD_AS_CALIBRATION.minWindows)); return; }
      const shares = heardAsShares(e.meterLogit, e.lnF0);
      const pitchOnly = warn(e.lnF0, shares.s);
      show({
        axis: heardAsAxis(shares),
        ageMs: e.ageMs,
        pitchOnly,
        live: pitchOnly,
      });
    };
    // The first reading (and the first after a hide), as soon as it is ready:
    // shows a reading when estimate() has one, otherwise leaves the hidden
    // view as it is. Never feeds the pitch-only warning; the note shows while
    // the warning's run is held through a brief hide — the same value the
    // live region announces, so the visible note and what screen readers
    // are told agree (2026-10-21 review, §9 of
    // measurements/heard-as-low-pitch-and-pauses-2026-10-21.md; it had shown
    // the reading without the note for up to 2 s while the live region kept
    // the warning).
    const first = () => {
      if (statusRef.current !== "ready") return;
      const now = audioClockRef?.current;
      if (now == null) return;
      const e = heardAsRef.current.estimate(now, genderStateRef?.current?.state ?? null);
      if (e.hidden) return;
      const held = warning?.held() === true;
      show({ axis: heardAsAxis(heardAsShares(e.meterLogit, e.lnF0)), ageMs: e.ageMs, pitchOnly: held, live: held });
    };
    computeRef.current = compute;
    compute();
    const id = setInterval(compute, HEARD_AS_CALIBRATION.updateMs);
    // Every 250 ms: hide promptly (not on the 2 s cadence) when a held note
    // starts, so the panel never shows ranges while the strip already says
    // "sustained"; with no reading shown, look for the first one.
    const fast = setInterval(() => {
      const q = quickCheck(shownRef.current, genderStateRef?.current?.state ?? null);
      if (q === "update") compute();
      else if (q === "first") first();
    }, HIDE_CHECK_MS);
    return () => {
      clearInterval(id); clearInterval(fast);
      computeRef.current = null;
      // Switched off (or remounted): a later switch-on starts a fresh run.
      warning?.resetRun();
    };
  }, [enabled, heardAsRef, audioClockRef, genderStateRef, resonanceRef, pitchOnlyRef]);

  // A model status change (ready, error) shows at once, not on the next 2 s
  // tick: the last tick's "loading" view used to stay up to 2 s after ready
  // (2026-10-19 review N-2). Runs after the effect above has set statusRef.
  useEffect(() => { computeRef.current?.(); }, [modelStatus]);

  // Loading progress is shown as it arrives (not on the 2 s cadence).
  const progress = modelProgress?.total
    ? Math.min(100, Math.floor((100 * modelProgress.loaded) / modelProgress.total))
    : null;
  const reason = modelStatus === "error" ? "error"
      : modelStatus !== "ready" ? "loading"
        : view.hidden ?? null;
  const stale = !reason && view.ageMs > STALE_MS;
  // The live region keeps the warning through a brief hide (the module holds
  // its run), so screen readers are not re-told after every "Keep talking".
  const liveOn = view.live === true;

  // Switched off in Settings: nothing on the dashboard (no off row and no
  // turn-on button since 2026-10-25; Settings turns it back on).
  if (!enabled) return null;

  return (
    <section
      className="w-full rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2"
      data-heard-as={reason ? "hidden" : "shown"}
      data-reason={reason ?? ""}
      data-model-worker={modelStatus === "idle" ? "starting" : modelStatus}
      aria-label="Likely heard as (experimental)"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-[11px] font-medium text-neutral-300">
          Likely heard as <span className="text-amber-300/80">· Experimental</span>
        </h3>
      </div>
      {/* One grid cell: the tallest shown state and the tallest hidden state
          (both invisible), and on top of them what is showing now. */}
      <div className="grid grid-cols-1" data-heard-as-body="">
        <div aria-hidden="true" className={`invisible col-start-1 row-start-1 ${ROW_GRID}`}>
          <EmptyAxis />
          <div className={NOTE_CLS}>{RESERVE.note}</div>
          <Reserve className={UNSURE_CLS} texts={RESERVE.unsure} />
          <div className={LEGEND_CLS}>{RESERVE.legend}</div>
        </div>
        <div aria-hidden="true" className={`invisible col-start-1 row-start-1 ${ROW_GRID}`}>
          <EmptyAxis />
          <Reserve className={REASON_CLS} texts={RESERVE.reasons} />
        </div>
        <div className="col-start-1 row-start-1 self-start min-w-0">
          {reason ? (
            <div className={ROW_GRID}>
              <EmptyAxis />
              <p className={`${REASON_CLS} text-neutral-400`} data-heard-as-reason="">{REASONS[reason](progress)}</p>
            </div>
          ) : (
            <div className={`relative ${ROW_GRID}`} data-heard-as-shares="" data-stale={stale ? "1" : "0"}>
              <HeardAsAxis axis={view.axis} />
              {view.pitchOnly && (
                <p className={`${NOTE_CLS} text-amber-200/80`} data-heard-as-note="pitch-only" data-pitch-only="1">
                  {PITCH_ONLY_TEXT}
                </p>
              )}
              <div className={DOME_TEXT_BOX}>
                <p className={`text-center tabular-nums ${view.axis.split ? "text-neutral-300 italic" : "text-neutral-100 font-semibold"}`} style={DOME_TEXT_STYLE}
                  data-heard-as-range="" data-wide={view.axis.wide ? "1" : "0"} data-split={view.axis.split ? "1" : "0"}>
                  {domeLines(view.axis.rangeText).map((line, k) => <span key={k} className="block whitespace-nowrap">{k ? " " : ""}{line}</span>)}
                </p>
              </div>
              {view.axis.unsureText && (
                <p className={`${UNSURE_CLS} text-neutral-400`} data-heard-as-unsure="">{view.axis.unsureText}</p>
              )}
              {!view.pitchOnly && extraNote != null && extraNote !== false && (
                <div className="mt-1 text-[11px] leading-snug text-amber-200/80 heardrow:col-[1/-1] heardrow:row-start-5" data-heard-as-note="extra">{extraNote}</div>
              )}
              <p className={`${LEGEND_CLS} text-neutral-400`} data-heard-as-legend="">
                {legendText(stale)}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-heard-as-live="">
        {liveOn ? PITCH_ONLY_TEXT : ""}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-neutral-400" data-heard-as-caveat="">
        {HEARD_AS_CAVEAT_SHORT}{" "}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className="relative text-neutral-300 underline underline-offset-2 hover:text-neutral-100 cursor-pointer before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']">
          {more ? "Less" : "More"}
        </button>
      </p>
      {more && (
        <ul className="mt-1 text-[11px] leading-snug text-neutral-400 list-disc pl-4 space-y-0.5" data-heard-as-more="">
          <li data-heard-as-caveat-more="">{HEARD_AS_CAVEAT_MORE}</li>
          <li data-heard-as-one-talker="">{ONE_TALKER_TEXT}</li>
          <li data-heard-as-whisper="">{WHISPER_TEXT}</li>
          <li data-heard-as-pitch-only-misses="">{PITCH_ONLY_MISSES_TEXT}</li>
          <li data-heard-as-pitch-only-late="">{PITCH_ONLY_LATE_TEXT}</li>
          <li data-heard-as-pitch-only-false-alarms="">{PITCH_ONLY_FALSE_ALARM_TEXT}</li>
          <li>Typical voices are shown further from the ends than listeners put them: clearly feminine and clearly masculine voices look less clear-cut here than they are.</li>
          <li data-heard-as-cant-tell="">{CANT_TELL_TEXT}</li>
          <li>Within clearly feminine or clearly masculine voices it does not track small changes — use the pitch and resonance meters for those.</li>
          <li>It uses only your pitch and a voice classifier; it ignores intonation, vocal weight and articulation.</li>
          <li data-heard-as-range-limits="">{RANGE_LIMITS_TEXT}</li>
          <li>The striped part of the arc is the range where about 8 in 10 published listener groups fell for clearly feminine or clearly masculine voices; less is known for in-between voices. The sentence inside the arc gives the panel&apos;s best guess for the side more listeners would choose, rounded to a whole tenth (halfway values toward 5 in 10); the best guess always lies inside the striped part. The scale is listeners choosing between man and woman: those who might be unsure or say neither are counted half on each side. The &ldquo;unsure or neither&rdquo; line counts listeners who answered &ldquo;another gender&rdquo; as well as those who weren&apos;t sure, and depends on how listeners are asked.</li>
          <li data-heard-as-noise="">{NOISE_TEXT}</li>
          <li>Nothing is stored or sent anywhere; it is computed on this device and forgotten when you stop.</li>
        </ul>
      )}
    </section>
  );
}
