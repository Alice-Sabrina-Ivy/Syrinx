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

// ---- 2026-10-05 voice-vs-machine CANDIDATE phase - cand3-notch.js ----
// (r8-notch.js + per-track line coherence: shared mid-band FM of the line
// and its 2nd partial over the last <= 5 1-s windows, >= 3 needed;
// measurements/notch-voice-machine-discrimination-2026-10-05.md).
// machine-confirmed = pcorr < 0.15 OR pcoh < 1 c; voice-confirmed = pcorr
// >= 0.5 AND pcoh >= 2 c (V*s: >= 0.7 AND >= 2.5 c). Rules (coh flags):
//   voice "onset"  a voice-confirmed track is timed as onset-born (20 s clock
//                  from its first sighting) - glides / speech -> hold
//   voice "block"  a voice-confirmed track never promotes
//   machine        a machine-confirmed track promotes at 5 s even if
//                  onset-born (switch-on / intermittent sources)
//   rebirthGate    R8 breath re-births for every onset-born track ("any"),
//                  only voice-confirmed ones ("voice") or all but machine-
//                  confirmed ones ("notMachine")
// V0 must == R8, VB0 must == B.
VARIANTS.V0 = { tree: "cand3", opts: {} };
VARIANTS.VB0 = { tree: "cand3", opts: { rebirth: false } };
VARIANTS.V1 = { tree: "cand3", opts: { coh: { voice: "onset", machine: true, rebirthGate: "notMachine" } } };
VARIANTS.V2 = { tree: "cand3", opts: { rebirth: false, coh: { voice: "block", machine: true } } };
VARIANTS.V3 = { tree: "cand3", opts: { coh: { voice: "block", machine: true, rebirthGate: "notMachine" } } };
VARIANTS.V4 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "voice" } } };
VARIANTS.V4s = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "voice", vCorr: 0.7, vCoh: 2.5 } } };
VARIANTS.V5 = { tree: "cand3", opts: { coh: { voice: "onset", machine: true, rebirthGate: "voice" } } };
VARIANTS.V6 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "notMachine" } } };
// V7 = V6 + voiceRevoke: a voice-timed (not onset-born) line that later
// reads machine-confirmed gets its 5 s timing back (r2int step spin-up: the
// spin-up transient's curvature reads as shared FM)
VARIANTS.V7 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "notMachine", voiceRevoke: true } } };
// V8 = V7 + reanchor (a line >= 10 dB down for 0.5 s while still seen restarts
// its coherence windows: a weaker source now holds it) + jumpGuard (no voice
// timing for a line whose level rose >= onsetDb over its first sightings: a
// louder source took over a pre-existing line, handoff-adv "stop" cells)
VARIANTS.V8 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "notMachine", voiceRevoke: true, reanchor: true, jumpGuard: true } } };
// V9 = V8 with a 6 dB jump guard (the hum 9 dB under a note on its track)
VARIANTS.V9 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "notMachine", voiceRevoke: true, reanchor: true, jumpGuard: true, jumpDb: 6 } } };
// V10 = V9 + voice timing also revoked when the latest single window reads
// machine (a note glided onto a hum: the pooled windows still hold the glide)
VARIANTS.V10 = { tree: "cand3", opts: { coh: { voice: "onset", machine: false, rebirthGate: "notMachine", voiceRevoke: true, reanchor: true, jumpGuard: true, jumpDb: 6, revokeLast: true } } };
// real-data round (2026-10-05): V10's notMachine re-birth gate let real gated
// sources re-birth while still undecided (< 3 windows) -> 99 / 504 real
// noise_gated streams later than bc42ad0. V11 = no breath re-births at all
// (bc42ad0 + voice timing / revoke / jump guard / reanchor); V12 = re-births
// only for voice-confirmed lines, strict voice verdict (pcorr >= 0.7, pcoh
// >= 2.5 c) everywhere; V13 = the same with the 0.5 / 2 c verdict
const V10c = { voice: "onset", machine: false, voiceRevoke: true, reanchor: true, jumpGuard: true, jumpDb: 6, revokeLast: true };
VARIANTS.V11 = { tree: "cand3", opts: { rebirth: false, coh: { ...V10c, rebirthGate: "any" } } };
VARIANTS.V12 = { tree: "cand3", opts: { coh: { ...V10c, rebirthGate: "voice", vCorr: 0.7, vCoh: 2.5 } } };
VARIANTS.V13 = { tree: "cand3", opts: { coh: { ...V10c, rebirthGate: "voice" } } };
// V14 = V11 with the strict voice verdict (pcorr >= 0.7, pcoh >= 2.5 c):
// bc42ad0 (no breath re-births) + voice timing for not-onset-born lines
VARIANTS.V14 = { tree: "cand3", opts: { rebirth: false, coh: { ...V10c, rebirthGate: "any", vCorr: 0.7, vCoh: 2.5 } } };

