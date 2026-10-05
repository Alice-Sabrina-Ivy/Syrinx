// variants.mjs â€” notch configurations for the round-1 adversarial suite.
// Candidate option flags: cand-notch.js (setup.sh installs it as trees/cand) (cfg defaults = 6f8be18).
const C1 = { relGate: true, prerollMs: 1e-9, floorK: 4, lineFloorK: 2 };
export const VARIANTS = {
  B: { tree: "bc42" },                       // bc42ad0 notch
  H: { tree: "head" },                       // 6f8be18 notch (= HEAD)
  SRC: { tree: "src" },                      // worktree src/
  P0: { tree: "cand", opts: { latch: false, offsetRebirth: false } },   // must == B
  PH: { tree: "cand", opts: {} },                                       // must == H
  noNotch: { tree: "cand", opts: { minTrackSec: 1e9, onsetMinTrackSec: 1e9 } },
  // latch kept, regressions closed: release re-birth line-gated, plausible-
  // level pre-roll, robust (4th-smallest) chunk floor, line-vs-floor birth test
  C1: { tree: "cand", opts: C1 },
  C1s: { tree: "cand", opts: { ...C1, shortGap: { sec: 0.1, db: 18 } } },
  C2: { tree: "cand", opts: { ...C1, lineFloorK: 10 } },
  C2k4: { tree: "cand", opts: { ...C1, lineFloorK: 4 } },
  C3: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, shortGap: { sec: 0.1, db: 18 } } },
  C3n: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true } },
  C3b: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, shortGap: { sec: 0.1, db: 18 } } },
  C4: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 } } },
  C4a: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "all", shortGap: { sec: 0.1, db: 18 } } },
  C5: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true } },
  C6: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true, floorMin: true } },
  C6k12: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true, floorMin: true } },
  C6k15: { tree: "cand", opts: { ...C1, lineFloorK: 31.6, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true, floorMin: true } },
  // C7 = round-1 candidate (C6 with lineFloorDb 12)
  C7: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true, floorMin: true } },
  C8: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true, floorMin: true, floorStrict: true } },
  C4k: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, keepAlive: true } },
  C4m: { tree: "cand", opts: { ...C1, lineFloorK: 10, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, floorMin: true } },
  C9: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, floorStrict: true, floorStable: 2, floorTrust: true } },
  C9u: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, floorStrict: true, floorStable: 2 } },
  C10: { tree: "cand", opts: { ...C1, lineFloorK: 15.85, binDip: true, clearRel: true, revoke: "latch", shortGap: { sec: 0.1, db: 18 }, floorStrict: true, floorStable: 2, floorTrust: true, keepMasked: true } },
  BM: { tree: "cand", opts: { latch: false, offsetRebirth: false, keepMasked: true } },
  N2: { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 } } },
  N2i: { tree: "cand", opts: { latch: false, binDip: true, inherit: true, shortGap: { sec: 0.1, db: 18 } } },
  N1b: { tree: "cand", opts: { latch: false, inherit: true, binDip: true } },
  BK: { tree: "cand", opts: { latch: false, offsetRebirth: false, keepAlive: true } },
  C1r: { tree: "cand", opts: { relGate: true } },
  // no latch: bc42ad0 + line-gated offset re-birth + glide inheritance
  N1: { tree: "cand", opts: { latch: false, inherit: true } },
  N1s: { tree: "cand", opts: { latch: false, inherit: true, shortGap: { sec: 0.1, db: 18 } } },
};
// round-1 iteration on N2: mid-hold glide / step handoff (a line born where
// a HELD onset-born line just vanished inherits its onset-born status + clock)
VARIANTS.N3 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5 } } };
// N4 = N3, but a child born up to 0.6 s before its parent vanished also
// inherits (a step's 512 ms window holds both pitches for ~5 observations)
VARIANTS.N4 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 0.6 } } };
// N5 = N4, handoff only while the band has not dipped >= dipDb under its 2 s
// max (a glide keeps sounding; a hum reappearing after a held note ENDED
// beside it is not a moved note)
VARIANTS.N5 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 0.6, bandHold: true } } };
// N2r = N2 + revoke of a breath re-birth when the line stays a peak 0.7 s
// into a band dip (a hum the note sat on); N6 = N5 + that + line memory
// (no handoff to a line where a not-onset-born line was dropped < 30 s ago)
VARIANTS.N2r = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 } } };
VARIANTS.N6 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 0.6, bandHold: true, memSec: 30 } } };
// N7 = N6 with the line memory matched within minSepHz (10 Hz: the hum line
// could only have been masked by a note that close; a glide onto it ends
// up to ~3 Hz off the remembered line)
VARIANTS.N7 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 0.6, bandHold: true, memSec: 30, memTolHz: 10 } } };
// N8 = N5 + breath re-birth revoke + handoff revoke (an inherited line still
// a peak 0.7 s into a band dip is a hum the note sat on); no line memory
VARIANTS.N8 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 0.6, bandHold: true, revokeSec: 0.7 } } };
// N9 = N8 with handoffYoungSec 1.5 (a 1.5 s glide's H2 spawns intermediate
// lines before the parent vanishes)
VARIANTS.N9 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, lostSec: 1.5, youngSec: 1.5, bandHold: true, revokeSec: 0.7 } } };
// N10 = N8 with the parent's held duty relaxed to 0.7 (a note's H2 near the
// 460 Hz band edge is picked at ~0.8 duty; syllables are never held 1 s)
VARIANTS.N10 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, heldDuty: 0.7, lostSec: 1.5, youngSec: 0.6, bandHold: true, revokeSec: 0.7 } } };
// N11 = N10, but the handed-off line starts its OWN 20 s clock (taking the
// parent's promoted a speech peak on the spot when the "parent" was an
// onset-born mains line masked for one observation)
VARIANTS.N11 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7 }, handoff: { cents: 160, heldSec: 1, heldDuty: 0.7, lostSec: 1.5, youngSec: 0.6, bandHold: true, revokeSec: 0.7, ownClock: true } } };
// N12 = N11 with both revokes requiring the line seen in 3 consecutive
// observations of the band dip (a single sighting was the NEXT note's onset
// at the end of a 1 s breath's observation window)
VARIANTS.N12 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7, persist: 3 }, handoff: { cents: 160, heldSec: 1, heldDuty: 0.7, lostSec: 1.5, youngSec: 0.6, bandHold: true, revokeSec: 0.7, ownClock: true, persist: 3 } } };
// N13 = N12 + a second breath re-birth revoke: the line back at >= -dipDb of
// its pre-dip median in 2 consecutive observations while the band is still
// down (a beating / amplitude-modulated hum's trough met a speech pause)
VARIANTS.N13 = { tree: "cand", opts: { latch: false, binDip: true, shortGap: { sec: 0.1, db: 18 }, revokeRebirth: { afterSec: 0.7, persist: 3, recover: 2 }, handoff: { cents: 160, heldSec: 1, heldDuty: 0.7, lostSec: 1.5, youngSec: 0.6, bandHold: true, revokeSec: 0.7, ownClock: true, persist: 3 } } };

