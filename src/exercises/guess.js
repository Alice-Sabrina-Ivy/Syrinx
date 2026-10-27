// guess.js — "Test your ear" (R3, R4): two recordings play as A and B in a random order,
// the user picks the one that sounds brighter, then sees which was which. No tally, nothing
// saved (pure; tests/exercises/take-checks-test.js).
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

/** R4: which of A / B (0 / 1) is the brighter one — the changed version if it moved brighter, else the unchanged one. */
export function brighterIndex(round) {
  return round.order.indexOf(round.shift > 0 ? `shift${round.shift}` : "unchanged");
}
