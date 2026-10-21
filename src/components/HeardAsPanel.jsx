// HeardAsPanel.jsx — "Likely heard as · Experimental" (opt-in, OFF by
// default; the user chose to ship it as a clearly labelled experiment with
// its known weaknesses disclosed). Shows how listeners in published studies
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
// the both-sides sentence ("About A–B in 10 would say man · about C–D in 10
// would say woman") and the unsure / neither share as one text line — never a
// single verdict, no percent signs, the same words and colours in every
// direction. Two shades of ONE colour: never the app's green / red (on / off
// target) or amber (experimental / warning), never pink / blue; the shades
// are theme tokens in src/index.css (--color-heard-man / --color-heard-woman,
// >= 3:1 against the panel and each other; Windows high-contrast mode:
// solid / striped / hollow in system colours). When the range spans 8
// tenths or more it is mostly stripes, the unsure line is dropped and it says
// "Can't tell yet". An estimate older than 2 s says
// "Older reading" in its legend line (nothing is dimmed: dimming took text
// below WCAG contrast). The first caveat sentence stays on screen; the rest
// of it and the long explanation are behind "More". Layout numbers and words:
// heardAsAxisModel.js (unit-tested; the words are the 2026-10-07 axis's,
// unchanged). Updates every 2 s from the last ~8 s of running speech
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
// talking", "Can't tell yet" and a range with its "unsure" line moved More,
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
// setHeardAsEnabled); off, nothing runs and nothing downloads. Turning it on
// downloads up to HEARD_AS_DOWNLOAD_MB (src/ml/heard-as-download.js) the
// first time. Hidden reasons come from heard-as.js estimate(); "short" is
// split into "short" / "unvoiced" (whisper) by heardAsAxisModel.js
// shortReason. Since 2026-10-08 only voiced windows count toward the reading
// (heard-as.js logitMinVoicedMs; measurements/heard-as-voiced-windows-2026-10-08.md).

import { useEffect, useRef, useState } from "react";
import { heardAsShares } from "../ml/heard-as";
import { heardAsAxis, AXIS_ENDS, shortReason, quickCheck } from "./heardAsAxisModel";
import { HEARD_AS_CALIBRATION } from "../ml/heardAsCalibration";
import { PITCH_ONLY_TEXT } from "../ml/pitch-only-warning";
import { HEARD_AS_DOWNLOAD_MB } from "../ml/heard-as-download";

const STALE_MS = 2000;
const HIDE_CHECK_MS = 250;
// What turning it on downloads the first time: the voice model, the speech
// detector and the ONNX Runtime engine (src/ml/heard-as-download.js; an
// upper bound — GitHub Pages compresses the engine).
export const MODEL_DOWNLOAD_MB = HEARD_AS_DOWNLOAD_MB;

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
// or the user on another of the app's tabs (Pitch, History, Resonance lab:
// off the practice view the panel makes no updates; a different browser tab
// did not stop it in §8.9's round-3 test). The text names only the download
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
// "would say man"; a woman's voice lowered to 75 Hz changes "Can't tell yet" /
// side in about a third of its readings).
export const RANGE_LIMITS_TEXT =
  "Singing, children's voices, held vowels and single words are not supported. Held notes and very high voices hide it. Very low voices (below about 80 Hz) can get a reading, but it is less reliable: their pitch is hard to pick out, and the reading leans toward “would say woman”. Singing and children are not detected — don't use it for them.";

// "Can't tell yet" per sex (measurements/heard-as-voiced-windows-2026-10-08.md):
// on 80 LibriSpeech readers ~13 % of women's and ~7 % of men's shown
// readings, mostly from a few voices that get it nearly always.
export const CANT_TELL_TEXT =
  "Some voices get \u201cCan't tell yet\u201d most of the time. In tests on 80 audiobook readers that happened more often for women's voices (about 13 in 100 readings) than for men's (about 7 in 100), mostly for a few voices.";

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
  short: () => "Keep talking — needs a few seconds of running speech",
  unvoiced: () => "Needs voiced (pitched) speech — whispering gets no reading, and loud noise can hide your pitch",
  stale: () => "Waiting for running speech",
  outside: () => "Outside the range it was tested on — no guess shown",
};