// ---- round 2 (2026-10-04, after the round-1 review) — cand2-notch.js ----
// R1 = cb00425 exactly (tree r1); R2h = cb00425 with the glide / step
// handoff off; R2q = R2h + the quiet-window line gate on breath re-births
// (cb00425's revokes kept); R2 = R2h + quiet gate, cb00425's revokes
// replaced by the quiet-window STEADY revoke of the whole re-birth chain.
VARIANTS.R1 = { tree: "r1" };
VARIANTS.R1c = { tree: "cand2", opts: {} };                       // must == R1
VARIANTS.R2h = { tree: "cand2", opts: { handoffCents: 0 } };
VARIANTS.R2q = { tree: "cand2", opts: { handoffCents: 0, quietGate: true } };
VARIANTS.R2 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false } };
// R3 = R2 with a run-scoped STEADY verdict: 3 consecutive prominent windows
// (100 ms span), each within 3 dB of the previous and the last within 3 dB of
// the first (a reverberant release tail decays >= 7.5 dB / 100 ms at RT60
// <= 0.8 s); no permanent flag
VARIANTS.R3 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 3, quietDecayDb: 3 } };
VARIANTS.R3q = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, steadyWin: 3, quietDecayDb: 3 } };
// R4 = R3 with a 5-window (200 ms span) STEADY verdict: a room mode / comb
// ringing in the release tail can hold ~150 ms before it decays
VARIANTS.R4 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 5, quietDecayDb: 3 } };
// R5 = R4 + a line decaying >= 6 dB over 3 quiet windows counts as absent
// (a reverberant release tail never drops under the prominence floor
// inside a 0.25-0.5 s breath)
VARIANTS.R5 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 5, quietDecayDb: 3, decayEligDb: 6 } };
// R6 = R5 with (a) decay-absence only for a FAST decay (>= 6 dB over the
// last 3 windows / 100 ms: a beat sliding into its null over 300 ms is not a
// release tail) and (b) PROVISIONAL re-births while the quiet run lasts:
// confirmed when the run ends, cancelled when the line comes back >= 3 dB
// over its minimum inside the same run (an equal-amplitude beat null); the
// track cannot promote while provisional
VARIANTS.R6 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 5, quietDecayDb: 3, decayEligDb: 6, decaySpan: 3, prov: true, returnDb: 3 } };
// R7 = R6 with a stricter "came back": >= 6 dB over its minimum AND >= 20 x
// the local floor (13 dB; a noise bin crossing the 10 dB absence threshold
// cancelled a reverberant breath's re-birth)
VARIANTS.R7 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 5, quietDecayDb: 3, decayEligDb: 6, decaySpan: 3, prov: true, returnDb: 6, returnK: 20 } };
// R8 = R7, decay-absence also needs an AVERAGE decay >= 3 dB per 50 ms hop
// since the run's first window (a release tail decays from the moment the
// note stops; a 1:1 beat slides slowly, then plunges into its null)
VARIANTS.R8 = { tree: "cand2", opts: { handoffCents: 0, quietGate: true, n13Revokes: false, steadyWin: 5, quietDecayDb: 3, decayEligDb: 6, decaySpan: 3, prov: true, returnDb: 6, returnK: 20, decayRateDb: 3 } };
