// strings.js — every user-facing string of the Voice Shaper card (the feature was called
// "Voice preview" until 2026-10-20; the files keep that name), word for word as
// measurements/voice-preview-phase1-2026-10-19.md §9 / §10 lists them (the names as renamed
// in its "Renamed and moved 2026-10-20" section), plus the value
// labels built from them (pure; tests/voice-preview/strings-test.js checks every string
// for gender words and score words, and the caveat and "may sound buzzier" verbatim).
// Negative values use the minus sign U+2212.
import { shiftedHz } from "./controls.js";

const MINUS = "−";
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : "0");

export const S = Object.freeze({
  // the app's tab (App.jsx carries its own copy; tests/voice-preview/strings-test.js checks it)
  tab: "Voice Shaper",
  heading: "Voice Shaper",
  tag: "experimental",
  aboutLabel: "About Voice Shaper",
  intro: "Record a short phrase, then hear it with a different pitch or resonance.",

  // states
  loading: "Loading Voice Shaper…",
  loadError: "Voice Shaper could not load. Reload the page to try again.",
  unsupported: "This browser can't run Voice Shaper (it needs WebAssembly).",
  readyToRecord: "Say a short phrase, 3 to 8 seconds.",
  tooShort: "That was under 3 seconds. Please record at least 3 seconds.",
  cancelled: "Recording stopped because listening was turned off.",
  analysing: "Preparing the preview…",
  noVoice: "There wasn't enough voice in that recording for a preview. Try again and speak for a few seconds.",
  updating: "Updating the preview…",
  error: "Something went wrong while making the preview. Record again to try once more.",
  memory: "This device ran out of memory for the preview. Try a shorter recording.",

  // buttons
  record: "Record",
  stop: "Stop",
  recordAgain: "Record again",
  discard: "Discard",
  download: "Download preview (WAV)",
  recordAgainHint: "Recording again replaces this one.",

  // sliders
  pitch: "Pitch",
  pitchLow: "lower",
  pitchHigh: "higher",
  resonance: "Resonance",
  resonanceLow: "larger / darker",
  resonanceHigh: "smaller / brighter",
  buzzier: "may sound buzzier",
  lowLimitNote: "Lower settings would take part of your voice below 75 Hz.",

  // quick settings
  quickSettings: "Quick settings",
  presets: Object.freeze({
    higherBrighter: "Small step higher & brighter",
    lowerDarker: "Small step lower & darker",
    pitchOnly: "Pitch only",
    resonanceOnly: "Resonance only",
    target: "Toward my pitch target…",
    unchanged: "Unchanged",
  }),
  targetField: "Target pitch (Hz)",
  apply: "Apply",

  // playback
  play: "Play",
  playRebuild: "Unchanged (rebuilt)",
  playPreview: "Preview",
  playOriginal: "Original",
  loop: "Loop",
  stopPlayback: "Stop",
  firstPreviewHint: "Move a slider or pick a quick setting to hear a change.",
  listeningNote: "Listening is on, so the meters hear the playback too. Headphones avoid that.",
  sessionGuard: "Playback is off while a session is being recorded, so the preview isn't saved as your voice.",

  // recording check
  humNotice: "There's a steady hum in the background. In the preview it can move with the pitch slider.",
  noiseNotice: "There's a lot of background noise. The preview may sound rougher.",
  quieterSpot: "A quieter spot gives a cleaner preview.",

  // background-noise reduction (2026-10-23; measurements/voice-shaper-denoise-2026-10-23.md)
  denoise: "Reduce background noise",
  denoiseHint: "Cleans up the recording before the preview is made. “Original” stays as recorded. The first use downloads about 1.4 MB.",
  denoiseError: "Noise reduction couldn't load, so the preview uses the recording as captured.",
  denoiseTry: "“Reduce background noise” below can help.",

  caveat: "A rough sketch from a vocoder; crackle or buzz comes from the processing, not your voice.",

  // polite live region
  announce: Object.freeze({
    recording: "Recording.",
    recordingStopped: "Recording stopped.",
    previewReady: "Preview ready.",
    updating: "Updating the preview…",
    updated: "Preview updated.",
    playingPreview: "Playing the preview.",
    playingRebuild: "Playing the unchanged rebuild.",
    playingOriginal: "Playing the original.",
    loopOn: "Loop on.",
    loopOff: "Loop off.",
    stopped: "Stopped.",
    discarded: "Recording discarded.",
    denoiseOn: "Noise reduction on. Updating the preview…",
    denoiseOff: "Noise reduction off. Updating the preview…",
  }),

  about: Object.freeze([
    "Hear roughly how a pitch or resonance setting sounds, using your own recording. It is a sketch, not a prediction of how you will sound.",
    "Pitch moves your whole pitch contour up or down. Resonance moves all your formants up or down together, as a smaller or larger vocal tract would. Real resonance training moves some formants more than others, and your voice quality, intonation and articulation stay as you recorded them.",
    "Compare the preview with “Unchanged (rebuilt)”: both go through the same vocoder, so the difference you hear is the setting. “Original” is your recording as captured.",
    "Lowered previews may sound buzzier: the vocoder is weakest at low pitch.",
    "A steady hum or loud background noise can make the preview rougher, and a hum can move with the pitch slider.",
    "“Reduce background noise” cleans up the recording with RNNoise before the preview is made. It helps most with loud background noise such as a fan, hiss or traffic. With little noise it can make the preview slightly rougher, more so for low voices, and it can soften quiet or breathy parts of your voice, so compare it on and off.",
    "Your recording stays on this device, in memory only. It is deleted when you press Discard, record again or close the tab, and saved only if you press Download.",
    "Built on WORLD, a speech vocoder by M. Morise (modified BSD licence).",
    "Noise reduction: RNNoise by J.-M. Valin and Xiph.Org (BSD licence).",
  ]),
});