const legendText = (stale) => `${stale ? "Older reading — waiting for more speech · " : ""}From your last ~8 s of speech · updates every 2 s · striped = could go either way`;

// Every text each line can show, from the same word functions the panel uses
// (heardAsAxis on a grid of ranges; every reason), laid out invisibly so the
// panel's height never depends on which one is showing. All of them, not just
// the longest: the summary sentence breaks between its two halves, so the
// longest string is not always the tallest.
const RESERVE = (() => {
  const ranges = new Map(), unsure = new Set();
  const v = [0.001, 0.049, 0.051, 0.949, 0.951, 0.999];
  for (let k = 0; k <= 40; k++) v.push(k / 40);
  for (const lo of v) for (const hi of v) {
    if (hi < lo) continue;
    for (const u of [0, 1]) {
      const a = heardAsAxis({ s: (lo + hi) / 2, sLow: lo, sHigh: hi, centre: { unsure: u } });
      ranges.set(a.rangeText, a.wide);
      if (a.unsureText) unsure.add(a.unsureText);
    }
  }
  for (let n = 1; n <= 9; n++) unsure.add(`About ${n} in 10 might be unsure or say neither`);
  return {
    range: [...ranges].map(([t, wide]) => ({ t, wide })),
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
// The summary sentence, in larger text: its two halves ("… would say man ·" /
// "about … would say woman") each kept on one line, so a narrow panel breaks
// it between them.
function Summary({ text }) {
  const i = text.indexOf(" · ");
  if (i < 0) return text;
  return (
    <>
      <span className="inline-block">{text.slice(0, i)} ·</span>{" "}
      <span className="inline-block">{text.slice(i + 3)}</span>
    </>
  );
}
const SUMMARY_CLS = "mt-1.5 text-sm leading-snug tabular-nums";
const UNSURE_CLS = "mt-0.5 text-[11px] leading-snug tabular-nums";
const LEGEND_CLS = "mt-0.5 text-[11px] leading-snug";
const NOTE_CLS = "mt-1.5 text-[11px] leading-snug";
const REASON_CLS = "mt-1.5 text-sm leading-snug";

export function HeardAsSwitch({ on, onChange, label = "Likely heard as · Experimental", ref = null }) {
  return (
    <button
      ref={ref}
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

// The split bar's parts from the left, [kind, from, to] as fractions, empty
// ones left out: "man" (deep, the low end of would say man), "either"
// (striped), "woman" (light, the low end of would say woman). Each part stops
// 1 px short of a boundary with the next, so 2 px of the panel show between
// two parts.
function barParts(axis) {
  const m = axis.man, w = 1 - axis.woman;
  return [["man", 0, m], ["either", m, w], ["woman", w, 1]].filter(([, a, b]) => b - a > 1e-9);
}
const inset = (f) => (f <= 1e-9 ? "0px" : `calc(${(f * 100).toFixed(1)}% + 1px)`);

// Ticks in tenths under the bar (the middle one taller) and the end words,
// each with a small key in its shade (deep beside "would say man", light
// beside "would say woman"; greyed outlines on the empty bar). Windows high
// contrast: ticks in CanvasText / GrayText, keys solid / hollow like the bar
// (src/index.css).
const KEY_CLS = "heard-key inline-block w-2.5 h-2.5 rounded-sm shrink-0";
function BarScale({ grey = false }) {
  const key = (kind) => (grey
    ? <span className={`${KEY_CLS} heard-key-empty border border-neutral-700`} />
    : <span className={`${KEY_CLS} heard-${kind}`} data-axis-key={kind} />);
  return (
    <>
      <div className="relative h-1.5" aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className={`${grey ? "heard-tick-grey bg-neutral-700" : "heard-tick bg-neutral-500"} absolute top-0 w-px ${i === 5 ? "h-1.5" : "h-1"} ${i === 10 ? "-ml-px" : ""}`}
            style={{ left: `${i * 10}%` }} />
        ))}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-neutral-400 leading-4" aria-hidden="true" data-axis-ends="">
        <span className="whitespace-nowrap inline-flex items-center gap-1">{key("man")}{AXIS_ENDS.left}</span>
        <span className="whitespace-nowrap inline-flex items-center gap-1">{AXIS_ENDS.right}{key("woman")}</span>
      </div>
    </>
  );
}

// The man <-> woman split bar (user decision 2026-10-20): a thick bar of ten
// tenths of listeners — deep indigo from the left (the low end of "would say
// man"), light indigo from the right (the low end of "would say woman"),
// striped between them (could go either way); ticks in tenths and the end
// words with their colour keys under it. No best-guess mark (see the top of
// this file). Colours: src/index.css (.heard-*). Purely visual
// (role img with the full sentence as its label); the visible text lines
// follow it. The parts jump between tenths, no transition: a left / width
// transition re-ran style + layout every frame on the main thread (−8.9 ms/s
// pooled with the panel on; main-thread-cpu-2026-10-08.md §3 F6).
function HeardAsAxis({ axis }) {
  return (
    <div data-heard-as-axis="" data-axis-wide={axis.wide ? "1" : "0"} data-split-man={axis.man.toFixed(1)}
      data-split-woman={axis.woman.toFixed(1)} data-split-guess={axis.guess.toFixed(3)}>
      <div className="heard-bar-wrap relative pt-1.5" role="img" aria-label={axis.srText}>
        <div className="relative h-[18px] rounded overflow-hidden" data-split-bar="">
          {barParts(axis).map(([kind, a, b]) => (
            <span key={kind} className={`heard-${kind} absolute inset-y-0`} style={{ left: inset(a), right: inset(1 - b) }} data-split-part={kind} />
          ))}
        </div>
      </div>
      <BarScale />
    </div>
  );
}

// The bar with no estimate on it (an empty, greyed outline, greyed ticks and
// the end words): kept on screen while the panel says why it shows none, so
// the panel keeps its height. Same boxes as HeardAsAxis; hidden from screen
// readers (the reason text says it all).
function EmptyAxis() {
  return (
    <div aria-hidden="true" data-heard-as-axis-empty="">
      <div className="heard-bar-wrap relative pt-1.5">
        <div className="heard-empty relative h-[18px] rounded border border-neutral-700 bg-neutral-800/30" />
      </div>
      <BarScale grey />
    </div>
  );
}

export function HeardAsPanel({
  enabled,
  onToggle,
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
  // Turning the panel on or off here swaps the off row for the panel, so the
  // pressed control unmounts: focus moves to the control that replaces it
  // instead of dropping to <body> (2026-10-19 review S-4d). Only for a press
  // in the panel (the state it asked for), not for the Settings switch.
  const turnOnRef = useRef(null);
  const switchRef = useRef(null);
  const refocusFor = useRef(null);
  const toggleHere = (on) => { refocusFor.current = on; onToggle(on); };
  useEffect(() => {
    if (refocusFor.current === enabled) (enabled ? switchRef : turnOnRef).current?.focus();
    refocusFor.current = null;
  }, [enabled]);

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
  const reason = !enabled ? null
    : modelStatus === "error" ? "error"
      : modelStatus !== "ready" ? "loading"
        : view.hidden ?? null;
  const stale = !reason && view.ageMs > STALE_MS;
  // The live region keeps the warning through a brief hide (the module holds
  // its run), so screen readers are not re-told after every "Keep talking".
  const liveOn = view.live === true;

  if (!enabled) {
    return (
      <div className="w-full flex items-center justify-between gap-2 min-h-8 px-3 py-1 rounded-xl border border-neutral-800 bg-neutral-900/40"
        data-heard-as="off" data-model-worker="off">
        {/* Wraps rather than truncating: at 360 px the ellipsis ate "off" (review N-5). */}
        <span className="min-w-0 text-[11px] leading-4 text-neutral-400">Likely heard as · <span className="whitespace-nowrap">Experimental — off</span></span>
        {/* The accessible name starts with the visible text (WCAG 2.5.3, review N-9). */}
        <button ref={turnOnRef} type="button" onClick={() => toggleHere(true)}
          aria-label={`Turn on · up to ${MODEL_DOWNLOAD_MB} MB — the experimental "Likely heard as" estimate; the first time it downloads a voice model, a speech detector and their engine`}
          className="shrink-0 text-[11px] min-h-6 px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer transition-colors">
          Turn on · up to {MODEL_DOWNLOAD_MB} MB
        </button>
      </div>
    );
  }

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
        <HeardAsSwitch ref={switchRef} on onChange={toggleHere} />
      </div>
      {/* One grid cell: the tallest shown state and the tallest hidden state
          (both invisible), and on top of them what is showing now. */}
      <div className="grid grid-cols-1" data-heard-as-body="">
        <div aria-hidden="true" className="invisible col-start-1 row-start-1">
          <EmptyAxis />
          <div className={NOTE_CLS}>{RESERVE.note}</div>
          <Reserve className={SUMMARY_CLS} texts={RESERVE.range}
            render={(x) => <span className={x.wide ? "italic" : "font-medium"}><Summary text={x.t} /></span>} />
          <Reserve className={UNSURE_CLS} texts={RESERVE.unsure} />
          <div className={LEGEND_CLS}>{RESERVE.legend}</div>
        </div>
        <div aria-hidden="true" className="invisible col-start-1 row-start-1">
          <EmptyAxis />
          <Reserve className={REASON_CLS} texts={RESERVE.reasons} />
        </div>
        <div className="col-start-1 row-start-1 self-start min-w-0">
          {reason ? (
            <>
              <EmptyAxis />
              <p className={`${REASON_CLS} text-neutral-400`} data-heard-as-reason="">{REASONS[reason](progress)}</p>
            </>
          ) : (
            <div data-heard-as-shares="" data-stale={stale ? "1" : "0"}>
              <HeardAsAxis axis={view.axis} />
              {view.pitchOnly && (
                <p className={`${NOTE_CLS} text-amber-200/80`} data-heard-as-note="pitch-only" data-pitch-only="1">
                  {PITCH_ONLY_TEXT}
                </p>
              )}
              <p className={`${SUMMARY_CLS} ${view.axis.wide ? "text-neutral-300 italic" : "text-neutral-100 font-medium"}`}
                data-heard-as-range="" data-wide={view.axis.wide ? "1" : "0"}>
                <Summary text={view.axis.rangeText} />
              </p>
              {view.axis.unsureText && (
                <p className={`${UNSURE_CLS} text-neutral-400`} data-heard-as-unsure="">{view.axis.unsureText}</p>
              )}
              {!view.pitchOnly && extraNote != null && extraNote !== false && (
                <div className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="extra">{extraNote}</div>
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
          <li>Within clearly feminine or clearly masculine voices it does not track small changes — use the pitch and resonance rows under the pitch trace for those.</li>
          <li>It uses only your pitch and a voice classifier; it ignores intonation, vocal weight and articulation.</li>
          <li data-heard-as-range-limits="">{RANGE_LIMITS_TEXT}</li>
          <li>The striped part of the bar is the range where about 8 in 10 published listener groups fell for clearly feminine or clearly masculine voices; less is known for in-between voices. The scale is listeners choosing between man and woman: those who might be unsure or say neither are counted half on each side. The &ldquo;unsure or neither&rdquo; line counts listeners who answered &ldquo;another gender&rdquo; as well as those who weren&apos;t sure, and depends on how listeners are asked.</li>
          <li data-heard-as-noise="">{NOISE_TEXT}</li>
          <li>Nothing is stored or sent anywhere; it is computed on this device and forgotten when you stop.</li>
        </ul>
      )}
    </section>
  );
}
