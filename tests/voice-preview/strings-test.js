// strings-test.js — the voice preview card's user-facing strings (src/voice-preview/strings.js):
// every string and every value label is free of gender words and score words; the
// strings match the design note's list word for word (the caveat and "may sound
// buzzier" included); value labels, aria-valuetext, the target result line, the download
// name and the minus sign (U+2212); the fix step's additions (the setting line beside Play,
// the announcements with the notices and the setting in words, "may sound buzzier" on a
// lowered target result). The three strings LabView carries itself (the view option, the
// loading fallback and the load-error fallback) equal strings.js.
// measurements/voice-preview-phase1-2026-10-19.md §6, §9, §10, §13, §14 item 7; fix step.
//
//   node tests/voice-preview/strings-test.js
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  S, readyIn, recordingFor, medianLine, pitchValueLabel, pitchValueText,
  resonanceValueLabel, resonanceValueText, targetResult, downloadName,
  previewSettingLine, previewReadyAnnouncement, previewUpdatedAnnouncement,
} from "../../src/voice-preview/strings.js";
import { pitchLimits, targetSetting } from "../../src/voice-preview/controls.js";
import { REPO, makeChecker } from "./vp-test-lib.js";

const T = makeChecker();
const GENDER = /\b(male|female|man|men|woman|women|masc\w*|femin\w*|gender\w*|girl|boy|lady|guy)\b/i;
const SCORE = /\b(score|rating|pass|fail|good|bad)\b/i;

// ---- every string the card can show
const all = [];
const walk = (v) => {
  if (typeof v === "string") all.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
};
walk(S);
for (const ms of [0, 1, 999, 1000, 5400, 6000]) all.push(readyIn(ms));
for (const t of [0, 2.99, 3, 7.996, 8]) all.push(recordingFor(t));
for (const m of [75, 98.4, 147.6, 210, 399]) {
  all.push(medianLine(m));
  for (let st = -12; st <= 12; st++) all.push(pitchValueLabel(st, m), pitchValueText(st, m));
  const lim = pitchLimits(m * 0.8);
  for (const hz of [75, 120, 165, 205, 400]) all.push(targetResult(targetSetting(hz, m, lim)));
}
for (let pct = -21; pct <= 26; pct++) all.push(resonanceValueLabel(pct), resonanceValueText(pct));
all.push(downloadName(2, 3), downloadName(-12, -21), downloadName(0, 0));
for (const st of [-12, -2, 0, 2, 12]) for (const pct of [-21, -3, 0, 3, 26]) all.push(previewSettingLine(st, pct), previewUpdatedAnnouncement(st, pct, 147.6));
for (const hum of [false, true]) for (const noise of [false, true]) all.push(previewReadyAnnouncement({ hum, noise }));

console.log(`no gender words, no score words (${all.length} strings)`);
const g = all.filter((t) => GENDER.test(t));
const sc = all.filter((t) => SCORE.test(t));
T.check("no gender words", g.length === 0, g.slice(0, 3).join(" | "));
T.check("no score words", sc.length === 0, sc.slice(0, 3).join(" | "));
T.check("the check itself catches them", GENDER.test("More feminine") && GENDER.test("a man's voice") && SCORE.test("Your score") && !GENDER.test("manner, many, formant"));