/** "Ready to record in {n} s" (whole seconds, rounded up). */
export const readyIn = (ms) => `Ready to record in ${Math.max(1, Math.ceil(ms / 1000))} s`;

/** "Recording… {t} s of 8" (whole seconds recorded so far). */
export const recordingFor = (seconds, maxS = 8) => `Recording… ${Math.floor(seconds + 1e-9)} s of ${maxS}`;

/** "Your median pitch in this recording: about {hz} Hz." */
export const medianLine = (medianHz) => `Your median pitch in this recording: about ${Math.round(medianHz)} Hz.`;

/** Pitch value: "+4 st, about 166 Hz"; lowered adds " · may sound buzzier". */
export function pitchValueLabel(st, medianHz) {
  const base = `${signed(st)} st, about ${shiftedHz(medianHz, st)} Hz`;
  return st < 0 ? `${base} · ${S.buzzier}` : base;
}

/** The pitch slider's aria-valuetext: "4 semitones higher, about 166 hertz", … */
export function pitchValueText(st, medianHz) {
  const hz = `about ${shiftedHz(medianHz, st)} hertz`;
  if (st === 0) return `unchanged, ${hz}`;
  const n = Math.abs(st);
  const unit = n === 1 ? "semitone" : "semitones";
  return st > 0 ? `${n} ${unit} higher, ${hz}` : `${n} ${unit} lower, ${hz}, ${S.buzzier}`;
}

/** Resonance value: "+6 %", "0 %", "−3 %". */
export const resonanceValueLabel = (pct) => `${signed(pct)} %`;

/** The resonance slider's aria-valuetext: "6 percent brighter", "3 percent darker", "unchanged". */
export function resonanceValueText(pct) {
  if (pct === 0) return "unchanged";
  return pct > 0 ? `${pct} percent brighter` : `${Math.abs(pct)} percent darker`;
}

/**
 * The target row's result: "Set to +5 st (about 204 Hz)", ", the highest setting" when clamped;
 * a lowered setting adds " · may sound buzzier" (fix step).
 */
export function targetResult({ st, hz, clamped }) {
  const end = clamped === "high" ? ", the highest setting" : clamped === "low" ? ", the lowest setting" : "";
  return `Set to ${signed(st)} st (about ${hz} Hz)${end}${st < 0 ? ` · ${S.buzzier}` : ""}`;
}

/** Beside the Play buttons: the setting the Preview button plays, "Preview: −2 st, −3 % · may sound buzzier". */
export function previewSettingLine(st, pct) {
  const base = `Preview: ${signed(st)} st, ${signed(pct)} %`;
  return st < 0 ? `${base} · ${S.buzzier}` : base;
}

/** "Preview ready." plus the recording check's notices, as shown (fix step: they were not announced). */
export function previewReadyAnnouncement(check) {
  const parts = [S.announce.previewReady];
  if (check?.hum) parts.push(S.humNotice);
  if (check?.noise) parts.push(S.noiseNotice);
  if (check?.hum || check?.noise) parts.push(S.quieterSpot);
  return parts.join(" ");
}

/**
 * After a render: "Preview updated: pitch 2 semitones lower, about 159 hertz, may sound
 * buzzier; resonance 3 percent darker." (the setting in words, so a quick setting or the
 * target row tells a screen-reader user what changed).
 */
export function previewUpdatedAnnouncement(st, pct, medianHz) {
  return `Preview updated: pitch ${pitchValueText(st, medianHz)}; resonance ${resonanceValueText(pct)}.`;
}

/**
 * Download name: syrinx-voice-shaper-{plus|minus}{n}st-{plus|minus}{m}pct.wav (no date, no name),
 * with "-noise-reduced" before ".wav" when the preview was made from the denoised recording.
 */
export const downloadName = (st, pct, denoised = false) =>
  `syrinx-voice-shaper-${st < 0 ? "minus" : "plus"}${Math.abs(st)}st-${pct < 0 ? "minus" : "plus"}${Math.abs(pct)}pct${denoised ? "-noise-reduced" : ""}.wav`;
