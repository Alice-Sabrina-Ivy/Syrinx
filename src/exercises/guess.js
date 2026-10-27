// guess.js — "Test your ear" (R3, R4): two recordings play as A and B in a random order,
// the user picks the one that sounds brighter (R4's darker version: darker), then sees
// which was which. No tally, nothing saved (pure; tests/exercises/take-checks-test.js).
//
// A round: { order: [idA, idB], shift (R4: the change in %, else null), played: [bool, bool],
// pick: 0 | 1 | null }. R3's ids are its take ids (guess.takes); R4's are "unchanged" (Voice
// Shaper's unchanged rebuild) and "shift<pct>" (a resonance-only version of the same rebuild,
// so only the resonance differs — not the raw recording, whose own sound would give it away).

/** A new round for a guess card ({ guess: { takes } | { hear } }); `shifts` = the direction's changes. */
export function newGuessRound(card, shifts, rand = Math.random) {
  const shift = card.guess.takes ? null : shifts[Math.min(shifts.length - 1, Math.floor(rand() * shifts.length))];
  const pair = card.guess.takes ? [...card.guess.takes] : ["unchanged", `shift${shift}`];
  const order = rand() < 0.5 ? pair : [pair[1], pair[0]];
  return { order, shift, played: [false, false], pick: null };
}

/** The round with recording i (0 = A, 1 = B) marked as heard. */
export function markPlayed(round, i) {
  if (round.played[i]) return round;
  return { ...round, played: i ? [round.played[0], true] : [true, round.played[1]] };
}

/** The word the round asks about: R4's darker version is asked as "darker", everything else as "brighter". */
export function askedWord(round) {
  return round.shift != null && round.shift < 0 ? "darker" : "brighter";
}

/** R4: which of A / B (0 / 1) answers the question — always the changed version (it is the brighter or the darker one). */
export function answerIndex(round) {
  return round.order.indexOf(`shift${round.shift}`);
}

/** The lines shown after a pick. `desc(id)` names a recording (R3: "bright" take; R4: "the unchanged version"). */
export function revealLines(round, names, desc, ui) {
  const lines = [ui.guessPicked(names[round.pick])];
  if (round.shift == null) {
    lines.push(ui.guessTakes(desc(round.order[0]), desc(round.order[1])), ui.guessHintTakes);
  } else {
    lines.push(ui.guessHear(desc(round.order[0]), desc(round.order[1])), ui.guessAnswer(askedWord(round), names[answerIndex(round)]), ui.guessHintHear);
  }
  return lines;
}