// ---- 2026-10-05 V14 follow-up (review fixes) - cand3-notch.js ----
// V15 = V14 with the coherence band starting at the display / detector floor
// (75 Hz, PITCH_DISPLAY_RANGE.low) instead of 80 Hz: 75-80 Hz lines got no
// verdict. V16 = V15 with the takeover jump guard (jumpMode "plateau"): no
// voice timing only when the line rose >= 6 dB within 6 observations over a
// level that held within 1.5 dB for 3 consecutive sightings (a louder source
// starting on a line that was already there), instead of >= 6 dB over the
// median of its first 3 sightings (which also blocked real crescendos /
// messa di voce at the note's start). 1.5 dB < 2 x 6 dB / (6 + 1): no
// constant-slope crescendo can pass as "steady, then +6 dB in 6
// observations". V16s3 / V16r4 / V16r10 = guard sensitivity.
const V14c = { ...V10c, rebirthGate: "any", vCorr: 0.7, vCoh: 2.5 };
const PLAT = { jumpMode: "plateau", jumpRefObs: 3, jumpStableDb: 1.5, jumpRiseObs: 6 };
VARIANTS.V15 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75 } } };
VARIANTS.V16 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT } } };
VARIANTS.V16s3 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT, jumpStableDb: 3 } } };
VARIANTS.V16r4 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT, jumpRiseObs: 4 } } };
VARIANTS.V16r10 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT, jumpRiseObs: 10 } } };
// V17 = V16 + voice timing granted only while the latest single window's
// correlation is >= 0.7 too. Tried AFTER the held-out run on its one failing
// takeover cell (a note at the hum's level on its track, beating; the pooled
// verdict arrived 1 s after the note ended) and NOT adopted: it does not fix
// that cell (the granting window's correlation is 0.93: the note-to-hum
// switch is itself a frequency step shared by both partials), and a rule
// fitted to a held-out cell would make it in-sample.
VARIANTS.V17 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT, grantLastCorr: 0.7 } } };
// V18 = V16 + the takeover's steady level must be the line's loudest so far
// (no sighting before the reference more than 3 dB above it): a held-out
// Coswara /a/ dipped 13 dB after its onset, held steady ~31 dB, then rose
// 7 dB within 4 observations -> V16's takeover test fired on a voice.
VARIANTS.V18 = { tree: "cand3", opts: { rebirth: false, coh: { ...V14c, fLo: 75, ...PLAT, jumpPeakTolDb: 3 } } };

// ---- 2026-10-06 V14 fix round (review of the follow-up) - cand3-notch.js ----
// V19p = V18 + the takeover test needs the line NOT to read as a voice before
// the jump (jumpPreVoice: the windows completed before the steady reference
// ended must not pool to the voice verdict; none = fires as before): a vowel
// change / crescendo on a held voice raises its line like a takeover.
// V19 = V19p + the band measured within matchHz (3 Hz) of 75 / 400 Hz, and a
// line leaving the band drops its running series (no spliced windows): a
// voice centred on 75.0 Hz wandered out of the band and lost its windows.
// V19l = V19 + lapse: voice timing also revoked when the pooled windows fall
// under the discovery-phase verdict 0.5 / 2 c. Tried on the review's cases and
// NOT adopted: it changes none of them (the real mains-hum line that kept its
// voice timing pools 0.60-0.87 / 4-7 c throughout; the wobbling hum's note
// windows dominate the pool until the first hum-alone window).
// V19c = V19 + a 10 s cap on the voice timing of lines first seen in the
// stream's first observation (the exposure to voice-like machines that are
// running when the stream starts); a product dial, measured, not a candidate.
const V18c = { ...V14c, fLo: 75, ...PLAT, jumpPeakTolDb: 3 };
VARIANTS.V19p = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true } } };
VARIANTS.V19 = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, bandMarginHz: 3, clearOob: true } } };
// V19f = V19 with the pre-jump windows ending by the steady reference's FIRST
// sighting (a takeover note's onset transient can sit in a window that ends
// inside the steady stretch and read as shared FM: hadv --sweep, 85 Hz hum,
// 1.2 c wobble, rms 0.035, 48 kHz)
VARIANTS.V19f = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, jumpPreFirst: true, bandMarginHz: 3, clearOob: true } } };
// V19g = V19f, but voice timing is granted only while the line itself sits
// inside 75-400 Hz: the 3 Hz margin is for measurement only. V19f's margin
// also granted it to machines at 73 / 74 / 401 / 402 Hz (vmach --part=edge:
// 138 / 240 cells late, V18 0) = src/ after the fix round
VARIANTS.V19g = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, jumpPreFirst: true, bandMarginHz: 3, clearOob: true, grantInBand: true } } };
// V19h = V19g with the grant band widened by half an FFT bin (0.5 Hz): the
// line estimate of a voice centred on 75.0 Hz sits at 74.90-74.98 Hz, so
// V19g never granted it (noise-notch-test 75.0 Hz seed 16). Rejected: it
// also granted voice-like machines at 401 Hz whose wobble reaches 400.5 Hz
// (vmach --part=edge 6 / 240 cells late, 2 never notched; V19g 0)
VARIANTS.V19h = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, jumpPreFirst: true, bandMarginHz: 3, clearOob: true, grantInBand: true, grantTolHz: 0.5 } } };
VARIANTS.V19l = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, bandMarginHz: 3, clearOob: true, lapseCorr: 0.5, lapseCoh: 2 } } };
VARIANTS.V19c = { tree: "cand3", opts: { rebirth: false, coh: { ...V18c, jumpPreVoice: true, bandMarginHz: 3, clearOob: true, capSec: 10 } } };