// ---- word for word (the design note, §9)
console.log("\nwording (design note §9)");
const DESIGN = {
  viewOption: "Voice preview",
  heading: "Voice preview",
  tag: "experimental",
  aboutLabel: "About voice preview",
  intro: "Record a short phrase, then hear it with a different pitch or resonance.",
  loading: "Loading the voice preview…",
  loadError: "The voice preview could not load. Reload the page to try again.",
  unsupported: "This browser can't run the voice preview (it needs WebAssembly).",
  readyToRecord: "Say a short phrase, 3 to 8 seconds.",
  tooShort: "That was under 3 seconds. Please record at least 3 seconds.",
  cancelled: "Recording stopped because listening was turned off.",
  analysing: "Preparing the preview…",
  noVoice: "There wasn't enough voice in that recording for a preview. Try again and speak for a few seconds.",
  updating: "Updating the preview…",
  error: "Something went wrong while making the preview. Record again to try once more.",
  memory: "This device ran out of memory for the preview. Try a shorter recording.",
  record: "Record", stop: "Stop", recordAgain: "Record again", discard: "Discard", download: "Download preview (WAV)",
  recordAgainHint: "Recording again replaces this one.",
  pitch: "Pitch", pitchLow: "lower", pitchHigh: "higher",
  resonance: "Resonance", resonanceLow: "larger / darker", resonanceHigh: "smaller / brighter",
  buzzier: "may sound buzzier",
  lowLimitNote: "Lower settings would take part of your voice below 75 Hz.",
  quickSettings: "Quick settings",
  targetField: "Target pitch (Hz)", apply: "Apply",
  play: "Play", playRebuild: "Unchanged (rebuilt)", playPreview: "Preview", playOriginal: "Original", loop: "Loop", stopPlayback: "Stop",
  firstPreviewHint: "Move a slider or pick a quick setting to hear a change.",
  listeningNote: "Listening is on, so the meters hear the playback too. Headphones avoid that.",
  sessionGuard: "Playback is off while a session is being recorded, so the preview isn't saved as your voice.",
  humNotice: "There's a steady hum in the background. In the preview it can move with the pitch slider.",
  noiseNotice: "There's a lot of background noise. The preview may sound rougher.",
  quieterSpot: "A quieter spot gives a cleaner preview.",
  caveat: "A rough sketch from a vocoder; crackle or buzz comes from the processing, not your voice.",
};
const off = Object.entries(DESIGN).filter(([k, v]) => S[k] !== v).map(([k]) => k);
T.check("every listed string verbatim", off.length === 0, off.join(", "));
T.check("the caveat, word for word", S.caveat === "A rough sketch from a vocoder; crackle or buzz comes from the processing, not your voice.");
T.check("presets verbatim", JSON.stringify(S.presets) === JSON.stringify({
  higherBrighter: "Small step higher & brighter", lowerDarker: "Small step lower & darker", pitchOnly: "Pitch only",
  resonanceOnly: "Resonance only", target: "Toward my pitch target…", unchanged: "Unchanged",
}));
T.check("live-region announcements verbatim", Object.values(S.announce).join("|") === [
  "Recording.", "Recording stopped.", "Preview ready.", "Updating the preview…", "Preview updated.", "Playing the preview.",
  "Playing the unchanged rebuild.", "Playing the original.", "Loop on.", "Loop off.", "Stopped.", "Recording discarded.",
].join("|"));
T.check("about: seven paragraphs, the vocoder credit last", S.about.length === 7 && S.about[6] === "Built on WORLD, a speech vocoder by M. Morise (modified BSD licence)."
  && S.about[3] === "Lowered previews may sound buzzier: the vocoder is weakest at low pitch."
  && S.about[2].includes("“Unchanged (rebuilt)”") && S.about[5].startsWith("Your recording stays on this device, in memory only."));

// ---- value labels (§6, §10)
console.log("\nvalue labels and aria-valuetext");
const M = "−";
T.check("pitch +4 st over a 132 Hz median: \"+4 st, about 166 Hz\"", pitchValueLabel(4, 132) === "+4 st, about 166 Hz", pitchValueLabel(4, 132));
T.check("pitch 0: \"0 st, about 148 Hz\"", pitchValueLabel(0, 148) === "0 st, about 148 Hz");
T.check("pitch lowered: minus sign and \"· may sound buzzier\"", pitchValueLabel(-2, 148) === `${M}2 st, about 132 Hz · may sound buzzier`, pitchValueLabel(-2, 148));
T.check("no ASCII hyphen-minus in negative labels", !pitchValueLabel(-5, 200).includes("-") && !resonanceValueLabel(-3).includes("-"));
T.check("pitch valuetext", pitchValueText(4, 132) === "4 semitones higher, about 166 hertz"
  && pitchValueText(-2, 148) === "2 semitones lower, about 132 hertz, may sound buzzier"
  && pitchValueText(0, 148) === "unchanged, about 148 hertz" && pitchValueText(1, 148) === "1 semitone higher, about 157 hertz");
