// pitchUtils.js — Hz to musical note mapping

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
];

/**
 * Convert a frequency in Hz to the nearest musical note name + octave.
 * Uses A4 = 440 Hz standard tuning.
 * Returns e.g. { note: "A", octave: 3, cents: -12 }
 */
export function hzToNote(hz) {
  if (!hz || hz <= 0) return null;

  // Number of semitones from A4
  const semitones = 12 * Math.log2(hz / 440);
  const rounded = Math.round(semitones);
  const cents = Math.round((semitones - rounded) * 100);

  // A4 is MIDI note 69 → note index 9 (A), octave 4
  const midi = 69 + rounded;
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return {
    note: NOTE_NAMES[noteIndex],
    octave,
    cents,
    name: `${NOTE_NAMES[noteIndex]}${octave}`,
  };
}