T.check("resonance labels", resonanceValueLabel(6) === "+6 %" && resonanceValueLabel(0) === "0 %" && resonanceValueLabel(-3) === `${M}3 %`);
T.check("resonance valuetext", resonanceValueText(6) === "6 percent brighter" && resonanceValueText(-3) === "3 percent darker" && resonanceValueText(0) === "unchanged");
T.check("median line", medianLine(147.6) === "Your median pitch in this recording: about 148 Hz.");
T.check("ready / recording lines", readyIn(5400) === "Ready to record in 6 s" && readyIn(1) === "Ready to record in 1 s"
  && recordingFor(3.97) === "Recording… 3 s of 8" && recordingFor(8) === "Recording… 8 s of 8");

console.log("\ntarget result and download name");
T.check("target result", targetResult({ st: 5, hz: 204, clamped: null }) === "Set to +5 st (about 204 Hz)"
  && targetResult({ st: 12, hz: 400, clamped: "high" }) === "Set to +12 st (about 400 Hz), the highest setting"
  && targetResult({ st: -3, hz: 90, clamped: "low" }) === `Set to ${M}3 st (about 90 Hz), the lowest setting · may sound buzzier`
  && targetResult({ st: -5, hz: 132, clamped: null }) === `Set to ${M}5 st (about 132 Hz) · may sound buzzier`);
{
  const lim = pitchLimits(80); // min -1
  const r = targetSetting(60, 100, lim);
  T.check("target below the low-contour limit -> the lowest setting", targetResult(r) === `Set to ${M}1 st (about 94 Hz), the lowest setting · may sound buzzier`, targetResult(r));
}

console.log("\nfix step: the setting beside Play, announcements");
T.check("setting line beside Play", previewSettingLine(2, 3) === "Preview: +2 st, +3 %" && previewSettingLine(0, -3) === `Preview: 0 st, ${M}3 %`
  && previewSettingLine(-2, -3) === `Preview: ${M}2 st, ${M}3 % · may sound buzzier`, previewSettingLine(-2, -3));
T.check("\"Preview ready.\" alone without a notice", previewReadyAnnouncement({ hum: false, noise: false }) === "Preview ready.");
T.check("…with the hum and noise notices as shown", previewReadyAnnouncement({ hum: true, noise: true }) === `Preview ready. ${S.humNotice} ${S.noiseNotice} ${S.quieterSpot}`
  && previewReadyAnnouncement({ hum: true, noise: false }) === `Preview ready. ${S.humNotice} ${S.quieterSpot}`);
T.check("\"Preview updated:\" with the setting in words, buzzier when lowered",
  previewUpdatedAnnouncement(-2, -3, 178.6) === "Preview updated: pitch 2 semitones lower, about 159 hertz, may sound buzzier; resonance 3 percent darker."
  && previewUpdatedAnnouncement(2, 0, 148) === "Preview updated: pitch 2 semitones higher, about 166 hertz; resonance unchanged.",
  previewUpdatedAnnouncement(-2, -3, 178.6));
T.check("download name (no date, no name)", downloadName(2, 3) === "syrinx-voice-preview-plus2st-plus3pct.wav"
  && downloadName(-12, -21) === "syrinx-voice-preview-minus12st-minus21pct.wav" && downloadName(0, 0) === "syrinx-voice-preview-plus0st-plus0pct.wav");

// ---- LabView's own copies
console.log("\nLabView");
const lab = readFileSync(path.join(REPO, "src/resonance-lab/LabView.jsx"), "utf8");
T.check("view option \"Voice preview\"", lab.includes(`opt("preview", "${S.viewOption}")`));
T.check("loading fallback = S.loading", lab.includes(`>${S.loading}</p>`));
T.check("load-error fallback (the card's chunk failed to download) = S.loadError", lab.includes(`>${S.loadError}</p>`));
const card = readFileSync(path.join(REPO, "src/voice-preview/VoicePreviewCard.jsx"), "utf8");
const jsxText = [...card.matchAll(/>([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)</g)].map((m) => m[1].trim()).filter(Boolean);
T.check("the card renders no literal text of its own (all from strings.js)", jsxText.length === 0, jsxText.slice(0, 3).join(" | "));

T.done();
