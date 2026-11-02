# Resonance row: a narrower hold through pauses (2026-11-01)

Branch `resonance-hold-narrow` (from `resonance-mobile` 7e00e59; `main` is
9e1696b). Public data only. Follows
[resonance-row-hold-2026-10-28.md](resonance-row-hold-2026-10-28.md), whose
candidate C1 (hold the resonance row for 5 s after the last shown voice, any
noise floor) passed its speech targets and failed its noise guard, and
[resonance-phone-vs-desktop-2026-10-28.md](resonance-phone-vs-desktop-2026-10-28.md)
§5 (the onset blink and the noisy-pause dropout).

User decision 2026-11-01: "Try a narrower version in a new measured round"
(instead of adopting C1 or reverting it).

**Status (2026-11-02):** K4 (`createVoiceHoldRef`) is wired into
`CueStrip.jsx` on this branch and proposed for `main` with the rest of the
branch. The phone / headset investigation behind this round is paused (user
decision 2026-11-02). One side-by-side session with the test sound only (no
voice steps) ran on 2026-11-01; see the status block of
[resonance-phone-vs-desktop-2026-10-28.md](resonance-phone-vs-desktop-2026-10-28.md).
Local folder paths in this note were replaced by placeholders the same day
(Review and fixes, "Local folder paths"). Also on 2026-11-02: K4 checked by
hand on a Pixel phone, and two display-text changes ("After the round").
Wording only, 2026-11-02: "owner" was replaced by "user" in this note,
including three lines of the pre-registered plan (§1, §3.1 and §3.6); no
target, guard, rule or number changed. The plan as committed is 8ab1703.

## Plan (pre-registered, 2026-11-01, before any result)

This plan is committed and pushed alone, before any candidate rule below has
been replayed on any data. Up to that commit, only existing BASE and C1
results were read and descriptive statistics of existing BASE records were
computed. §5.1 lists them as "seen", with the alternatives they compared.
Two critics reviewed the draft; §13 lists every finding and what was done.

**Where the code and the prose differ, the code wins.** The code blocks in
§3 are normative; the prose around them explains them.

### 1. Scope: what may change

- **Display only.** Only the resonance row's state and trail may change. A
  candidate is a pure factory in `src/components/cueStripModel.js` that the
  strip's 4 Hz tick in `CueStrip.jsx` calls, as C1's `createResonanceHold`
  is called. Its answer goes to `cueRowStates` as `resonanceHold`.
- **Unchanged.** These stay as they are:
  - the pitch row;
  - recorded session frames;
  - the resonance worker, and every u it posts;
  - `resonanceRowState`, `cueRowStates`, `createTrail`, `cueSummary`,
    `dotOpacity`, `rowValue`, `axisPos`;
  - the hook: `src/audio/useAudioPipeline.js` stays byte-identical to
    7e00e59.
- **No new hook state field.** Every candidate reads the hook's existing
  throttled `intensity`: the 50 ms full-band DSP level of the frame that
  fired the 200 ms state update. Every throttled update already sets it,
  on the silence path and on the voiced path, and `stop()` sets it back to
  null. F1's one-field allowance is therefore not used.
- **Prop wiring.** The value reaches the strip through `App.jsx` →
  `CombinedDashboard.jsx` → `CueStrip.jsx`, as a new `intensity` prop. That
  is display wiring only. It is committed only if a candidate is adopted
  (§10); during the dev stage it exists only in an uncommitted working copy
  for G5.
- **Render cost.** `App` already re-renders on every state update, and the
  memoised meter columns do not receive the new prop. So no new renders.
- **No "keep talking…".** A hold never shows it (warming). `cueRowStates`
  replaces only "idle", and keeps "idle" where the held state would be
  "warming".
- **Hard rule 3.** These files are not on its list. This round is
  pre-registered by user decision.

### 2. Arms

- **BASE**: the shipped rule (`main` / 7afa3c1). `cueRowStates` is called
  without `resonanceHold`.
- **C1**: the 2026-11-01 hold (`createResonanceHold`, 45e54f2, wired in
  `CueStrip.jsx` on `resonance-mobile`). It is a reference arm only and not
  eligible.
- **K1–K5**: the candidates (§3). That is five configurations, against a cap
  of six. No parameter variants.

### 3. Candidates

#### 3.1 Common to all five

**Wiring** (the shipped C1 pattern, so `cue-strip-wiring-test.js`'s
structural checks still hold). Each candidate is a factory in
`cueStripModel.js` with one signature. Its tick is pure: it reads no clock;
the clock is passed in.

```js
// CueStrip.jsx, the tick effect (as C1's createResonanceHold today):
const hold = createK();                                  // once per tick effect, beside the trails
// latest.current = { pitchVoiced, pitchHolding, pitchLevel, intensity, resonanceStatus, direction }
// at each 4 Hz tick (setInterval, TRAIL_EVERY_MS = 250 ms):
const p = latest.current;
const snap = resonanceRef.current;
const resonanceHold = hold.tick(
  { pitchVoiced: p.pitchVoiced, pitchHolding: p.pitchHolding, pitchLevel: p.pitchLevel,
    intensity: p.intensity, snap, workerStatus: p.resonanceStatus, hasRef: !!ref },
  performance.now());                                    // harness: the tick time in ms
const inputs = { ...p, snap, workerStatus: p.resonanceStatus, resonanceHold };
const states = cueRowStates({ ...inputs, hasRef: !!ref });
// setView({ snap, resonanceHold, … }); every render until the next tick uses view.resonanceHold (as C1)
```

**Inputs at the tick.**
- `pitchVoiced`, `pitchHolding`, `pitchLevel` and `intensity` are the latest
  props (`latest.current`). In the app these are the hook's throttled state.
- `snap` is `resonanceRef.current`, the latest resonance worker post.
- `workerStatus` is the `resonanceStatus` prop.
- `hasRef` is whether the reference bands have loaded.

**Preamble, identical in every candidate** (runs first at every tick):

```js
if (intensity == null || Number.isNaN(intensity)) { reset(); return false; } // not listening / no DSP frame yet
if (workerStatus !== "ready") return false;                                   // no update, no reset
const t = nowMs;
const v = !!pitchVoiced, h = !!pitchHolding;
const x = Math.max(-120, intensity);                                          // -Infinity (digital silence) -> -120
const rBase = cueRowStates({ pitchVoiced, pitchHolding, pitchLevel, snap, workerStatus, hasRef }).resonance; // BASE's row, no hold
```

`reset()` sets every time variable to −Infinity, every list to `[]` and
every boolean to false (the factory's initial state). Helpers:
- `quantile(a, p)`: sort a copy of `a` ascending into `s` (n values), take
  `i = p·(n − 1)`, and return `s[⌊i⌋] + (s[⌈i⌉] − s[⌊i⌋])·(i − ⌊i⌋)`.
- `median(a)`: the middle value of the sorted copy, or the mean of the two
  middle values.

`SILENCE_THRESHOLD_DB` (−50, `src/audio/pitchGate.js`) and
`SILENCE_HOLD_MS` (5000, `src/utils/constants.js`) are imported, not
copied.

**Interaction with every resonance row state** (unchanged `cueRowStates`):
- The flag acts only where BASE's resonance state is "idle".
- It never touches: starting, restarting, reload, unavailable, paused,
  narrowband, sustained, warming, settling, holding or live.
- Where BASE is "idle" and the flag is true, the row takes
  `resonanceRowState({ voiced: false, holding: true })`. That is "holding"
  (the thumb dimmed to 0.5 at the snapshot's u), "settling" (0.45) or
  "sustained" ("needs running speech", 0.3).
- If the held state would be "warming" (no position yet), the row stays
  "idle".
- **G4 by construction.** A candidate's state, and its thumb, differ from
  BASE only where BASE is idle. The u is the same snapshot in both.

**Trail.** `createTrail` is unchanged:
- it samples only while "live";
- it freezes in every other state;
- it clears on "idle" and on any change into or out of "sustained" or
  "narrowband".

A held tick is not idle, so it does not clear the trail.

**The pitch row** never reads the flag. Its state comes from the same
`cueRowStates` call (G3).

**Screen-reader summary.** `cueSummary` is unchanged:
- A held "holding" row reads like today's quiet-pause hold: the band words
  and the start-relative words.
- A held noisy pause therefore reads like a live position where BASE read
  "no voice right now".
- Adding "(last reading)" stays a separate user decision. It is not part
  of this round.

**Parameter count** (for F8's last tie-break): every number a candidate's
rule uses, shared constants included; the preamble's −120 dBFS clamp counts
for every candidate. The verdict set counts as one.

#### 3.2 K1 QB: quiet-hold onset bridge (the pure onset-blink bridge, F9)

Bridges at most the next two ticks after a tick that showed the hook's own
dim hold in a pause quieter than the silence threshold, within 5 s of shown
voice. This is where the onset blink comes from: after a silence-gated
pause, the first frames of resumed speech carry no painted pitch, and the
voiced-fall counter has already run out.

```js
// state: lastV = -Infinity, lastArm = -Infinity
if (v) lastV = t;
if (h && !v && x < SILENCE_THRESHOLD_DB && t - lastV <= SILENCE_HOLD_MS) lastArm = t;
return t - lastArm <= 700;
```

- **Parameters (4):** bridge 700 ms, recency 5000 ms, level −50 dBFS, clamp
  −120 dBFS.
- **Why 700 ms.** It covers the ticks at +250 and +500 ms, with up to
  200 ms of timer lateness. The tick at +750 ms is never covered at nominal
  spacing, because setInterval does not fire early.
- **Expected** (from the seen statistics, §5.1): fixes most quiet-room
  blinks. **Both T-QUIET criteria are at risk:**
  - the trail may fall just short of 10 points, because 9–12 % of the
    quiet idle entries do not follow such a tick;
  - the thumb criterion too: in 8.7–16.8 % of the quiet conditions' 1–5 s
    pause windows there is an idle run that is not a ≤ 2-tick run ending
    live; these start 0.3–1.7 s into the pause and are mostly not
    silence-gated (seen stats4 / stats5). K1 covers one only if a quiet
    hold tick falls in the 700 ms before it.

  The thumb in noisy pauses is as in BASE. T-NOISY is about 0.
- **Noise cost.** Close to zero: it arms only within 5 s of shown voice, on
  a held tick quieter than −50 dBFS, and only bridges 2 ticks.

#### 3.3 K2 VB: own-voice-armed bridge

Bridges at most the next two ticks after any tick where BASE's resonance
row was not idle. It is armed only if a tick in the last 6 s showed a voice
that was clearly louder than the room and that the resonance worker was
scoring.

```js
// state: L = [] (the last 40 tick levels), lastQ = -Infinity, lastNI = -Infinity
L.push(x); if (L.length > 40) L.shift();
const floor = L.length >= 16 ? quantile(L, 0.2) : null;   // the room: quieter fifth of the last ~10 s
const own = v && floor !== null && x >= floor + 10
  && (snap?.verdict === "score" || snap?.verdict === "pause");
if (own) lastQ = t;
if (rBase !== "idle" && rBase !== "starting") lastNI = t;
return t - lastNI <= 700 && t - lastQ <= 6000;
```

- **Parameters (8):** ring 40 ticks, at least 16 ticks, quantile 0.2,
  margin 10 dB, bridge 700 ms, arming 6000 ms, clamp −120 dBFS, verdict set.
- **Expected:** fixes every idle run of 1–2 ticks in quiet. That covers
  99 % of them, including those after the hook's non-quiet holds and the
  flicks at −55 dBFS. T-QUIET is likely. In noisy pauses the thumb still
  goes about 0.8 s in. T-NOISY is about 0–2.
- **Noise cost.** Only after a loud, scored shown-voice tick, and at most
  0.75 s per BASE episode end.

#### 3.4 K3 VH: own-voice hold, length scaled by the evidence

This is K2 plus a hold. Each own-voice tick extends the hold to 1 s per
own-voice tick in the last 5 s, at most 5 s.

```js
// state: L = [], Q = [] (times of own-voice ticks), lastQ = -Infinity, lastNI = -Infinity, holdUntil = -Infinity
L.push(x); if (L.length > 40) L.shift();
const floor = L.length >= 16 ? quantile(L, 0.2) : null;
const own = v && floor !== null && x >= floor + 10
  && (snap?.verdict === "score" || snap?.verdict === "pause");
if (own) {
  lastQ = t;
  Q = Q.filter((u) => u > t - 5000); Q.push(t);
  holdUntil = Math.max(holdUntil, t + Math.min(5000, 1000 * Q.length));
}
if (rBase !== "idle" && rBase !== "starting") lastNI = t;
return (t - lastNI <= 700 && t - lastQ <= 6000) || t <= holdUntil;
```

- **Parameters (11):** K2's 8, plus 1000 ms per tick, the 5000 ms cap and
  the 5000 ms evidence window.
- **Expected:** fixes the noisy-pause dropout where the user's voice
  stands ≥ 10 dB over the room. On dev that is the −50 and −48 dBFS floors.
  It cannot help at −40 dBFS, where the voice is about 5 dB over the room.
  T-NOISY is about 4–7.
- **Noise cost.** A false cluster of n own-voice ticks costs about
  min(n, 5) s minus BASE's own ~0.8 s tail. Seen noise clusters have a
  median of 1 tick and q90 of 3.

#### 3.5 K4 VHR: K3 with an own-loudness reference

The same as K3, but an own-voice tick must also be within 6 dB of the
median of the loud shown ticks of the last 60 s (the current tick
included). In the case this hold is for, those ticks are the user's own
close voice.

```js
// state: L = [], R = [] (of { t, x }), Q = [], lastQ = -Infinity, lastNI = -Infinity, holdUntil = -Infinity
L.push(x); if (L.length > 40) L.shift();
const floor = L.length >= 16 ? quantile(L, 0.2) : null;
const marginOK = v && floor !== null && x >= floor + 10;
if (marginOK) R.push({ t, x });                          // before ref: the current tick counts
R = R.filter((e) => e.t >= t - 60000);
const ref = R.length >= 8 ? median(R.map((e) => e.x)) : null;
const own = marginOK && (snap?.verdict === "score" || snap?.verdict === "pause")
  && ref !== null && x >= ref - 6;
if (own) {
  lastQ = t;
  Q = Q.filter((u) => u > t - 5000); Q.push(t);
  holdUntil = Math.max(holdUntil, t + Math.min(5000, 1000 * Q.length));
}
if (rBase !== "idle" && rBase !== "starting") lastNI = t;
return (t - lastNI <= 700 && t - lastQ <= 6000) || t <= holdUntil;
```

- **Parameters (14):** K3's 11, plus the 60000 ms window, at least 8 ticks
  and 6 dB.
- **Expected:** close to K3 on speech. Of the user's own-voice ticks, 12–18 %
  are dropped at quiet floors and 0–3 % at −50 to −40 dBFS. Fewer false
  arms after speech, in the seen proxy: only 31 % (L1) and 69 % (L2) of
  noise ticks that pass K3 also pass the reference.

#### 3.6 K5 QP: hold while the pause stays quieter than the speech before it

This is the user's second example, taken literally. It holds while the
pause's level stays at least 8 dB below the median of the shown voice of
the last 2 s.

```js
// state: lastV = -Infinity, lastSupport = -Infinity, V = [] (of { t, x }), prevQ = false
if (v) { lastV = t; V.push({ t, x }); }
V = V.filter((e) => e.t >= lastV - 2000);
const voiceDb = V.length ? median(V.map((e) => e.x)) : null;
const recent = t - lastV <= SILENCE_HOLD_MS;
const q = !v && recent && voiceDb !== null && x <= voiceDb - 8;
if (q && (h || prevQ)) lastSupport = t;   // shown-voice ticks are never support
prevQ = q;
return recent && t - lastSupport <= 700;
```

How it behaves (the code above decides):
- Support starts on a quiet tick where BASE's own hold is on (h), or on
  the second of two consecutive quiet ticks.
- After a support tick, the next two ticks are covered whatever their
  level (the 700 ms bridge).
- One loud tick inside a pause is fully bridged: the tick after it is
  covered by the bridge, and the one after that is support again (two
  consecutive quiet ticks).
- Two loud ticks in a row release it for at least one tick (the first
  quiet tick after them is not support unless h). It re-engages after two
  consecutive quiet ticks, as long as shown voice was within 5 s. So the
  thumb can vanish and come back within one pause.
- It never holds more than 5 s after the last shown-voice tick.

- **Parameters (6):** bridge 700 ms, recency 5000 ms, window 2000 ms,
  8 dB, clamp −120 dBFS, two consecutive ticks.
- **Expected:** on speech, close to K3. Its noise cost per loud transient
  can reach the whole 5 s, because the room after a horn is ≥ 8 dB below
  the horn.

#### 3.7 Proposals dropped

Three designers proposed nine rules: A, B, C, D1–D3 and N1–N3.

| proposal | kept as | why |
|---|---|---|
| N1 | K1 | Bridge 500 → 700 ms (the same ticks at nominal spacing); digital silence (−Infinity) now counts as quiet; the common preamble (§3.1) replaces its own reset. |
| D1 | K2 | Bridge 500 → 700 ms; every level clamped at −120 dBFS (D1 mapped only non-finite values); the common preamble. |
| D2 | K3 | As D1 → K2; the hold part unchanged. |
| D3 | K4 | As D1 → K2; the reference part unchanged. |
| C | K5 | Grace G 700 ms as proposed; the clamp and the common preamble. |

Dropped:
- **A (unarmed two-tick bridge).**
  - It extends every BASE episode that ends within 5 s of any shown voice.
  - In the seen data, 90–99 % of the noise's BASE episodes that contain
    shown voice end within 750 ms of it. Its designer estimated +4–7 points
    of drawn thumb after speech in talker scenes, against a talker
    allowance of about +3.4–5.7.
  - F9's pure onset-blink bridge is K1, which arms only where the blink
    starts.
- **B (bridge supported by BASE hold ticks ≥ 8 dB below the voice).**
  - Its support set is close to K1's: silence-hold ticks are mostly ≥ 15 dB
    below the voice.
  - Its extra cases, blinks after non-quiet holds, are covered by K2.
  - A third bridge would add a comparison without a new mechanism.
- **N2 (N1, plus a trail kept through "idle" for up to 5 s after shown
  voice).**
  - Its row state equals K1's at every point. Under F8 it could only be
    picked if K1 failed T-QUIET's trail.
  - K2 fills that role with a cost the guards measure.
  - N2's own change is outside every guard: a streak that survives "—" and
    returns beside readings of other voices.
- **N3 (3 s hold after an own-voice tick; margin 8 dB, verdict "score"
  only).**
  - It is the same mechanism as K3, at a fixed length.
  - For one-tick false triggers, the common noise case, it costs about
    2.6 s, against K3's about 0.2 s.
  - For the user's ≥ 4-tick phrases it holds shorter: 3 s against 4–5 s,
    where the seen gaps at −48 dBFS reach q95 3.1–4.2 s.
  - It is expected to be dominated on both T-NOISY and the after-speech
    excess.

### 4. Harness

#### 4.1 The chain: real workers, real hook, shipped strip functions

1. **`chain.mjs`.** The REAL pitch worker with the real FireRedVAD model
   (`build/models/firered`), on 1200-sample chunks at 48 kHz. Beside it, the
   resonance worker's chain is replayed with the gated hint (gate on).
2. **`pause-row.mjs`.** The REAL DSP worker and the REAL `useAudioPipeline`
   hook (voice-gate setting on), per chunk. The hook relays hints, and they
   must equal the runner's hint for hint.
3. **`pause-report.mjs` `stripReplay`.**
   - The hook's per-frame state passes through the 200 ms throttle. A state
     update fires at the first DSP frame ≥ 200 ms after the last one, and
     carries that frame's flags and its `intensity`.
   - The resonance posts apply, together with the 4 Hz tick (t = 350 +
     250 j ms) and a render point every 25 ms.
   - Every arm uses the SHIPPED functions imported from
     `src/components/cueStripModel.js`: the candidate factory, C1's
     `createResonanceHold`, `cueRowStates`, `createTrail`, `dotOpacity`,
     `rowValue`, `axisPos` and `resonanceClamp`. No logic is copied.
   - Per tick each candidate arm calls
     `factory.tick({ pitchVoiced, pitchHolding, pitchLevel, intensity, snap, workerStatus: "ready", hasRef: true }, t)`.
     Render points use the latest tick's flag.
   - **One clock.** Pitch messages' `contextTime`, the chunk ends, the
     ticks and the render grid ((k + 1)·25 ms) are all on the stream's
     sample clock, origin 0 at the stream's first sample.

#### 4.2 Script changes, fixed now

Outputs go under the gitignored `build/resonance-mobile/narrow/`.

- **`pause-row.mjs`**:
  - `--readers=<readers json>` (default: the dev list, as today);
  - a new record field `intenF64`: base64 of a Float64Array with the DSP
    worker's intensity per chunk (NaN where no frame ran; −Infinity kept).
    The existing `inten` is rounded to 0.01 dB and maps −Infinity to −999,
    so a threshold comparison could differ from the app's by 0.005 dB.
  - a kind `"as"` (after speech): y0 = the record's `asBase` f32 instead
    of zeros.
  - `--quiet` (§10, the confirmation rule).

  All existing fields stay as they are.
- **`chain.mjs` `run`** and **`hold-noise-run.mjs`** gain `--quiet`: per
  stream they print only its id, the worker-parity count, the level check
  and the timing (no bins, posts, voiced or shown figures).
- **`pause-report.mjs` `stripReplay`**:
  - carries the throttled `intensity` (from `intenF64`);
  - accepts named candidate arms (`{ name: () => factory }`);
  - gains two information-only timing options, off by default (then the
    output is unchanged): `tickJitterMs` (each tick at 350 + 250 j + δⱼ ms,
    δⱼ uniform on [0, 150), from a mulberry32 stream seeded 20261101; the
    jitter does not accumulate) and `arrival40` (each DSP frame k is
    delivered at ⌈(k + 1)·25 / 40⌉·40 ms, as from 40 ms capture buffers;
    the throttle and the render points run on delivery times, so a burst's
    later frames wait for the next 200 ms firing).

  The existing arms "act", "cf" and "cand" are unchanged.
- **`as-run.mjs`** (new, mirrors `hold-noise-run.mjs`) builds the
  after-speech streams (§4.3) and the G-FT streams (§4.5). It runs the pitch
  pass and `binsPass` with `worker: true`, so the REAL resonance worker
  runs beside the replica and every post is compared. Records have kind
  `"as"`, with `asBase`, `reader`, `tCut`, `tLast` and `cls`. The script is
  resumable and sharded, and has `--quiet`.
- **`ft-clips.mjs`** (new) writes the G-FT talker clips (§4.5).
- **`screen-silero.mjs`** (new) is the noise screen (§6).
- **`narrow-noise-fetch.py`** (new, from `hold-noise-fetch.py`) fetches the
  fresh real-noise set (§5.3) and writes `narrow-noise-list.json`.
- **`librispeech-fetch.py`** (new) fetches the confirmation readers
  (§5.2).
- **`faster-prep.py`** gains `--fill`: per sex, readers are taken in
  numeric id order until n of them pass the existing 54 s / 150 s rule
  (without it, the first n are taken and a skipped one is lost, as today;
  dev is unchanged).
- **`faster-streams.mjs`** gains `--long-only`, which writes the L variant
  only (`resampleClip(long16, 16000, 48000)`, as line 40 today), with no
  WORLD renders.
- **`pause-queue.sh`** gains these environment overrides, with today's
  values as defaults:
  - `FLOORS`, `OUT`, `STREAMS` and `TAG`;
  - `NOISE_ONLY=0`, which skips the noise-only streams;
  - `QUIET=1`, which passes `--quiet` to `chain.mjs`.

  (`FAMS` already exists.)
- **`narrow-report.mjs`** (new) reports the targets, the guards per class,
  level, mode and source, G2–G4, G-FT, the information-only analyses (§7)
  and the selection rule. It writes a summary JSON and tables. Before any
  replay it checks the frozen hashes (§10, step 2).

#### 4.3 After-speech streams (F4 b)

One stream per clip and level: 60 s at 48 kHz.

**Speech segment, one per reader, the same for every clip the reader is
paired with:**
- `long16` is the reader's 150 s 16 kHz stream from `faster-prep.py`: the
  utterances in (chapter, utterance) order, with 0.3 s gaps of exact zeros.
- The gaps are the maximal runs of ≥ 4800 consecutive samples equal to
  0.0. `g` is the start index of each.
- The cut `tCut` is the first gap start at or after 25.0 s, plus 0.15 s
  (the middle of the gap, where the 48 kHz stream is exactly 0).
- If no gap starts within [25.0, 30.0] s, `tCut` = 30.0 s, with a 20 ms
  raised-cosine fade-out ending at 30.0 s, applied at 48 kHz.
- `asBase` = the reader's L stream (`resampleClip(long16, 16000, 48000)`),
  samples [0, round(tCut·48000)), zero-padded to 60 s (2 880 000 samples).
  It is written once per reader.

**Mixing.** `pert = [{ type: "level", dbfs: −32 }, …clipPert(clip, L)]`:
- The speech is scaled to −32 dBFS active level. This is `perturb.mjs`'s
  measure, on the 16 kHz band; zero frames are never active.
- The clip's noise is then added exactly as in the cold-start stream
  (`hold-noise-run.mjs` `clipPert`):
  - `resampleClip` to 48 kHz, from the clip's start;
  - a 50 Hz high-pass (one 12 dB/oct section);
  - scaled so that the median of the DSP worker's 50 ms intensity, over the
    noise alone, is L.
- The noise runs throughout the 60 s, under the speech and after it.

**The reader's last voiced frame.**
- The speech-alone stream (`applyPert([{ type: "level", dbfs: −32 }], asBase)`,
  no noise) goes through the same real pitch worker with FireRedVAD.
- `tLast` = the `contextTime` of the last pitch message posted voiced
  (`voiced` true, i.e. pitch ≠ null).
- This keeps it independent of the noise: false voicing in the noise after
  the speech cannot move it.

**Counting window.**
- Render points with time (k + 1)·25 ms ≥ (tLast + 6.0) s, to the end of
  the stream.
- With tCut ≤ 30.15 s, that leaves at least about 23.9 s per stream.
- The first ~5 s after the last word are the intended hold, not a cost.
- **Predicted leak.** The display lags the last word (pitch decode, the
  400 ms pitch hold, the 200 ms throttle, the tick), so the user's own
  arming can reach into the window: K1–K4 by up to about 0.7 s (their
  arming windows plus the 700 ms bridge), C1 and K5 by up to about 0.15 s.
  It can only extend an episode BASE itself shows. It is counted, as F4
  says; §7 reports a tLast + 7 s window as information, so a per-clip
  failure can be checked against it.

**Pairing.**
- The clips are sorted by (metadata family: speech-free = 0, talker = 1;
  then the clip id, compared as JavaScript strings with `<`). Clip i gets
  reader `R[i mod 12]`, with R = [m1, f1, m2, f2, …, m6, f6] (each sex by
  numeric speaker id).
- The same pairing is used at both levels.
- Dev clips go with the dev readers, fresh clips with the confirmation
  readers.
- The full pairing table (clip, level, reader, tCut, tLast) is committed:
  for dev in the freeze commit (§10, step 2), for the fresh set with
  `narrow-noise-list.json` (§10, step 4).

**Reported.**
- How many streams had a resonance position when the speech ended:
  - the post in force at the render point containing tCut has u ≠ null;
  - also the count with fill = 1.

  Both are given per level and class.
- tCut and tLast per reader, and whether the fade-out rule applied.

#### 4.4 Harness checks (must hold before any result is used)

- **Dev hook records regenerated with `intenF64`.** Every pre-existing field
  must be byte-identical to the existing records, for all 156 speech and
  314 cold-start noise records.
- **The extended `stripReplay` reproduces the earlier round.** On the
  regenerated records it reproduces exactly:
  - the C1 round's BASE and C1 rows: the T1 / T2 table, the G1 table and
    the G2–G4 counts;
  - `hold-report.mjs` output, line for line.

  These are replays of BASE and C1 only (already seen).
- **Real worker = replica.** Every after-speech and G-FT stream's
  resonance replica equals the real worker on every post.
- **Hints and levels.**
  - The hook's relayed hints equal the runner's: 100 %.
  - Every rebuilt stream reproduces the runner's active level.
- **Unit tests** for every factory (§10, step 2), and for the wiring once a
  candidate is wired.
- **Frozen code.** Every replay of a K arm first checks the sha256 of each
  factory's `toString()`, of `pause-report.mjs` and of `narrow-report.mjs`
  against the freeze record (§10, step 2). A mismatch stops the run; any
  change after the freeze is a reported deviation.

#### 4.5 G-FT streams: a foreground talker (dev only)

Dev's talker scenes are all DEMAND (distant babble), while the fresh
talker class (§5.3) adds close voices: TV or radio, people nearby, a meeting.
To keep dev from picking a hold that only survives distant babble, one
stricter dev requirement is added (§9, G-FT). It never makes a candidate
eligible that F8 alone would not.

- **Talkers.** Six LibriSpeech dev-clean readers that are not dev readers:
  the next 3 men and 3 women by numeric id after the 12 — men 2078, 2086,
  2428; women 2035, 2277, 2412. (dev-clean was used for resonance tuning;
  here the readers are only background voices.)
- **Clips.** `faster-prep.py --split=dev-clean --tag=ft --n=9 --fill` into
  `build/resonance-mobile/narrow/ft-prep/` (the first 9 per sex that pass
  the 54 s / 150 s rule; the 12 dev readers' files there are not used; if
  one of the six is skipped, the next reader of that sex by id takes its
  place). From each talker's 150 s `long16`,
  two clips: [0, 60) s and [60, 120) s, ids `ft__<spk>__0` and
  `ft__<spk>__1`, written by `ft-clips.mjs` as mono PCM16 WAV at 16 kHz.
  Twelve clips, all talker by construction (no screen).
- **Streams.** Exactly as the real-noise clips: cold start (`clipPert`,
  60 s of the talker alone) and after speech (§4.3, paired by clip id with
  the dev readers, R[i mod 12]), at L1 and L2. The level rule is
  `clipPert`'s: the median 50 ms DSP intensity of the talker alone is L.
  The 0.3 s exact-zero gaps between the talker's utterances stay (a quiet
  room between phrases).
- **Judged** with the talker-class bars of §9, at L1 and L2, cold start and
  after speech, on these 12 clips alone. Not pooled with the real-noise
  clips and not part of the tie-break. Not run on confirmation data: there
  the fresh talker class covers this case with real recordings.

### 5. Data

#### 5.1 Dev: existing data, declared seen

Both dev sets were already seen in the C1 round.

- **Speech.** The 12 LibriSpeech dev-clean readers (the first 6 men and 6
  women by speaker id: men 174, 251, 422, 652, 777, 1272; women 84, 1462,
  1673, 1919, 1988, 1993), each reader's 150 s stream at −32 dBFS active,
  from 20 to 150 s. There are 13 conditions:
  - none;
  - brown and pink at pause floors −55 / −50 / −48 / −40 dBFS;
  - the real air-conditioner clip `tests/dsp/data/notch-real/ac114.wav`
    (MS-SNSD, CC0) at the same four floors.

  The chain and hook records are under `build/resonance-mobile/pause/`. The
  hook records are regenerated with `intenF64` (§4.4).
- **Real noise.** The 157-clip set: 85 DEMAND + 72 Freesound clips,
  `scripts/resonance/mobile/hold-noise-list.json`, at L1 −48 and
  L2 −40 dBFS. The cold-start records are under `build/resonance-mobile/hold/`.
  The after-speech streams of dev clips are new runs (§4.3), on seen data.
- **G-FT** (§4.5): new streams of dev-clean readers not used in this display
  work.

**Seen results** (in the two earlier notes):
- the BASE and C1 speech tables;
- G1 per class and source;
- C1's fixed-position after-speech replay;
- the diagnosis's dose-response and counterfactual.

**Seen descriptive statistics** of existing BASE records, computed by the
three designers. No candidate rule was replayed, but the candidates'
ingredients were compared on dev BASE ticks:
- **Arming predicate (K2–K4).** The share of 1–5 s pauses with qualifying
  shown ticks before them, the gap from the last qualifying tick to the
  pause end + 0.25 s (which is K3's hold coverage, i.e. close to its
  T-QUIET / T-NOISY outcome), and false clusters a minute in noise (its
  noise cost), for:
  - margin M 4 / 6 / 8 / 10 / 12 / 15 dB over the floor (stats.mjs), 6 / 8 /
    10 / 12 (stats2), 6 / 8 / 10 with and without verdict "score" only
    (stats3), 10 and 12 with verdict "score" or "pause" ("+sp"), and 10
    with a voicedS change over 1 s ("+dvs") (stats3b);
  - the floor as q20 of the last 10 s against q10 of the last 20 s
    (stats-f20_10.md / stats-f10_20.md);
  - qualifying ticks in the 5 s before a pause, per condition (stats6:
    K3's 1000 ms per tick and 5 s cap);
  - the loudness reference at −6 against −3 dB (stats7: K4).
- **Bridge coverage (K1, K2).** Tick-level idle runs (95 % one tick, 99 %
  ≤ 2), the share of quiet idle entries entered from a quiet hold and
  ending voiced within 2 ticks (design-mechanism desc / desc3,
  design-experience desc2 / desc3), and the share of pause windows whose
  idle runs are only ≤ 2-tick runs ending live (stats4, stats5). This is
  close to K2's T-QUIET thumb result.
- **K5.** Level steps at idle entries and how often noise frames fall
  ≥ 5 / 7 / 8 / 10 dB below the clip median (design-mechanism desc2); BASE
  episode ends after shown voice (desc4).

So K1's and K2's 700 ms bridge, and K2–K4's margin, floor, verdict set,
arming time, hold scale and reference, and K5's 8 dB, were chosen with these
dev figures in view. **Dev results for K1–K5 are in-sample.** Only the
fresh confirmation is an unbiased test.

**Where the evidence is kept.** The scripts and outputs were in the
session scratchpad `…/scratchpad/narrow/design-*/`, which is wiped after
about a day. stats4–stats7 had printed to the console only; on 2026-11-01
they were re-run unchanged (descriptive, BASE records only) with their
output written to `stats4-out.md` … `stats7-out.md`. All three folders,
with `ticks.json` (feat.mjs's BASE tick features, the input of every stats
script), are copied to a local folder outside the repo (`seen/`; not
published). Its `MANIFEST.sha256` (36 files; Appendix A) has sha256
`9970da018fb5528c13db0d04653f758f18d8baa3b4c840d02620974d41b8c568`.

Their throttle replay reproduced the C1 note's BASE pause figures exactly.
The figures this plan leans on:
- **Quiet idle runs** (none and −55 dBFS floors), at tick level:
  - 95 % are one tick and 99 % are ≤ 2 ticks;
  - 88–91 % are entered straight from the hook's silence hold;
  - the rest follow a non-quiet hold or are short flicks inside the pause.
  - In 8.7–16.8 % of the 1–5 s pause windows there is an idle run that is
    not a ≤ 2-tick run ending live (q50 1 tick, at most 3; starting
    0.3–1.7 s into the pause).
- **1–5 s pauses** (186 per condition): 1.05 / 1.30 / 1.55 s (q10 / q50 /
  q90), with a maximum of 1.90 s. None lasts 2 s or longer.
- **Levels.** Shown voice is at about −36 dBFS. Pause q90 by condition:

  | condition | pause q90 (dBFS) |
  |---|---|
  | none | −54.7 |
  | −55 | −51.4 … −51.8 |
  | −50 | −47.3 … −48.6 |
  | −48 | −45.5 … −47.0 |
  | −40 | −37.9 … −39.3 |
- **Shown-voice ticks over a running floor** (q20 of the last 40 ticks),
  median: +20.5 (none), +15.4 (−55), +11.5 (−50), +9.8 (−48) and +4.7 dB
  (−40). Noise in talker-like DEMAND scenes: q90 +6.0 … +6.6 dB. Machine
  noise: q90 +12.3 … +23.2 dB.
- **Own-voice ticks in the 5 s before a pause** (≥ floor + 10 dB, verdict
  "score" or "pause"), median: 9–11 (quiet), 8–9 (−50), 7–8 (−48) and 1–2
  (−40). In noise there are 0.07 / 0.10 clusters a minute (L1 / L2), with a
  median of 1 tick and q90 of 3.
- **Verdict "score" at shown ticks:** 86–98 % on speech, 60–61 % on talker
  noise, 40–52 % on machine noise.
- **BASE in noise** (the dev clips at both levels):
  - BASE episodes that contain shown voice end 425 ms (q50) after the last
    shown voice, 90–99 % within 750 ms;
  - at L1, the hook's silence-hold path runs about 10.5 episodes a minute.

**Not computed on dev before this commit:**
- any K-candidate replay;
- the real-chain after-speech streams (none existed);
- the G-FT streams;
- the noise screen.

#### 5.2 Confirmation readers: fresh

LibriSpeech **train-clean-100** (OpenSLR SLR12, CC BY 4.0), the first 6 men
and 6 women by numeric speaker id that pass `faster-prep.py`'s 54 s / 150 s
rule, sex from `SPEAKERS.TXT`. Expected (all have about 25 min):
- **men:** 26, 27, 60, 78, 118, 163;
- **women:** 19, 32, 39, 40, 83, 87.

The ids were read from the local `SPEAKERS.TXT` while planning; no audio of
these readers has been read. The 12 used ids are listed in the commit of
step 4 (§10).

**Why this split** (`measurements/` and `scripts/` checked on 2026-11-01):
- **dev-clean (all 40 readers)** is used throughout:
  - the resonance lab's only training pool, for vtln
    (resonance-lab-benchmark-2026-10-04.md);
  - resonance-faster tuning (first 10 + 10);
  - start-reference confirmation (all 40);
  - the CPU check;
  - this display work (first 6 + 6, and G-FT's next 3 + 3).
- **test-clean (all 40 readers)** is used too:
  - the lab's reference bands and r1 set;
  - start-reference primary;
  - switch-asymmetry held-out;
  - the cue-strip smoke of this display work (readers 121 and 61).
- **test-other** (first 10 + 10) was resonance-faster confirmation.
- **dev-other** and **train-clean-360** were used by the heard-as studies.
- **train-clean-100** appears nowhere as data. Its only mention is as
  "LibriSpeech-clean-100", a third-party gender model's fine-tuning set, in
  alt-gender-models-investigation-2026-05-05.md.
- LibriSpeech splits share no speakers.
- train-clean-100 is the same "clean" recording pool as dev.
- **A known unknown.** FireRedVAD (in the chain on every speech stream)
  does not disclose its training data: its README and paper abstract
  (arXiv 2603.10420, checked 2026-11-01) name only an evaluation set, and
  firered-confirmation-2026-10-21.md records it as undisclosed ("thousands
  of hours of human-annotated" speech). It may include LibriSpeech splits,
  dev or train. If it does, the voice gate could hear one set's readers
  more reliably than the other's. This changes no bar.

**Fetch** (`librispeech-fetch.py`, Python `-I`):
- `https://www.openslr.org/resources/12/train-clean-100.tar.gz` (6.39 GB;
  mirror openslr.elda.org), one connection, a token bucket at 60 MB/s,
  downloaded in full to
  `../Syrinx-cache/resonance-lab/data/train-clean-100.tar.gz`;
- its MD5 checked against the same folder's `md5sum.txt` **before any
  member is extracted**; a mismatch deletes the download and stops;
- extracted in one pass, only `LibriSpeech/train-clean-100/<id>/` for the
  first 8 readers of each sex — men 26, 27, 60, 78, 118, 163, 196, 201;
  women 19, 32, 39, 40, 83, 87, 89, 103 — into
  `../Syrinx-cache/resonance-lab/data/LibriSpeech/`
  (outside the repo);
- the archive is kept until the 12 readers are fixed. If fewer than 6 of a
  sex's 8 pass the 54 s / 150 s rule, that sex's next readers by id are
  extracted from it, one at a time, until 6 pass.

**Streams:**
- `faster-prep.py --split=train-clean-100 --tag=conf --n=6 --fill`;
- then `faster-streams.mjs --tag=conf --long-only`;
- then the 13 conditions of §5.1, built exactly as dev: `pause-queue.sh`
  with `FAMS="brown pink ac"`, `FLOORS="-55 -50 -48 -40"`, `NOISE_ONLY=0`,
  `QUIET=1`, seed 20261028, `--worker` at −50 and −48 (as dev). The AC
  clip's loop offset is seeded per reader (`pause-noise.mjs`: seed 20261028
  plus a hash of `"file|" + reader`), so every reader gets its own offset,
  the same at every floor.

#### 5.3 Confirmation real noise: fresh

At least 100 clips of 60 s, under
`../Syrinx-cache/noise-real-narrow/` (outside the repo). The
committed list holds per clip the id, URL, licence, sha256 of the download
and of the clip, uploader, subclass and query; and per cached search page
its URL, sha256 and fetch time.

**How the composition was chosen.** It was fixed after the C1 round's per
class results were known. To keep the fresh set from being easier than dev
on the classes where C1 failed, the speech-free family contains every dev
Freesound machine class with the dev queries, order and caps, and its
filters are dev's. New subclasses are added beside them at smaller caps.
The talker family is new: dev's talker scenes are all DEMAND (distant
babble), while the fresh ones are mostly Freesound TV / radio, people
talking, parties and cafés, with closer and louder voices. Dev therefore
says little about the talker bars on confirmation; G-FT (§4.5) is the dev
proxy.

**Sources**
- **DEMAND OMEETING**, 5 clips. Zenodo 1227121: CC BY 4.0 by the record,
  CC BY-SA 3.0 by DEMAND.pdf.
  - It is the one DEMAND environment not in dev ("a meeting room while the
    microphone array is discussed").
  - Channel 1, 48 kHz, five consecutive 60 s clips of the 300 s recording,
    read by HTTP range as in dev.
  - Metadata family: talker ("people nearby").
- **Freesound HQ previews** (Vorbis), from search pages.
  - **URL**, pinned: `https://freesound.org/search/?` +
    `urlencode([("q", q), ("f", "duration:[60 TO 900]"), ("s", "Automatic by relevance"), ("g", "1")])`,
    plus `&page=N` for N ≥ 2. (Dev's builder had no `s` and `g`: these are
    the site's defaults, which dev's cached pages show. On 2026-11-01 one
    query, "room tone", was fetched with these parameters, pages 1 and 2,
    and with `s` / `g` changed: the site honours both. Those test pages
    were not kept.)
  - **Pin check.** Each fetched page must show "Automatic by relevance"
    selected and the group-by-pack box checked. If one does not, STOP
    before confirmation (reported).
  - Pages are cached at their first fetch (key: query and page) and
    reused.

**Metadata speech-free family (102)**, in this order. The first six are
dev's Freesound classes, with dev's queries, order and caps:

| subclass | cap | queries, in order |
|---|---|---|
| fans / PC / coil whine | 14 | "computer fan noise", "pc fan", "desk fan", "box fan", "laptop fan", "coil whine", "server room" |
| HVAC | 14 | "air conditioner", "hvac", "ventilation", "air handler", "heat pump", "furnace" |
| fridge / freezer | 12 | "refrigerator hum", "fridge", "freezer hum" |
| mains hum / transformer / ballast | 14 | "electrical hum", "mains hum", "transformer hum", "fluorescent light hum", "ballast buzz" |
| washing machine / kitchen appliance | 10 | "washing machine", "dishwasher", "tumble dryer", "kitchen extractor", "microwave running" |
| traffic | 8 | "traffic", "road traffic distant", "city traffic" |
| room and home appliances | 8 | "room tone", "air purifier", "dehumidifier", "space heater", "electric fan", "ceiling fan", "humidifier" |
| household machines | 6 | "vacuum cleaner", "hair dryer", "clothes dryer", "dishwasher running", "boiler room", "water heater" |
| rain, wind, water | 6 | "rain on window", "rain on roof", "heavy rain", "wind howling", "stream water", "fountain" |
| vehicle interior | 5 | "car interior", "driving car interior", "train interior", "airplane cabin", "bus interior" |
| distant street and road | 5 | "distant traffic", "highway", "city ambience night", "road noise", "motorway" |

**Metadata talker family (56 + OMEETING 5)**, after the speech-free
family:

| subclass | cap | queries, in order |
|---|---|---|
| café, restaurant, bar | 16 | "cafe ambience", "restaurant ambience", "coffee shop ambience", "bar ambience", "pub ambience", "food court" |
| station, airport, mall | 14 | "train station ambience", "airport terminal", "shopping mall ambience", "subway station", "hotel lobby", "bus station" |
| TV or radio in the room | 12 | "tv in background", "television background", "tv in another room", "radio in background", "radio talk show", "news broadcast tv" |
| people nearby | 14 | "people talking", "office ambience", "classroom ambience", "party ambience", "conversation background", "waiting room" |

**Selection, per subclass:** its queries in order; for each query its
pages 1, 2, 3 in order; each page's results in the page's order; until the
subclass cap.

**Filters, in `hold-noise-fetch.py`'s order** (one sound, one query):
1. On the search card: skip a sound already accepted, one with no preview
   URL, or a card duration under 60 s.
2. Dev-disjoint: skip a sound whose id is in the dev list, or whose
   uploader uploaded any of the dev list's 72 Freesound clips.
3. Speech-free family only: skip a sound with a voice word (the dev word
   rule as fixed on 2026-11-01, `voice_hits`: stems with English endings
   and irregular forms) in the card's title or tags.
4. Skip a sound whose uploader already has 2 accepted sounds in the fresh
   set.
5. Licence, read on the sound's own page: CC0 1.0, or CC BY (3.0 or 4.0);
   anything else is skipped (no NC, ND or Sampling+; Freesound offers no
   CC BY-SA).
6. Speech-free family only: skip a sound with a voice word in the page's
   tags.
7. Download the HQ preview and decode it; skip it if it fails or is under
   60 s. The first 60 s of channel 1 are used.

A sound passing all seven is accepted: its id is marked accepted and its
uploader's count goes up. **A rejected sound is not marked**: a later query
or subclass checks it again under its own rules (dev behaviour). So a sound
dropped from a speech-free subclass for a voice word can be accepted in a
talker subclass.

**Data-quality marks (information only).** The words synth, synthesizer,
synthesiser, synthesized, synthetic, glitch, remix, game and designed (the
same stem-and-ending matching) are looked for in every accepted Freesound
sound's title and page tags, and in the dev list's, and stored as
`qualityMark`. They select nothing. §7 reports the guards without the
marked clips as information, as the C1 round handled its word-rule misses.

**Size rule.** The total must reach ≥ 100 clips and each final class (§6)
≥ 30 clips. All of this is settled before any confirmation replay.
1. **Base fetch:** as above (pages 1–3), then the screen.
2. **Extension 1.** The short families are the metadata family of each
   final class under 30; if the total is under 100 and neither class is,
   both families. Each short family's subclass caps are raised by 50 %
   (rounded up) and its selection is redone from the start, with pages 1–5
   per query, in the same order. Sounds and uploader slots taken by a
   family that is not redone stay taken. New clips are screened.
3. **Extension 2**, if still short: the short family's reserve subclass,
   cap 20, queries in order, pages 1–5, after its other subclasses:
   - speech-free reserve: "white noise machine", "aquarium filter",
     "air compressor", "generator hum", "engine idle", "printer";
   - talker reserve: "crowd talking", "market ambience", "lecture hall",
     "conference room ambience", "library ambience", "playground".

   New clips are screened.
4. **Terminal.** If the total is still under 100 or a final class under
   30: STOP before confirmation, reported. No confirmation replay, and
   `CueStrip.jsx` stays as on `resonance-mobile`.

The licence rule, the per-uploader cap, the dev exclusions, the
accepted-once rule and the speech-free word rule apply in every step,
reserves included.

#### 5.4 Levels

Every noise set uses the same two levels:
- **L1 −48 dBFS** and **L2 −40 dBFS**: the median 50 ms DSP intensity of
  the noise alone, after the 50 Hz high-pass (`clipPert`);
- **cold start:** 60 s of noise alone, from 0 s;
- **after speech:** §4.3.

### 6. The noise screen (F5)

It is independent of the app's own detector (FireRedVAD).

- **Model.** Silero VAD v6.2.3, the repo's speech-detector model. It comes
  from the pinned URL `SPEECH_DETECTOR.modelUrl` and is checked against
  `modelSha256`, then stored in
  `../Syrinx-cache/models/silero/`.
- **Run offline** through `scripts/heard-as/chain.mjs` `loadSpeechDetector`:
  onnxruntime-web WASM, 1 thread, `createSpeechFramer` +
  `createSileroRunner`, fresh state per clip.
- **Input.** The clip's L2 cold-start stream (`clipPert(clip, −40)`, 48 kHz),
  through the app's `createStreamingResampler` (48 → 16 kHz) in 1200-sample
  chunks, as the gender worker feeds it.
- **Frame rule:** speech when p ≥ 0.5 (one probability per 32 ms).
- **Speech runs:** maximal runs of ≥ 8 consecutive speech frames (≥ 256 ms).
  S is the total length of the speech runs, in seconds.
- **Class:**
  - **talker** if S ≥ 1.0 s, or if the clip's metadata family is talker
    and S ≥ 0.256 s (at least one run);
  - **speech-free** otherwise.

  So a metadata-talker clip in which the screen hears no speech is judged
  by the stricter speech-free bars. A machine recording in which it hears
  speech (an announcement, a TV in the room) is a talker scene.
- **Metadata talker:**
  - **Dev:** the 11 DEMAND environments whose DEMAND.pdf description has
    people in it: PCAFETER, PRESTO, PSTATION, SPSQUARE, SCAFE, TMETRO, TBUS,
    NPARK, NFIELD, OOFFICE and OHALLWAY (55 clips). Every other dev clip is
    metadata speech-free.
  - **Fresh:** the four talker subclasses, the talker reserve and OMEETING.
- **Where the classes are kept.** The screen runs on all dev and fresh
  clips (not on G-FT, talker by construction). Per clip, S, the runs and
  the class go into a committed `narrow-screen.json`: for dev in the freeze
  commit, before any K replay (§10, step 2); for the fresh set before any
  confirmation replay (§10, step 4).

### 7. Metrics

As in the C1 round, on the app replay (§4.1). Time shares are taken on the
25 ms render grid, trail metrics at the ticks.

- **Thumb drawn:** `dotOpacity(state) !== null` and u ≠ null.
- **Not idle:** the state is neither "idle" nor "starting".
- **"Keep talking…":** the state is "warming".
- **Speech, per condition, pooled over the 12 readers** (window 20–150 s):
  - mean resonance trail: points at every tick, Σ points / Σ ticks;
  - the share of 1–5 s pauses in which the thumb disappears.
  - **Pauses, exactly as `pause-report.mjs` at 7e00e59.** `pausesFromClean`
    on the condition-free ("none") run's posted pitch messages: maximal
    runs of ≥ 12 consecutive chunks in which every posted message is
    unvoiced (a chunk with no message continues a run but does not start
    one), giving chunks [a, b]. `pauseMetrics`: a pause counts if
    a ≥ kFrom = 799 (20 s) and b + 10 < n. Its length is
    d = (b − a + 1)·25 ms; the 1–5 s class is 40 ≤ b − a + 1 < 200 chunks
    (under 40: the 0.3–1 s class; 200 or more: ≥ 5 s). The thumb is gone
    in a pause if any render point k in [a, b + 10] (start to end +
    250 ms) has no thumb.
  - Also reported: row idle %, trail clears a minute, ticks with a drawable
    streak (448×890 and 360×690), 0.3–1 s pauses, per sex, and the streak
    span (the age of the oldest trail point at ticks with a full trail and
    at ticks with ≥ 2 points).
- **Noise, per level, per mode** (cold start = the whole 60 s; after speech
  = the counting window of §4.3), **per class (§6)**:
  - drawn %, not idle % and "keep talking…" %, pooled (render-point
    weighted);
  - **per clip excess:** (candidate drawn %) − (the same clip's BASE
    drawn %), both in that clip's own window (cold start: 0–60 s; after
    speech: its §4.3 window), unrounded.

  The same figures are also given per source (DEMAND / Freesound), per
  metadata subclass, and pooled over both classes.
- **Tie-break measure** (§10): the pooled after-speech drawn excess. It is
  the mean, over L1 and L2, of (candidate − BASE pooled drawn %) over all
  dev real-noise clips of both classes, in the after-speech window (G-FT
  clips not included). Two values are equal when |a − b| < 0.005 points,
  on unrounded values.
- **Information only (no bar):**
  - guards restricted to the after-speech streams with u ≠ null at tCut;
  - the per-clip after-speech excess with the window from tLast + 7 s;
  - the guards without the clips with a `qualityMark` (dev and fresh);
  - per condition / class and arm, the share of held render points (where
    BASE is idle and the arm's flag is on) in "sustained" ("needs running
    speech");
  - on dev speech, BASE and the pick with `tickJitterMs` and with
    `arrival40` (§4.2): T-QUIET and T-NOISY beside the nominal figures;
  - G4 on the noise streams.

### 8. Targets (F7)

- **T-QUIET (required).** Each of the 4 quiet conditions (none, brown −55,
  pink −55, AC −55) must have:
  - a mean resonance trail ≥ 10 points, and
  - the thumb gone in ≤ 5 % of 1–5 s pauses, pooled over the readers. The
    window runs from the pause's start to its end + 250 ms, so the onset
    blink counts (§7).
- **T-NOISY (graded, for selection).** The same two at each of the 9
  noisier conditions (−50 / −48 / −40 × brown / pink / AC). The score is the
  number of those conditions where both hold, 0 to 9.

### 9. Guards (F6)

Every guard is evaluated at L1 and at L2, from a cold start and after
speech: eight (level, mode, class) cells, all binding. In the **pooled**
bars, BASE is the pooled BASE value of the same measure in the same cell.
In the **per-clip** bar, BASE is the same clip's own BASE value (§7).

- **Speech-free class:**
  - drawn-thumb time ≤ BASE + 1.0 point, pooled;
  - not idle ≤ BASE + 2.0 points, pooled;
  - no single clip > BASE + 15 points drawn: a clip fails if its per-clip
    excess (§7) is > 15.00 points.
- **Talker class:**
  - drawn ≤ BASE + max(1.0, 0.25 × BASE), pooled;
  - not idle ≤ BASE + max(2.0, 0.25 × BASE), pooled;
  - no single clip > BASE + 15 drawn: a clip fails if its per-clip excess
    is > 15.00 points.
- **Both classes:** "keep talking…" time ≤ BASE + 0.5, pooled within each
  class.
- **G-FT (dev only; stricter than F8, §4.5).** The talker-class bars above,
  at L1 and L2, cold start and after speech, on the 12 G-FT clips.
- **G2.** The thumb's u is identical wherever both arms draw, on speech and
  noise.
- **G3.** The pitch row's state is identical at every tick and render point.
- **G4.** On speech, a candidate differs from BASE only where BASE's
  resonance state is "idle". The trail is meant to differ. For the noise
  streams G4 is reported as information.
- **G5.** These pass:
  - `npm run lint`, `npm run test:unit`, `npm run build`;
  - the cue-strip tests: `tests/audio/cue-strip-model-test.js`,
    `cue-meter-geometry-test.js`, `voice-gate-display-test.js`,
    `cue-strip-wiring-test.js`;
  - `scripts/cue-strip-smoke.mjs` at phone, p402, p360 and desktop;
  - `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`.

  On dev, G5 runs on the committed tree (factories only) and on the wired
  working copy (§10, step 3).

### 10. Selection and confirmation (F8), and the order of work

**The rule:**
- **Dev selection.** A candidate is eligible if it passes T-QUIET, every
  guard on dev (§9, G5 included) and G-FT. Pick the highest T-NOISY score.
  On a tie, the smallest pooled after-speech drawn-thumb excess over BASE
  (§7). On a further tie, the fewest parameters. If none is eligible, STOP
  before confirmation.
- **Confirmation.** The picked candidate must pass T-QUIET and every guard
  on the fresh data. T-NOISY is reported, not a bar.
  - **PASS:** it replaces C1 in `CueStrip.jsx` on this branch.
  - **FAIL:** STOP. No second pick and no tuning. `CueStrip.jsx` stays as on
    `resonance-mobile`.

**What the rule means.**
- A hold candidate (K3–K5) that passes dev outranks the bridges on
  T-NOISY. If it then fails confirmation, the round ends with no change,
  even if a bridge would have confirmed.
- The fresh talker class holds closer voices than dev's (§5.3). G-FT makes
  dev test them too, but a hold that passes G-FT can still fail the fresh
  talker bars. A FAIL there should be read as "the hold costs too much
  where other people talk", not as noise in the test.
- K1 may miss T-QUIET (§3.2). If K1 fails T-QUIET and the picked hold
  fails confirmation, the round ends with no change.
- Dev results are in-sample (§5.1); only confirmation is unbiased.

**Order of work:**
1. **This plan** is committed and pushed alone.
2. **Dev preparation and freeze** (no K replay on any data):
   - Add the five factories to `cueStripModel.js`, with unit tests:
     - a literal transcription test of each §3 code block on fixed tick
       sequences (expected flags written by hand from the code);
     - each arming condition alone failing;
     - the exact tick boundaries (bridge at +250 / +500 and not +750; holds
       at their length and not one tick later);
     - the reset on null intensity, and no update while the worker is not
       ready;
     - never "warming";
     - the pitch row unchanged;
     - a property test on random tick sequences: the state differs from
       BASE only where BASE is idle.

     `CueStrip.jsx`, `App.jsx` and `CombinedDashboard.jsx` stay unchanged.
     `npm run lint`, `npm run test:unit` and `npm run build` must pass with
     all five factories in the module.
   - Make the harness changes (§4.2) and run the checks of §4.4 (BASE and
     C1 replays only).
   - Run the noise screen on the dev clips.
   - Build the dev after-speech streams and the G-FT streams (chain, real
     worker, hook).
   - **Freeze commit, pushed before any K replay:** the factories and their
     tests, `narrow-report.mjs`, the extended `pause-report.mjs` and the
     other scripts, the dev `narrow-screen.json`, and the dev pairing table
     (§4.3). The note gains a "Freeze" section (the plan section above is
     not edited) with the sha256 of each factory's `toString()` (Node 24),
     of `pause-report.mjs` and of `narrow-report.mjs`. Every later replay
     checks them (§4.4).
3. **Dev replay and pick.**
   - Replay BASE, C1 and K1–K5 on dev speech, cold start and after speech,
     and G-FT. Order the candidates that pass T-QUIET, the guards, G2–G4
     and G-FT by the rule.
   - **G5 on the first of them**, wired into an uncommitted working copy:
     `CueStrip.jsx` (§3.1's pattern), `App.jsx` / `CombinedDashboard.jsx`
     (the `intensity` prop), and `tests/audio/cue-strip-wiring-test.js`
     updated with step 6's assertions. The working copy's sha256 (each of
     those four files) is reported. lint, test:unit and build run on the
     committed tree and on the working copy.
     - **Objective test for a G5 failure.** Re-run the failing check with
       the same working copy but the factory replaced by a stub
       `{ tick: () => false }`. If it still fails, the failure is the
       wiring's: fix the wiring (the factory's `toString()` hash must stay
       the frozen one), report it as a deviation and re-run with the
       candidate. If the wiring cannot be fixed without changing a factory,
       STOP (reported). If the stub passes, the failure is the rule's: the
       candidate is not eligible and the next one is tried.
   - The dev results are committed and pushed, naming the pick, or STOP.
4. **Confirmation data.** Fetch the readers and the fresh noise (this may
   start any time after step 1). Run the screen and the size rule (§5.3),
   then commit and push `narrow-noise-list.json`, the fresh
   `narrow-screen.json`, the fresh pairing table and the 12 reader ids.
   - **Quiet rule.** The chain and hook runs on confirmation data may
     happen before step 3's push, but every one runs with `--quiet` /
     `QUIET=1`, and no voiced, shown, idle or drawn figure of confirmation
     data is printed, computed or looked at until both the dev pick and
     this list are pushed. Only integrity checks are printed and stored:
     hint equality, worker = replica, the level checks, timing.
   - No arm (BASE, C1 or the pick) is replayed on confirmation data before
     both pushes.
5. **Confirmation.** Replay BASE, C1 (reference) and the pick only, then
   apply the verdict. Other candidates are never replayed on confirmation
   data.
6. **PASS.**
   - Wire the pick:
     - `CueStrip.jsx`: `latest.current` gains `intensity`, the tick calls
       the pick's factory in place of C1 (§3.1), and the info text changes
       (§11);
     - `App.jsx` and `CombinedDashboard.jsx` pass `intensity`.
   - Update `tests/audio/cue-strip-wiring-test.js`. It must check that the
     tick creates the pick's factory beside its trails, feeds it the gated
     flags, `intensity`, the snapshot, the worker status and the clock,
     passes its answer to its own `cueRowStates` call and keeps it in the
     view, that the render uses `view.resonanceHold`, that `App` /
     `CombinedDashboard` pass `intensity`, and that `useAudioPipeline.js`
     is unchanged from 7e00e59.
   - Re-run G5 with the final text, update the CLAUDE.md rows, then commit
     and push.
   - **G5 after PASS.** If only the info popover's fit or text checks
     fail, the wording may be shortened with every number unchanged,
     reported as a deviation. Any other G5 failure is a FAIL: STOP, and
     `CueStrip.jsx` stays as on `resonance-mobile`.

   **FAIL:** STOP. The note is updated; `CueStrip.jsx` is unchanged (C1
   stays wired, as on `resonance-mobile`); commit and push.

### 11. Info text (only on PASS)

- **The streak sentence** in `RESONANCE_INFO` states N: the measured span
  of the shipped candidate on the confirmation's clean speech ("none"). N
  is the median age of the oldest trail point at ticks with a full
  15-point trail, rounded to the nearest 5 s. A tie goes toward the median
  over ticks with ≥ 2 points. The sentence keeps "starts over after about
  5 s without speech".
- **The noisy-room clause.** If the candidate's thumb is gone in > 5 % of
  1–5 s pauses at any of the 9 noisier conditions on the confirmation
  speech, the sentence adds a clause saying the streak can start over
  sooner in such a room.
  - It states T: the median, over those conditions' 1–5 s pauses in which
    the trail cleared, of the time from the pause's start to the first tick
    with an empty trail, rounded to 0.5 s.
  - The words are chosen at the result stage and the numbers are as
    measured. The sentence must be true for that candidate.
- **"Needs running speech" in pauses.** If the pick holds rows in
  "sustained" (§7, information), the result stage says so in the note; the
  info text is changed only if a sentence in it would become untrue.
- **The device sentence** is kept verbatim: "Readings depend on the
  microphone and how you hold or wear it, so compare yourself on one
  device, held or worn the same way."
- **Checks.** No gender words. The popover must still fit at p360, phone,
  p402 and desktop (`scripts/cue-strip-smoke.mjs`). Text only, no bar.

### 12. Compute plan (shared PC)

**Before each batch:**
- Check the load. Keep ≥ 10 % CPU and ≥ 5 GB RAM free.
- At most 3 heavy processes, or 2 if total CPU is above 80 %.
- Every node process runs with `--max-old-space-size=4096`.
- Only exact PIDs this round launched are killed (`taskkill //F //PID <n>`,
  then verified). No watchers are left running.

**Downloads:**
- one connection at a time, with a token bucket at 60 MB/s;
- train-clean-100 is 6.39 GB, the Freesound previews about 0.8 GB, DEMAND
  OMEETING channel 1 about 30 MB and Silero 2.3 MB;
- Python that reads downloads runs with `-I`, or with `-P` if `-I` hides the
  site-packages holding numpy or soundfile (reported).

**Estimated runtime** (3 shards; seen speeds: about 11× real time for
noise-only chain runs and about 3–4× for speech):

| step | audio | wall time |
|---|---|---|
| dev hook regeneration (470 records) | — | ~10–15 min |
| dev after-speech chain + real worker (314 streams of 60 s) | ≈ 5.2 h | ~20–30 min |
| G-FT, cold start + after speech (48 streams of 60 s) | ≈ 0.8 h | ~5 min |
| hooks for those streams | — | ~5–10 min |
| noise screen (≈ 320 clips) | — | ~5–10 min |
| replays and report | — | ~15 min |
| confirmation speech (156 streams of 150 s) | ≈ 6.5 h | ~35–45 min |
| confirmation noise, cold start (≈ 163 clips × 2) | ≈ 5.4 h | ~15 min |
| confirmation noise, after speech (same) | ≈ 5.4 h | ~25–30 min |
| confirmation hooks | — | ~15–20 min |

About 3–3.5 h of machine time in all, spread over the stages.

**Scratch** goes to `…/scratchpad/narrow/<stage>/`; outputs to the
gitignored `build/resonance-mobile/narrow/`. No audio is committed.

### 13. Critique and answers

Two critics reviewed the draft (2026-11-01). Every finding was applied,
some in a changed form; none was rejected outright. F1–F10 are unchanged;
G-FT is the only added requirement, and it is stricter.

| # | finding | what was done |
|---|---|---|
| 1.1 (high) | The per-clip +15 bar mixed pooled and own-clip BASE. | §7 / §9: per clip = candidate − the same clip's BASE, in that clip's own window, unrounded; fails if > 15.00. Pooled BASE only for the pooled bars. |
| 1.2 (high) | The fresh speech-free family dropped dev's machine classes, and the synth / glitch / game / designed rule matched clips C1's results singled out. | §5.3: dev's six Freesound classes with dev's queries, order and caps come first; the new subclasses follow at smaller caps (speech-free 102, as dev's metadata speech-free count); the filters are dev's. The data-quality words only mark clips; the guards without them are information. The composition is stated as fixed after C1's per-class results. |
| 1.3 (medium) | The seen record left out the compared alternatives; evidence in a scratchpad. | §5.1 names every alternative and says dev is in-sample. stats4–7 re-run unchanged to files; everything copied to a local folder outside the repo with a sha256 manifest (Appendix A); the desc4 sentence corrected (its output was in a file). |
| 1.4 (medium) | Nothing frozen before the first replay. | §10 step 2: a freeze commit (factories, tests, scripts, dev screen, dev pairing) before any K replay; hashes in the note and checked by every replay (§4.4). |
| 1.5 (medium) | Fetch rules open (end state, caps, URL, rejected sounds, filter order). | §5.3: pinned and verified URL with a pin check, pages 1–3 then extension 1 (caps +50 %, pages 1–5, redo from the start), extension 2 (reserve queries), terminal STOP; rejected sounds stay eligible (dev behaviour); filter order written out; page sha256s and fetch times committed. |
| 1.6 (medium) | Confirmation runners print BASE summaries early. | §10 step 4 quiet rule; `--quiet` on `chain.mjs`, `hold-noise-run.mjs`, `pause-row.mjs`, `as-run.mjs`, `QUIET=1` in `pause-queue.sh`. |
| 1.7 (low) | The reader replacement rule could not run. | Confirmed: `faster-prep.py` takes the first n, then skips. It gains `--fill`; the first 8 per sex are extracted; more from the kept archive if needed. |
| 1.8 (low) | The pairing key was ambiguous. | §4.3: (family 0 / 1, id as a JavaScript string); tables committed before the replays. |
| 1.9 (low) | G5's rule-or-wiring call had no test. | §10 step 3: the stub test; §10 step 6: G5 after PASS. |
| 1.10 (low) | Gaps in K4 / K5, parameter counts, tie tolerance. | §3: every candidate written in full, code normative; K5's re-engagement described; the clamp counted for all (K1 = 4); tie at \|a − b\| < 0.005. |
| 1.11 (low) | Clock origin, the leak into the window, streams with no position. | §4.1 one clock; §4.3 predicted leak; §7 information rows (u ≠ null at tCut, tLast + 7 s). |
| 1.12 (low) | Dev's talker scenes do not represent the fresh ones. | Said in §5.3 and §10; G-FT added (see 2.1). |
| 1.13 (low) | Pause classes only in words. | §7: pinned to `pausesFromClean` / `pauseMetrics` at 7e00e59, with the chunk bounds. |
| 1.14 (low) | FireRedVAD might be trained on LibriSpeech train. | Checked: its training data is undisclosed (README, paper abstract, the 2026-10-21 note). §5.2 states it as a known unknown; no bar change. |
| 2.1 (high) | Fresh talker scenes hold close voices dev never had; a hold picked on dev likely fails. | Option (a), adapted: G-FT (§4.5, §9), six other dev-clean readers as foreground talkers, two 60 s clips each (the streams are 60 s), at L1 / L2, cold start and after speech, judged by the talker bars; a dev eligibility requirement only. Option (c)'s statement is in §10. Option (b) (K1 / K2 only) was not taken: it would rule out a hold that does survive close talkers. |
| 2.2 (medium) | G5 could not pass with a K wired in (the wiring test pins C1). | §3.1 uses the shipped `inputs` pattern; §10 step 3 updates the wiring test in the working copy and runs G5 on both trees. |
| 2.3 (medium) | The size rule had no last step. | §5.3: extensions 1 and 2, then STOP if total < 100 or a class < 30. |
| 2.4 (medium) | The K2–K4 predicate itself was computed on dev. | §5.1 says so; evidence preserved outside the scratchpad. |
| 2.5 (low) | K1's T-QUIET risk understated. | §3.2: both criteria at risk, with the seen figures; §10. |
| 2.6 (low) | setInterval lateness and phone frame bursts not modelled. | §4.2 `tickJitterMs` and `arrival40`; §7 information rows for BASE and the pick on dev speech. |
| 2.7 (low) | The user's own hold leaks into the window. | As 1.11. |
| 2.8 (low) | The AC family needs `FAMS`. | §5.2: `FAMS="brown pink ac"`; the per-reader AC offset stated. |
| 2.9 (low) | Fetch gaps; the alt-gender sentence. | 8 readers per sex extracted, MD5 checked before extraction (not streamed). "`--n=6` applies the skip rule by itself" does not hold (1.7), so `--fill` was added. The alt-gender note does mention the split, as "LibriSpeech-clean-100"; the sentence now quotes that. |
| 2.10 (low) | Holds can show "needs running speech". | §7 information row; §11. |

## Appendix A: seen evidence manifest

`seen/MANIFEST.sha256`, in the local folder of §5.1 (not published;
sha256 of the manifest file:
`9970da018fb5528c13db0d04653f758f18d8baa3b4c840d02620974d41b8c568`):

```
22df4cf5626336ed4c29292bd3f820f05d03c576c31905d93b6266c62bb63796  design-discrimination/feat.mjs
28d9c3bf2018894f73c72dbe22dd1e69e1c797ed104881013fa164aee6336a96  design-discrimination/stats-f10_20.md
8b6d44b20d10b7217139c85efa7388bc77df27590caa7ecadb3e84e161f7f9c3  design-discrimination/stats-f20_10.md
7fed8ccfece9f47aa558c1f7631737077bf11bdf0ce7fa78ed2679e90fe465c3  design-discrimination/stats.mjs
03b052add433364f9807f1ff81417a67806d4751c1fd16c68c0c168de3b53963  design-discrimination/stats2-f20_10.md
b174634216d8654ecaa9f1216f64250e953eff64099b5c1e2c3b5da36d9f07fb  design-discrimination/stats2.mjs
366a9ebf7095e4c334f7687da024c665610a9fb6d69a373fa91ef6a1420eb135  design-discrimination/stats3.md
76f0c44856d85f444072694753fbf663cedd279c125281ef501c9a600a7813e0  design-discrimination/stats3.mjs
b7b8039ccfbe17cfc6fbb7dee4168ae55063ffa523ea3701214475ab0b2f24ff  design-discrimination/stats3b.md
337a82047a9a06aa3c820db70f5b5f7ce8e7e348c1f9bbb24963edb81c12cbc1  design-discrimination/stats3b.mjs
233ac249b2496e411c06cb61de46b3a52018fada70c7b562fe63d2ac62b5a3c5  design-discrimination/stats4-out.md
908b734d646ee2c9e6877d5fba31befb1439aecabbbd5f67e04ad6b7c37f41af  design-discrimination/stats4.mjs
2c7a376a28201034de002420cbcaade9b6b4ea867e9362674ca69bccf6756454  design-discrimination/stats5-out.md
c8ca1edd76a1dc213f9b06644a7c3feb5f75a88671dedefcfcd69f0b646828d2  design-discrimination/stats5.mjs
537cc11a5eb88cb4a2fafc3e1babb5c51b7b85700d91824778a84b9d2800d7fa  design-discrimination/stats6-out.md
70904363549cba324055f8a5eae0927ce3b0c1d77dc49cc01072164f6f1a545c  design-discrimination/stats6.mjs
d39c54b2175a88ea2c5a257c9636890f7d6e6cdec0176edd246d17c55bb2dbf7  design-discrimination/stats7-out.md
84fef598e1d6ea8f7c5ef80f7329f59128b37b8afe922a9a5b9baac35e173d9b  design-discrimination/stats7.mjs
26ab02e7ad9d210ba2a3902793434cc9574c5b91fa774ea0d1f25e6c2debff76  design-discrimination/ticks.json
7c923ad8c67c954e5034c27a09efb9407a495c3de19fb1c0fb3de364b8c9579a  design-experience/desc-out.md
c41fa2fd013e681712b0ee3d49c5fff0f50751d8dbd2d07289f21d8be14ee21d  design-experience/desc.mjs
bc291d05be90e21127fbe62740336a905925decb654416e3f90abb4a79661c7c  design-experience/desc2-out.md
1fa27bb9978c0a5509c40420182b89128776e138e62ac72163942e33d934d9f3  design-experience/desc2.mjs
be4521e031a0f3eb8aa3d114a20ccdfd5e9e760ba08c41b700bff988c4e08a59  design-experience/desc3-out.md
e2d8a1c882896448d810baa56a3aaccc653d311913b3e6f44636aff53e080374  design-experience/desc3.mjs
e441f4f47648fce691613fbdef456a65817155139ac1c2616858d52ae0a243a3  design-experience/desc4-out.md
b38f281ed802ba74ca070fc1e22bdb5eb0126d10eaa37f13d1117305b11b7a3e  design-experience/desc4.mjs
bfc794076b5c13864ffee02435e717a817f19a1c0d58fe206ca0f38d5d299d6b  design-experience/load.ps1
21af32577e098328d12eaa0db2dd8e0fbadf143000e5b1cf2eecc764e181af3b  design-mechanism/desc-out.md
1e122286cc4c53901041d7068cc3e202c807f1793770f9ae8f983fed320935b4  design-mechanism/desc.mjs
59b4a302954ef3a64d7148a393808664ed8b006c071660ac9e2ef65a4011fd6b  design-mechanism/desc2-out.md
83ec2e8e0b62933ed9e407ffd968eb8c221a1159048bd173120190863e32ebe4  design-mechanism/desc2.mjs
ded73948ab7e3af22b11676092ff7b3efb805fbd81f9615cd76bf6785b8fd2f4  design-mechanism/desc3-out.md
f3f2203e86b74b2647b21c8c49075555cedd56bfd9661879650bccba614f3fcb  design-mechanism/desc3.mjs
540b8cc92a68bd44634f95f9d69ec621362fac50a17779aeec1aa9a7417e993f  design-mechanism/desc4-out.md
d3734977fd2b60291583c24ff815efbd2f4fe6e248170f1d0c37754448a4c798  design-mechanism/desc4.mjs
```

## Freeze (2026-11-01, before any K replay)

This section is added after the plan; the plan section above is unchanged.
It is committed and pushed before any of K1–K5 is replayed on any data. The
only replays run so far are BASE and C1, the two reference arms: once to
check the extended harness against the C1 round, and once to check
`narrow-report.mjs` end to end on the new dev streams.

### Frozen code

`scripts/resonance/mobile/narrow-freeze.json` holds the sha256 of each
LF-normalised `toString()` and file (Node v24.14.1). `narrow-report.mjs`
checks every entry before it replays any K arm and stops on a mismatch.

| item | sha256 |
|---|---|
| K1 `createQuietOnsetBridge` | `5ccea137e4b73b7e864c108006f11c68918e483f8796eeb61b7cc6be1d60fc9a` |
| K2 `createVoiceArmedBridge` | `d089228a89aadd9e222fcf04ed458cc3c1f833671d1bf677a9ea4694c16c3141` |
| K3 `createVoiceHold` | `fabfcefecd1d4fe29ea45fd9e8b00d2ed15ccf736435a983eedba4258f9ab1a0` |
| K4 `createVoiceHoldRef` | `4fefbc784c2ddb9aff5afaa9154f689f08d21205b70622a30eb373e2657e4219` |
| K5 `createQuietPauseHold` | `2ec846d5f80a68f879377d739eb1328a0f88131520a8647179eb8c5d000569e2` |
| `holdQuantile` | `dfdd9c1d229bd8f93c92d46a12878955854f2ba36d33c7ad12112bf17688ce93` |
| `holdMedian` | `19b9c1ced7dc66f55a6bf26f8efae8faf4b4815b7fc1f49bce396d028ef7a31b` |
| `cueRowStates` | `acafc1c040df4febf963ca4b7ff50a57eace66f61db1d292d24c978ba6708353` |
| `resonanceRowState` | `61c808a3d1c99a34289a561f1dbb688ea5606667b3585a624ee7c252f415c0a4` |
| `createTrail` | `9b997d00d5dea60179816eb2c88c2863c6856688a030a2dbb39da3183aafe1ac` |
| `createResonanceHold` (C1) | `74c3dd30bafc020b127a117e41f82614c992238c8c6492706a4ac3f1d16ed186` |
| `dotOpacity` | `6f02e408a33feba640f0e4bc30f1efd3e71537e2a64ff9ecea7e0fd438446d47` |
| `rowValue` | `3dfc1bc8df879a1862b6b88e1f132363e189860e2b1df1bf5dfc518e39ab5dd7` |
| `axisPos` | `db516a8feb71cae782cbb111667679821bc83fb76a40044a1e22e6f523d1ce3b` |
| `resonanceClamp` | `bd24831d06f655846d9a94410ec110857674694c1e1a0b04ddcf1914d2e5460b` |
| `scripts/resonance/mobile/pause-report.mjs` | `d782bbdf67c7100341fd8522053c79668f8cbb3065e59cf06e09458574c85107` |
| `scripts/resonance/mobile/narrow-report.mjs` | `16df41227df51cc2f669a5e5f1a3603c2ee166520156e1a60ff9818a5eeb1c4c` |

The model functions after the five factories are hashed too: the factories
call them, and they must stay unchanged anyway (§1).

### What the freeze commit contains

- **`src/components/cueStripModel.js`:** the five factories, `holdQuantile`,
  `holdMedian` and `RESONANCE_HOLD_CANDIDATES` (K1–K5 by name). Nothing
  else in the module changed.
- **`tests/audio/cue-strip-model-test.js`:** 72 new checks (167 in all),
  covering every item of §10 step 2. Each check's expected flags were worked
  out by hand from the §3 code, tick by tick.
- **Harness:**
  - `pause-report.mjs`: `stripReplay` carries the throttled `intensity`,
    named candidate arms, `tickJitterMs` and `arrival40`; `STATES` is
    exported;
  - `pause-row.mjs`: `intenF64`, kind `"as"`, `--readers`, `--quiet`;
  - `chain.mjs` and `hold-noise-run.mjs`: `--quiet` (and `--list` for
    `hold-noise-run.mjs`);
  - new: `as-run.mjs`, `ft-clips.mjs`, `narrow-report.mjs`;
  - `faster-prep.py --fill`, `faster-streams.mjs --long-only`, and the
    `pause-queue.sh` overrides.
- **Data records:**
  - `narrow-pairing.json` (`sets.dev`): the dev pairing table, 157 clips
    plus the 12 G-FT clips, with each reader's tCut and tLast;
  - `narrow-freeze.json`;
  - the dev `narrow-screen.json`, committed earlier (ad7e8cd) and
    unchanged.
- **Unchanged:** `CueStrip.jsx`, `App.jsx` and `CombinedDashboard.jsx`
  (C1 stays wired). `useAudioPipeline.js` is byte-identical to 7e00e59
  (sha256 of the LF text `03f07112…bef28e205`).
- **On this tree:** `npm run lint` clean, `npm run test:unit` 76 / 76
  scripts, `npm run build` OK.

### Harness checks (§4.4): all pass

- **Hook records regenerated with `intenF64`** (156 speech, 314 cold
  start). Every pre-existing field is byte-identical, and so is each whole
  line without the added field, 470 / 470. `intenF64` rounds to `inten`
  at every chunk.
- **The extended `stripReplay` reproduces the C1 round.**
  - `hold-report.mjs` on the regenerated records: its tables are identical
    line for line to `build/resonance-mobile/hold/tables.md`, and its
    summary JSON is byte-identical to a run of the unextended code.
  - `narrow-report.mjs --arms=BASE,C1` gives the C1 note's figures. On
    speech, for example: trail 2.1 → 11.7 and thumb gone 74.2 → 0.0 % with
    no noise. On cold start, pooled: drawn 1.73 → 3.36 % (−48) and 3.99 →
    7.22 % (−40); worst clips +31.46 (PCAFETER 1) and +40.96 (SCAFE 4).
- **Real resonance worker = replica:** 96 292 / 96 292 posts on all 362
  new streams (dev after speech 314, G-FT cold start 24, G-FT after speech
  24).
- **Hints and levels.**
  - The hook's hints equal the runner's: 2 554 240 / 2 554 240 over 832
    streams.
  - Every rebuilt stream reproduces the runner's active level: 832 / 832.
  - Speech after the level step: −32.00 dBFS active on every stream.
  - Noise alone: its DSP median equals L to within 0.0001 dB.
  - tLast, tCut and the reader in each record equal the pairing table,
    338 / 338.

### Dev streams built (§4.3, §4.5)

- **G-FT talkers:** `faster-prep.py --split=dev-clean --tag=ft --n=9
  --fill` skipped no reader, so the talkers are the planned ones: men 2078,
  2086, 2428; women 2035, 2277, 2412.
  - Twelve 60 s clips, written by `ft-clips.mjs`. The PCM16 copies are
    exact.
  - The ft-prep long streams of the 12 dev readers equal the dev streams
    (4 spot checks).
- **Readers** (R = m1, f1, …: 174, 84, 251, 1462, 422, 1673, 652, 1919,
  777, 1988, 1272, 1993):
  - In 8 readers the cut lies in a gap's middle. There, the 48 kHz stream
    is exactly 0 for ± 50 ms around it.
  - Four readers (422, 1919, 1272, 1993) have no gap starting in
    [25, 30] s. They take tCut = 30.0 s with the fade-out.
  - Each reader's L stream rebuilt from long16 equals its file.
- **Positions when the speech ended** (u ≠ null at tCut): at −48 dBFS,
  157 / 157 streams; at −40 dBFS, 156 / 157 (one speech-free clip without
  one); G-FT 24 / 24. Every stream with u also has fill = 1.

### Deviations so far (all before any K replay)

1. **Python flag.** `faster-prep.py` ran with `python -P`, not `-I`: `-I`
   hides the user site-packages that hold numpy (as in the C1 round).
2. **Unread preamble values.** The transcription leaves out values the rule
   never reads: `rBase` in K1 and K5, and `h` in K2–K4. `cueRowStates` is
   pure, so nothing changes. Everything else is line for line.
3. **`hold-noise-run.mjs --list`.** §4.2 does not list this option. The
   default stays the dev list; the option lets the fresh set use the same
   script.
4. **Wider freeze.** The freeze also hashes the model functions the
   factories call, and the helpers. This is stricter than §4.4.
5. **tLast after tCut for one reader.** For dev__1993 tLast is 30.075 s,
   after tCut (30.0 s): a pitch message's `contextTime` trails the audio it
   describes. The window is defined on tLast, as planned.
6. **BASE and C1 on the new streams.** They were replayed on the new dev
   after-speech and G-FT streams before the freeze, to check
   `narrow-report.mjs` (reference arms only).
7. **G-FT bars.** G-FT applies the three talker-class bars of §9 (drawn,
   not idle, single clip). "Keep talking…" is reported there as
   information; the both-classes bar is applied in the eight real-noise
   cells.
8. **Not in this commit:** `narrow-noise-fetch.py` and
   `librispeech-fetch.py`. The confirmation-data stage writes them.
9. **Compute.** The machine reached 91 % total CPU (other sessions), so one
   after-speech shard and a first `test:unit` run were stopped by their
   exact PIDs. The shard was resumed later; its interrupted stream was
   redone from the start. `test:unit` was re-run in full.

## Dev results (2026-11-01)

**Pick: K4 (VHR).** K4 is K3's own-voice hold plus an own-loudness
reference. It passes T-QUIET, every dev guard, G-FT, G2–G4 and G5. K4, K3
and K2 are eligible, in that order; K1 and K5 fail T-QUIET. These are
in-sample results (§5.1). Only the confirmation (§10 steps 4–5) is a fair
test, and it replays BASE, C1 and K4 only.

**How the rule reached K4:**
- Highest T-NOISY: K3 and K4 tie at 7 of 9, ahead of K2 at 3.
- The tie-break, the pooled after-speech drawn excess (mean over L1 and
  L2, all 157 clips), favours K4: +0.078 points against +0.126 for K3. The
  difference, 0.048, is above the 0.005 tie tolerance.
- G5 passed on K4, so no other candidate was tried.

The frozen-code check passed before the replay (17 items). The replay is
`narrow-report.mjs` at the frozen hash, on the freeze commit a486586.

### Speech: T-QUIET and T-NOISY

Pooled over the 12 readers, window 20–150 s. Each condition has 186 pauses
of 1–5 s.

Mean resonance trail (points):

| condition | BASE | C1 | K1 | K2 | K3 | K4 | K5 |
|---|---|---|---|---|---|---|---|
| none | 2.1 | 11.7 | 9.3 | 11.2 | 11.6 | **11.6** | 9.4 |
| brown −55 | 2.0 | 12.2 | 9.0 | 11.8 | 12.2 | **12.2** | 8.8 |
| pink −55 | 2.0 | 12.2 | 8.8 | 11.8 | 12.2 | **12.2** | 8.5 |
| AC −55 | 2.6 | 12.3 | 9.8 | 12.0 | 12.3 | **12.3** | 9.3 |
| brown −50 | 1.8 | 12.7 | 2.7 | 4.4 | 12.6 | **12.6** | 5.9 |
| pink −50 | 1.8 | 12.7 | 2.8 | 4.4 | 12.7 | **12.7** | 6.6 |
| AC −50 | 6.7 | 12.9 | 7.8 | 12.2 | 12.9 | **12.9** | 9.5 |
| brown −48 | 2.0 | 12.8 | 2.0 | 4.3 | 12.6 | **12.6** | 5.1 |
| pink −48 | 2.0 | 13.0 | 2.0 | 4.4 | 12.8 | **12.7** | 5.2 |
| AC −48 | 9.9 | 13.3 | 10.4 | 12.9 | 13.3 | **13.3** | 11.0 |
| brown −40 | 1.6 | 12.9 | 1.6 | 2.7 | 3.6 | **3.3** | 1.7 |
| pink −40 | 1.8 | 12.8 | 1.8 | 3.2 | 4.6 | **4.4** | 2.0 |
| AC −40 | 10.1 | 13.4 | 10.1 | 12.7 | 12.8 | **12.5** | 10.1 |

Share of 1–5 s pauses in which the thumb disappears (%; window from the
pause's start to its end + 250 ms):

| condition | BASE | C1 | K1 | K2 | K3 | K4 | K5 |
|---|---|---|---|---|---|---|---|
| none | 74.2 | 0.0 | 2.7 | 1.1 | 0.5 | **0.5** | 2.2 |
| brown −55 | 79.6 | 0.0 | 3.8 | 0.5 | 0.0 | **0.0** | 5.9 |
| pink −55 | 79.0 | 0.0 | 3.2 | 0.5 | 0.0 | **0.0** | 5.4 |
| AC −55 | 68.3 | 0.0 | 3.8 | 0.5 | 0.0 | **0.0** | 5.4 |
| brown −50 | 99.5 | 0.0 | 67.7 | 52.7 | 0.5 | **0.5** | 25.8 |
| pink −50 | 100.0 | 0.0 | 73.1 | 57.0 | 0.0 | **0.0** | 22.0 |
| AC −50 | 29.0 | 0.0 | 15.6 | 3.8 | 0.0 | **0.0** | 9.7 |
| brown −48 | 100.0 | 0.0 | 97.8 | 58.6 | 1.1 | **1.1** | 36.0 |
| pink −48 | 100.0 | 0.0 | 100.0 | 60.2 | 1.1 | **1.1** | 36.0 |
| AC −48 | 12.9 | 0.0 | 9.7 | 2.7 | 0.0 | **0.0** | 7.0 |
| brown −40 | 100.0 | 0.0 | 100.0 | 75.8 | 58.1 | **59.7** | 94.1 |
| pink −40 | 100.0 | 0.0 | 100.0 | 73.7 | 50.5 | **52.2** | 92.5 |
| AC −40 | 9.1 | 0.0 | 9.1 | 2.7 | 2.2 | **2.7** | 9.1 |

| arm | T-QUIET | T-NOISY (of 9) | what decides it |
|---|---|---|---|
| K1 | FAIL | 0 | Trail 8.8–9.8 points at the quiet conditions (needs ≥ 10); the thumb criterion alone would pass (2.7–3.8 %). Both risks were foreseen in §3.2. |
| K2 | PASS | 3 | Only the AC −50 / −48 / −40 conditions: in brown and pink noise from −50 dBFS the thumb still goes in 53–76 % of pauses, as §3.3 expected. |
| K3 | PASS | 7 | Every −50 and −48 condition, and AC −40. Not brown or pink −40, where the voice is about 5 dB over the room (§3.4). |
| K4 | PASS | 7 | The same 7 conditions as K3. |
| K5 | FAIL | 0 | Trail 8.5–9.4 points at the quiet conditions, and the thumb gone in 5.4–5.9 % of pauses at −55 dBFS. |

**K4, more measures**, against BASE, at none / brown −48 / brown −40:
- **Row idle:** 0.0 / 0.0 / 6.2 % (BASE 4.4 / 11.1 / 14.3).
- **Trail clears a minute:** 0.6 / 0.3 / 6.8 (BASE 10.3 / 10.6 / 12.8).
- **Ticks with a drawable streak** (448 × 890): 97.1 / 98.4 / 72.6 % (BASE
  62.8 / 60.2 / 48.8). The 360 × 690 shares are at most 2.1 points lower.
- **0.3–1 s pauses with the thumb gone:** 0.0 / 0.0 / 19.5 % (BASE 42.4 /
  27.2 / 41.9).
- **Per sex, quiet conditions:** trail 12.3–13.0 points for men and
  10.8–11.7 for women; thumb gone in at most 1.1 % of pauses for men and
  0 % for women.
- **Streak span.**
  - With no noise, the trail is full on 53.9 % of ticks. The oldest point's
    median age is 42.5 s on those ticks, and 38.8 s on ticks with ≥ 2
    points.
  - At brown −48 these are 65.8 %, 37.0 s and 35.3 s. At brown −40 they
    are 0.5 %, 37.0 s and 8.0 s.

### Noise guards (§9): every K arm passes all eight cells

The talker class here is the screen's 7 clips: 5 DEMAND and 2 Freesound
(the screen stage's note).

- **"Not idle" and "keep talking…".** In every cell, each arm's Δ not idle
  equals its Δ drawn. Its Δ "keep talking…" is 0.00.
- **Cold-start bars.** In the cold-start cells the not-idle bars differ
  from the drawn bars: +2.00 (speech-free), +5.32 (talker L1), +6.74
  (talker L2).

Δ drawn-thumb time, arm − BASE, pooled (points):

| cell | clips | BASE drawn % | bar | C1 | K1 | K2 | K3 | K4 | K5 |
|---|---|---|---|---|---|---|---|---|---|
| speech-free L1 −48, cold | 150 | 1.33 | +1.00 | **+1.47** | +0.09 | +0.03 | +0.05 | +0.03 | +0.01 |
| talker L1 −48, cold | 7 | 10.36 | +2.59 | **+5.20** | +0.61 | +0.57 | +0.57 | +0.00 | +1.02 |
| speech-free L1 −48, after | 150 | 6.06 | +1.00 | **+5.18** | +0.31 | +0.04 | +0.05 | +0.05 | +0.09 |
| talker L1 −48, after | 7 | 22.64 | +5.66 | **+11.16** | +2.16 | +0.30 | +0.30 | +0.08 | +1.97 |
| speech-free L2 −40, cold | 150 | 3.39 | +1.00 | **+2.64** | +0.01 | +0.07 | +0.09 | +0.03 | +0.00 |
| talker L2 −40, cold | 7 | 16.93 | +4.23 | **+15.81** | +0.15 | +0.86 | +0.86 | +0.00 | +1.21 |
| speech-free L2 −40, after | 150 | 6.22 | +1.00 | **+8.48** | +0.02 | +0.11 | +0.15 | +0.06 | +0.07 |
| talker L2 −40, after | 7 | 24.68 | +6.17 | **+28.93** | +0.35 | +1.08 | +1.08 | +1.08 | +1.32 |

The largest single-clip excess per cell (bar +15.00), in the same order:
- **C1:** +31.46, +12.63, +51.54, +21.25, +40.96, +25.50, +72.77, +45.62;
  1–27 clips over +15 in seven cells.
- **K1:** at most +8.29.
- **K2:** at most +5.33.
- **K3:** at most +8.83 (DEMAND TBUS 3, speech-free L2 after speech).
- **K4:** at most +5.33: fs__254493, a server hard drive starting up, in
  the talker class. The screen stage found Silero speech runs at 38–50 s
  in it, where FireRedVAD also hears voice.
- **K5:** at most +11.48 (DEMAND TMETRO 3, talker L1 after speech).

C1 fails every cell again. Its after-speech figures, now through the real
chain, are close to the earlier fixed-position replay. Pooled over both
classes they are +5.45 (L1) and +9.40 (L2) points, against +4.68 / +7.86.

**Pooled over both classes** (information), K4: +0.03 / +0.05 (L1 cold /
after) and +0.03 / +0.10 points (L2).

### G-FT (dev): every arm passes

- On the foreground talkers BASE already draws the thumb 88.3–97.5 % of
  the time, so the talker bars are +22.1 to +24.4 points.
- Every K arm adds +2.2 to +2.8 points.
- The largest single clip is +4.4 (ft__2412__1, after speech).

### G2–G4: zero differences for every arm

These cover every render point and tick of all 832 streams.

- **G2:** the thumb's u is the same wherever both arms draw: 832 763
  (speech), 21 560 (cold start), 283 168 (after speech) and 103 320 (G-FT)
  render points.
- **G3:** the pitch row is the same on every render point and tick.
- **G4:**
  - **Speech:** the resonance state and thumb differ only where BASE is
    idle. For K4 that is 52 899 render points (C1 61 829, K1 18 556).
  - **Noise** (information): the same, 0 differences where BASE is not
    idle.

### G5 on K4: PASS

- **The working copy, uncommitted** (§3.1's pattern; `wire.mjs` in the
  stage scratchpad):
  - **`CueStrip.jsx`:** the tick creates `createVoiceHoldRef()` in place
    of `createResonanceHold()`; `latest.current` gains `intensity`;
    `hold.tick({ pitchVoiced: p.pitchVoiced, pitchHolding: p.pitchHolding,
    pitchLevel: p.pitchLevel, intensity: p.intensity, snap, workerStatus:
    p.resonanceStatus, hasRef: !!ref }, performance.now())`; a new
    `intensity = null` prop.
  - **`App.jsx` and `CombinedDashboard.jsx`** pass `intensity`.
  - **`tests/audio/cue-strip-wiring-test.js`** checks every step 6 item
    (18 checks): the factory beside the trails and not C1's, its inputs,
    `intensity` in `latest.current`, the view and render hold, App and
    CombinedDashboard passing `intensity`, and `useAudioPipeline.js`
    unchanged from 7e00e59. A negative check confirmed that the new App
    and CombinedDashboard assertions fail on the committed files.
  - **Unchanged:** the info text (`RESONANCE_INFO`); §11 changes it only
    on PASS.
- **sha256 of the four working-copy files**, as on disk; for the two
  CRLF checkouts, LF-normalised in brackets:

  | file | sha256 |
  |---|---|
  | `src/components/CueStrip.jsx` | `edb080b6fc0cb778e8a1c5b6c8f1a1c27ee0c3a2544480a0adbc63e387c51f2b` |
  | `src/App.jsx` | `0d16d0f5ef7ed6665e35d240d41d7ad5f267a00c81d00bcbf3ed96d4c4e0ffe3` (LF `a4a4b9e5c70d3dc31a4f9aedde25878c6bb48adcdd97d4cd1d23d38e954a2e3a`) |
  | `src/components/CombinedDashboard.jsx` | `b32d2c8b88093c11cc5f597194c14bb579eea1d8844ab4a98509cdd69908172e` (LF `5dbf7d5e16807bd39ce3016b5351925543f1e560768e10f8ebc8828300b62efa`) |
  | `tests/audio/cue-strip-wiring-test.js` | `5e163782a4fa95dfc693e00f29d0ff5e4da8b66c3a372d632f4274cffb57ec8b` |

  Copies and the diff are kept in a local folder outside the repo
  (`g5-working-copy-K4/`; not published).
  The four files were then restored to the committed state:
  `CueStrip.jsx` keeps C1 until the confirmation.
- **Results on the working copy:**
  - `npm run lint` clean; `npm run test:unit` 76 / 76; `npm run build` OK;
  - the cue-strip tests: model 167 / 167, geometry 8 / 8, voice-gate
    display 48 / 48, wiring 18 / 18;
  - `scripts/cue-strip-smoke.mjs`: phone 97 / 97, p402 97 / 97, p360
    97 / 97, desktop 103 / 103;
  - `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`: 78 / 78.
- **On the committed tree** (factories only, the freeze commit's code):
  lint clean, `test:unit` 76 / 76, build OK (Freeze section).

### Information (no bar), K4

- **Streams with a position when the speech ended** (u at tCut): 157 / 157
  at L1 and 156 / 157 at L2. Restricted to those streams, K4's
  after-speech figures are the same as above (speech-free L2: 149 clips,
  +0.06 points).
- **Window from tLast + 7 s**, after speech: +0.02 / +0.08 points at L1
  (speech-free / talker) and +0.05 / +1.12 at L2. The largest clip is
  +5.55 (fs__254493).
- **Without the 6 dev clips with a data-quality mark:** every cell would
  still pass; the largest Δ is unchanged.
- **By source**, after speech:
  - DEMAND (85): +0.07 (L1) and +0.11 points (L2);
  - Freesound (72): +0.04 and +0.10.
- **By metadata subclass:** the largest is fans / PC / coil whine at L2
  after speech, +0.36 points (fs__254493); public / café +0.11 (L1) and
  +0.24 (L2); transport +0.07 and +0.17.
- **Held render points in "needs running speech":** none, for every K arm,
  on speech and on noise. C1 has a few on noise, e.g. 44 of 25 423 at
  speech-free L2 from a cold start.
- **Tick timing** (BASE and K4, dev speech):
  - with `tickJitterMs` 150: K4 T-QUIET PASS, T-NOISY 7 (trail 11.5–12.2,
    thumb gone ≤ 1.1 %);
  - with `arrival40`: T-QUIET PASS, T-NOISY 7, the same quiet figures as
    nominal;
  - BASE is unchanged under both, within 0.1 point.

### What K4 would change for the user (if confirmed)

- **Quiet room or one up to about −48 dBFS** in pauses: the streak keeps
  about 12–13 points (about the last 40 s), where it now keeps about 2. The
  thumb stays, dimmed, in almost every pause of 1–5 s, and the blink at the
  first word after a pause no longer clears the streak.
- **About −40 dBFS** in pauses (brown or pink room noise): the voice stands
  only about 5 dB over the room. The thumb still disappears in about half
  of the 1–5 s pauses, with a trail of 3–4 points.
- **Cost on dev noise:** pooled over all 157 clips, at most +0.10 point of
  extra drawn-thumb time; +1.08 in the 7 talker clips at −40 dBFS after
  speech; at most +5.3 points on any one clip. After speech, C1 cost +5.5
  and +9.4 points pooled, and up to +73 on one clip.

### Deviations in the dev stage

1. **The working copy's wiring test.** Its first version of the new App
   check did not normalise CRLF line endings. It failed on the CRLF
   checkout of `App.jsx` before G5 was run, and was fixed in the test. No
   factory changed, and no G5 check had failed, so the stub test of §10 was
   not needed.
2. **`dist/`.** The untracked build output is left built from the wired
   working copy. Rebuild it before any later smoke on the committed tree.

No other deviation.

### Next

Confirmation (§10 steps 4–5): BASE, C1 (reference) and K4 only, on the
fresh readers and the fresh noise. It runs once both pushes are done: this
dev pick, and the fresh list with its screen and pairing table. On PASS,
K4 replaces C1 in `CueStrip.jsx` (§10 step 6, §11). On FAIL, STOP.

### Reproduce (dev)

```
python -P scripts/resonance/faster-prep.py --libri="../Syrinx-cache/resonance-lab/data" --split=dev-clean --tag=ft --n=9 --fill --out=build/resonance-mobile/narrow/ft-prep
node scripts/resonance/mobile/ft-clips.mjs
node scripts/resonance/mobile/as-run.mjs prep --set=dev           # asBase, tCut, tLast, narrow-pairing.json
for i in 0 1 2; do node scripts/resonance/mobile/as-run.mjs run --set=dev --shard=$i/3 & done; wait
# the real DSP worker + hook (speech, cold start, after speech / G-FT):
for i in 0 1 2; do SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/mobile/pause-row.mjs \
  --runs=build/resonance-mobile/pause/runs --out=build/resonance-mobile/narrow/hook-speech \
  --conds=clean,brown_m55,brown_m50,brown_m48,brown_m40,pink_m55,pink_m50,pink_m48,pink_m40,ac_m55,ac_m50,ac_m48,ac_m40 --shard=$i/3 & done; wait
for i in 0 1 2; do SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/mobile/pause-row.mjs \
  --runs=build/resonance-mobile/hold/runs --out=build/resonance-mobile/narrow/hook-cold --shard=$i/3 & done; wait
for i in 0 1 2; do SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/mobile/pause-row.mjs \
  --runs=build/resonance-mobile/narrow/runs-dev --out=build/resonance-mobile/narrow/hook-dev --shard=$i/3 & done; wait
node --max-old-space-size=4096 scripts/resonance/mobile/narrow-report.mjs   # checks narrow-freeze.json first
```

The outputs are `build/resonance-mobile/narrow/report-dev.{md,json}`
(gitignored), with every table above and the per-arm, per-condition and
per-clip detail.

## Confirmation results (2026-11-01)

The confirmation replayed **BASE, C1 (reference) and K4 only**, once, on
fresh data, with `narrow-report.mjs` at the frozen hash (freeze check PASS,
17 items, Node v24.14.1). K1–K3 and K5 were never replayed on it. The data
list, its screen, the fresh pairing table and the 12 reader ids were
committed and pushed first (138337f, after the dev pick's push 2d92122),
before any arm was replayed on confirmation data. Until then the chain and
hook runs printed only integrity lines (§10 step 4).

**K4 PASSES the confirmation:** T-QUIET PASS, all eight noise cells PASS,
G2–G4 PASS, and G5 PASS with K4 wired. T-NOISY is 7 of 9 (reported, not a
bar). By §10 step 6, K4 replaces C1 in `CueStrip.jsx` on this branch.

### The confirmation data

- **Readers** (§5.2): LibriSpeech train-clean-100, men 26, 27, 60, 78, 118,
  163 and women 19, 32, 39, 40, 83, 87, exactly the expected ones (none
  skipped by `--fill`). R = 26, 19, 27, 32, 60, 39, 78, 40, 118, 83, 163, 87
  (`narrow-confirm-readers.json`). The archive's MD5 was checked before
  extraction.
- **Speech:** 12 readers × 13 conditions = 156 streams, 20–150 s, built as
  dev (§5.2).
  - Speech at −32.00 dBFS active and noise at its floor on every stream.
  - The real resonance worker equals the replica on all 47 952 posts of the
    −50 / −48 streams.
  - The hook's hints equal the runner's (935 220 / 935 220), and every
    rebuilt stream is identical (156 / 156).
- **Fresh real noise** (§5.3): 191 clips of 60 s
  (`narrow-confirm-noise-list.json`, sha256 `249b7a5f…`; `9d59d8b3…` before
  the 2026-11-02 path edit, Review and fixes).
  - The base fetch gave 163 clips with only 23 in the talker class, so
    extension 1 was applied to the talker family (caps +50 %, pages 1–5,
    redone from the start). No extension 2.
  - **Final classes (§6): 160 speech-free, 31 talker.** By metadata family:
    speech-free family 102 → 100 speech-free + 2 talker; talker family 89
    → 60 speech-free + 29 talker.
  - Talker class by subclass: people nearby 12 of 21, café / restaurant /
    bar 6 of 24, station / airport / mall 3 of 21, TV or radio 3 of 18,
    DEMAND OMEETING 5 of 5, fridge 1 of 12 (fs__403670), room and home
    appliances 1 of 8 (fs__182600).
  - Sources: Freesound 186, DEMAND OMEETING 5. Licences: CC0 1.0 118,
    CC BY 4.0 64 (the 5 DEMAND clips also CC BY-SA 3.0), CC BY 3.0 9.
  - 172 uploaders, at most 2 sounds each. Disjoint from dev by id (72) and
    by uploader (70). All 38 search pages passed the pin check.
  - Data-quality marks (information): fs__222371, fs__869132, fs__869570,
    fs__553450, fs__564665 (speech-free) and fs__565539 (talker).
- **Cold start:** 191 clips × 2 levels = 382 streams. The noise DSP median
  is exactly L on every stream; worker = replica on 101 612 / 101 612
  posts.
- **After speech** (§4.3): 382 streams.
  - Built by `as-run.mjs` (the dev builder, with `--list` added; see
    Deviations) through the real pitch worker with FireRedVAD and the real
    resonance worker beside the replica, then `pause-row.mjs` (the real DSP
    worker and the real hook).
  - Pairing: the plan's rule (metadata family, then id; clip i → R[i mod
    12]), in `narrow-pairing.json` `sets.fresh`.
  - tCut / tLast per reader (s): 26 30.000 / 29.800 (fade), 19 25.275 /
    24.475, 27 30.000 / 29.925 (fade), 32 27.175 / 26.625, 60 30.000 /
    30.050 (fade), 39 26.955 / 26.075, 78 26.155 / 25.500, 40 28.225 /
    27.775, 118 29.800 / 29.125, 83 30.000 / 29.975 (fade), 163 30.000 /
    30.025 (fade), 87 25.680 / 25.275.
  - Six readers have no gap starting in [25, 30] s and take the fade-out.
    In the other six, the 48 kHz stream is exactly 0 for ± 50 ms around the
    cut.
- **The report's checks** (all 920 streams):
  - rebuilt audio identical 920 / 920;
  - hook hints = runner hints 2 765 000 / 2 765 000;
  - real resonance worker = replica 203 224 / 203 224 posts (764 noise
    streams);
  - tLast / reader / tCut = the pairing table 382 / 382;
  - speech level within 3e-9 dB of −32 dBFS, noise within 2e-8 dB of L.
- **Streams with a resonance position when the speech ended:** 191 / 191 at
  both levels, all with fill = 1.

### Speech: T-QUIET PASS, T-NOISY 7

Pooled over the 12 fresh readers, 20–150 s, with 150 pauses of 1–5 s per
condition. Dev K4 (in-sample) is beside it for comparison. "Gone" is the
share of 1–5 s pauses in which the thumb disappears, from the pause's start
to its end + 250 ms.

| condition | pause floor (dBFS) | BASE trail | C1 trail | K4 trail | dev K4 trail | BASE gone % | C1 gone % | K4 gone % | dev K4 gone % |
|---|---|---|---|---|---|---|---|---|---|
| none | −62.7 | 2.3 | 13.5 | **13.2** | 11.6 | 84.0 | 0.0 | **0.7** | 0.5 |
| brown −55 | −53.9 | 2.2 | 13.6 | **13.4** | 12.2 | 84.0 | 0.0 | **0.7** | 0.0 |
| pink −55 | −54.1 | 2.2 | 13.6 | **13.4** | 12.2 | 84.7 | 0.0 | **0.7** | 0.0 |
| AC −55 | −53.7 | 2.3 | 13.7 | **13.6** | 12.3 | 78.0 | 0.0 | **0.0** | 0.0 |
| brown −50 | −49.4 | 1.9 | 13.7 | 13.1 | 12.6 | 100.0 | 0.0 | 2.7 | 0.5 |
| pink −50 | −49.6 | 2.1 | 13.8 | 13.2 | 12.7 | 100.0 | 0.0 | 2.0 | 0.0 |
| AC −50 | −49.3 | 6.9 | 14.1 | 14.0 | 12.9 | 31.3 | 0.0 | 0.0 | 0.0 |
| brown −48 | −47.5 | 2.4 | 13.6 | 12.8 | 12.6 | 100.0 | 0.0 | 4.0 | 1.1 |
| pink −48 | −47.7 | 2.5 | 13.8 | 13.0 | 12.7 | 100.0 | 0.0 | 4.0 | 1.1 |
| AC −48 | −47.5 | 10.1 | 13.9 | 13.8 | 13.3 | 19.3 | 0.0 | 0.7 | 0.0 |
| brown −40 | −39.8 | 1.8 | 13.4 | 5.4 | 3.3 | 100.0 | 0.0 | 46.0 | 59.7 |
| pink −40 | −39.9 | 2.1 | 13.6 | 7.0 | 4.4 | 100.0 | 0.0 | 43.3 | 52.2 |
| AC −40 | −39.7 | 10.2 | 13.6 | 12.8 | 12.5 | 13.3 | 0.0 | 4.0 | 2.7 |

- **T-QUIET: PASS.** At the four quiet conditions, K4's trail is 13.2–13.6
  points (bar ≥ 10) and the thumb goes in 0.0–0.7 % of pauses (bar ≤ 5 %).
- **T-NOISY: 7 of 9** (information), the same seven conditions as on dev:
  every −50 and −48 condition, and AC −40.
  - Brown and pink −40 miss: the thumb goes in 46.0 / 43.3 % of pauses,
    with a trail of 5.4 / 7.0.
  - At brown and pink −50 / −48 the thumb now goes in 2.0–4.0 % of pauses.
    That is more than on dev (0–1.1 %), but under 5 %.
- **K4, more measures** at none / brown −40 / pink −40 (BASE in brackets):
  - row idle 0.0 / 4.9 / 3.6 % (5.5 / 13.4 / 11.0);
  - trail clears a minute 0.1 / 4.0 / 3.2 (9.8 / 11.8 / 10.2);
  - ticks with a drawable streak at 448 × 890: 99.3 / 79.3 / 86.6 % (64.4
    / 51.9 / 59.5); at 360 × 690, at most 1.5 points lower;
  - 0.3–1 s pauses with the thumb gone: 0.0 / 8.7 / 5.7 % (42.2 / 39.7 /
    32.1).
- **Per sex, quiet conditions:** trail 12.9–13.4 points for men and
  13.5–13.8 for women; thumb gone in 0–1.0 % of pauses for men and 0 % for
  women. With brown noise at −40, men 50.0 % and women 38.9 %; with pink at
  −40, 47.9 % and 35.2 %.
- **Streak span (no noise):** the trail is full on 71.4 % of ticks. There,
  the oldest point's median age is 39.75 s (q10–q90 36.3–47.3 s); on ticks
  with ≥ 2 points it is 38.25 s. C1: 40.0 / 38.5 s.
- **Held render points in "needs running speech":** none on speech.

### Noise guards (§9): all eight cells PASS

Δ = K4 − BASE, pooled and render-point weighted, in points. The bars are
§9's. The talker bars scale with BASE, which is much higher on the fresh
talker scenes (46–58 %) than on dev's (10–25 %).

| cell | clips | BASE drawn % | K4 Δ drawn (bar) | K4 Δ not idle (bar) | K4 Δ "keep talking…" | K4 largest clip Δ (bar +15) | C1 Δ drawn | C1 largest clip Δ |
|---|---|---|---|---|---|---|---|---|
| speech-free L1 −48, cold | 160 | 3.83 | +0.12 (+1.00) | +0.12 (+2.00) | +0.00 | +14.17 (fs__873562) | **+2.30** | **+35.25** |
| talker L1 −48, cold | 31 | 46.40 | +0.97 (+11.60) | +0.97 (+13.70) | +0.00 | +5.92 (fs__161929) | +10.15 | **+33.17** |
| speech-free L1 −48, after | 160 | 8.98 | +0.13 (+1.00) | +0.13 (+2.00) | +0.00 | +7.48 (fs__873562) | **+5.88** | **+48.80** |
| talker L1 −48, after | 31 | 51.07 | +0.62 (+12.77) | +0.62 (+12.77) | +0.00 | +7.28 (fs__594415) | **+17.00** | **+55.61** |
| speech-free L2 −40, cold | 160 | 6.45 | +0.07 (+1.00) | +0.07 (+2.00) | +0.00 | +7.67 (fs__873562) | **+2.13** | **+36.00** |
| talker L2 −40, cold | 31 | 52.95 | +0.96 (+13.24) | +0.96 (+15.33) | +0.00 | +7.50 (fs__161929) | +9.80 | **+35.58** |
| speech-free L2 −40, after | 160 | 10.36 | +0.26 (+1.00) | +0.26 (+2.00) | +0.00 | +11.64 (fs__873562) | **+7.76** | **+68.75** |
| talker L2 −40, after | 31 | 58.32 | +0.95 (+14.58) | +0.95 (+14.58) | +0.00 | +7.90 (demand__OMEETING__3) | **+14.87** | **+64.24** |

- **K4 passes every bar in every cell.** No clip is over +15.
  - The closest is fs__873562 at **+14.17** points (speech-free, L1, cold
    start), 0.83 points under the bar. It is "Muffled TV Program #7", in the
    TV or radio subclass.
  - The Silero screen heard no speech in it (S = 0), so it is judged as
    speech-free. The app's own voice gate does hear voice there: BASE draws
    the thumb 62–88 % of the time.
  - It is the one place where K4's cost came near a bar.
- **Clips with any excess:** 12 of 191 at each level from a cold start (13
  distinct clips over both levels), and 17 (L1) / 19 (L2) after speech. Over +5 points: 2–4 clips per cell. Over +10: one clip
  (fs__873562), in two cells. No clip shows less thumb time than BASE.
- **C1** (reference) fails all eight cells, as on dev; the two talker
  cold-start cells only on the single-clip bar. Pooled over both
  classes, it adds +3.57 / +7.72 points at L1 (cold / after) and +3.38 /
  +8.94 at L2.
- **G2:** the thumb's u is the same wherever both arms draw, with 0
  differences for K4 and C1: 834 820 render points on speech, 113 401 from
  a cold start and 409 843 after speech.
- **G3:** the pitch row is the same at every render point and tick.
- **G4:** on speech, K4's resonance state and thumb differ from BASE only
  where BASE is idle (53 790 render points). On noise (information) there
  are also 0 differences where BASE is not idle.

**Information (no bar), K4:**
- **Pooled over both classes:** +0.25 / +0.21 points at L1 (cold / after)
  and +0.21 / +0.37 at L2.
- **By source:** Freesound (186 clips) +0.13 to +0.31. DEMAND OMEETING (5)
  +3.40 / +0.63 at L1 and +3.45 / +2.58 at L2 (cold / after); its largest
  clip +7.90.
- **By metadata subclass:** the largest are OMEETING (above), TV or radio
  +0.72 to +1.41, people nearby +0.23 to +0.84, café +0.07 to +0.58 and
  washing machine / kitchen +0.49 (L2 after). Every other subclass
  (machines, traffic, weather, vehicles) is at +0.00 to +0.26.
- **Window from tLast + 7 s:** +0.10 / +0.64 (L1, speech-free / talker) and
  +0.26 / +0.98 (L2); the largest clip +11.28.
- **Without the 6 clips with a data-quality mark:** every cell would still
  pass, with the same largest clips.
- **Only the streams with a position at tCut:** all 191 had one, so the
  figures are the same.
- **Held render points in "needs running speech":** 2 of 427 (speech-free,
  L2, after speech); 0 elsewhere.
- **Tie-break measure** on fresh data: +0.289 points (dev +0.078).
- **Tick timing**, on the confirmation speech: the report runs these rows
  on whichever speech it reads (the plan asks for them on dev only).
  - With `tickJitterMs` 150: K4 keeps T-QUIET PASS and T-NOISY 7.
  - With `arrival40`: T-QUIET PASS and T-NOISY 6.
  - BASE is within 0.1 point of nominal under both.

### G5 with K4 wired: PASS

The dev stage's working copy (`g5-working-copy-K4/wiring.diff`, outside the
repo) was applied unchanged. Its four files are LF-equal to the dev G5
hashes.
Then the §11 text and the comment updates were made:

- **`CueStrip.jsx`:**
  - the tick creates `createVoiceHoldRef()` and feeds it the gated flags,
    the pitch level, `intensity`, the snapshot, the worker status, `hasRef`
    and `performance.now()`;
  - `latest.current` gains `intensity`, from a new `intensity = null` prop;
  - the streak sentence (§11).
- **`App.jsx` → `CombinedDashboard.jsx` → `CueStrip.jsx`** pass the hook's
  throttled `intensity`. `useAudioPipeline.js` is byte-identical to 7e00e59
  (the wiring test checks it).
- **`tests/audio/cue-strip-wiring-test.js`:** the 18 checks of the dev
  working copy:
  - the K4 factory beside the trails, and no `createResonanceHold`;
  - its inputs, and `intensity` in `latest.current`;
  - the hold in the view and in the render;
  - App and CombinedDashboard passing `intensity`;
  - the hook unchanged.
  *(Superseded in review: the hook hash was replaced by 4 structural checks,
  21 in all — see Review and fixes item 6.)*
- **`cueStripModel.js`:** comments only (C1 is now the harness's reference
  arm, K4 the wired one, and the trail's span). The frozen `toString()`
  hashes are unchanged (17 / 17).

Results on the final tree:
- `npm run lint` clean; `npm run test:unit` 76 / 76; `npm run build` OK.
- The cue-strip tests: model 167 / 167, geometry 8 / 8, voice-gate display
  48 / 48, wiring 18 / 18 (21 / 21 after the review fixes).
- `scripts/cue-strip-smoke-wavs.mjs` with the same inputs (test-clean
  readers 121 and 61): every WAV is byte-identical to the dev stage's.
- `scripts/cue-strip-smoke.mjs`: phone 97 / 97, p402 97 / 97, p360 97 / 97,
  desktop 103 / 103. At each, the resonance info popover opens, wraps and
  stays inside the viewport.
- `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`: 78 / 78.

### Info text (§11)

- **N = 40 s.** K4's streak span on the confirmation's clean speech: the
  median age of the oldest point at full-trail ticks is 39.75 s → 40 s (not
  a tie).
- **The noisy-room clause applies.** K4's thumb is gone in more than 5 % of
  1–5 s pauses at brown −40 (46.0 %) and pink −40 (43.3 %).
- **T = 1.0 s.** Take those two conditions' 1–5 s pauses in which the trail
  cleared: 62 + 61 = 123 pauses where the last tick before the pause had
  ≥ 1 point and a tick in the pause's window had 0. The median time from
  the pause's start to the first empty-trail tick is 1.05 s (1.00 / 1.15 s
  per condition) → 1.0 s. Script:
  `scripts/resonance/mobile/narrow-info-t.mjs`.
- **The streak sentence** now reads: "The streak shows about the last 40 s
  and starts over after about 5 s without speech; in a noisy room it can
  start over sooner, about 1 s into a pause." The device sentence is
  unchanged, word for word.
- **"Needs running speech":** K4 held no speech render point there, and 2
  of 427 held points in one noise cell, so no sentence became untrue.

### Deviations in the confirmation

From the confirmation-data stage (all decided before any replay):
1. **A silent preview.** Filter 7 also skipped a preview whose first 60 s
   are digital silence: fs__583249, a washing machine. Its noise-alone DSP
   median was −300 dBFS, so the level rule could not apply. Its subclass
   then took fs__388097. *(Corrected in review; see Review and fixes.)* In
   the base list the freed uploader slot also changed one "people nearby"
   pick (fs__543817 in, fs__857741 out), but extension 1 then redid the
   talker family and both clips are in the final list. The rule's only
   effect on the final list is fs__583249 → fs__388097, one speech-free
   clip. Without it the base talker class would have been 22, not 23;
   both are under 30, so extension 1 would have run either way.
2. **File names.** The list and its screen are
   `narrow-confirm-noise-list.json` and `narrow-confirm-screen.json`, not
   the plan's `narrow-noise-list.json`. The fresh classes were also written
   to `narrow-screen.json` `sets.fresh`, which `as-run.mjs` and
   `narrow-report.mjs` read, by a re-run of the deterministic screen: 191 /
   191 clips identical, the same list sha256.
3. **The quiet runner.** The speech and cold-start chain records came from
   `narrow-confirm-chain.mjs` / `narrow-confirm-queue.sh`. These call
   `chain.mjs`'s and `hold-noise-run.mjs`'s functions and write the same
   record (self-tested field for field on dev streams). The cold-start
   records carry an extra `worker` field.
4. **Downloads.**
   - The LibriSpeech archive was resumed from the openslr.elda.org mirror
     by HTTP range; the MD5 matched.
   - Brief speed probes and one 2 MB CDN probe opened a second connection.
   - The fetch scripts ran with `python -P`, not `-I`, which hides
     requests, numpy and soundfile.
5. **Load.** One 3-process batch started at 79 % total CPU.
6. **Labels and counts.** The list's `decisions` counts cover the whole
   fetch, including the talker family's selection before its redo.
   OMEETING's subclass label is "meeting room (DEMAND OMEETING)".

From this stage:

7. **`as-run.mjs --list`.** It was added after the freeze, so that the
   builder reads the confirmation list under its own name. The default is
   unchanged, and `as-run.mjs` is not one of the frozen files.
8. **Timing rows on fresh speech.** `narrow-report.mjs` runs the
   `tickJitterMs` / `arrival40` rows on the speech set it reads, so the
   fresh report has them too (information; its label says "dev speech").
9. **The T definition.** §11 does not define "a pause in which the trail
   cleared". The definition used (above) was fixed in the script before T
   was computed, after the verdict.

Added in review (see Review and fixes):

10. **Voicing summaries in the confirmation records.**
    `narrow-confirm-chain.mjs` writes `pitchStats` (hops, voiced and
    hidden counts) into every chain record it makes. So voicing figures of
    confirmation data were computed and stored before the dev pick was
    pushed (speech records) and before the list was pushed (cold-start
    records), against the letter of §10 step 4. They were never printed or
    read: the logs show only integrity lines.
11. **Memory cap.** The fresh report ran with `--max-old-space-size=6144`,
    not §12's 4096. A rerun with 4096 is byte-identical (json `31dd7e1f…`,
    md `d0039bbe…`).

## Verdict (2026-11-01)

**PASS. K4 (`createVoiceHoldRef`) is confirmed and replaces C1 in
`CueStrip.jsx` on `resonance-hold-narrow`.** It passed T-QUIET and every
guard on fresh readers and 191 fresh real-noise clips (160 in the plan's
"speech-free" class, i.e. clips the independent screen heard no speech in,
and 31 talker), at −48 and −40 dBFS, from a cold start and after speech. It
also passed G5 with the final text. No PR and no merge.

**What changes for the user** (on this branch):
- **A quiet room, or one up to about −48 dBFS in the pauses** (the voice
  about 10 dB or more above the room):
  - The resonance streak keeps about 13 points (about the last 40 s). Now
    it keeps about 2 (7–10 with the air-conditioner recording at −50 /
    −48 dBFS).
  - In 1–5 s pauses the thumb stays, dimmed, in 96–100 % of pauses. Now it
    goes in 84–100 % of them with no noise or with brown or pink noise
    (78 % with the air-conditioner recording at −55 dBFS, 19–31 % at −50 /
    −48).
  - The short blink when speech starts again no longer wipes the streak.
- **A room about 5 dB under the voice** (brown or pink noise at −40 dBFS):
  - The streak still starts over in about 45 % of 1–5 s pauses, about 1 s
    into the pause. The info text says so.
  - It keeps 5–7 points; now it keeps about 2.
- **What it costs in noise when the user is not speaking** (extra time with
  the thumb drawn, pooled):
  - Scenes the screen heard no speech in (the "speech-free" class): +0.07
    to +0.12 points from a cold start, and +0.13 (L1) / +0.26 (L2) after
    speech, on BASE's 4–10 %. *(Split added in review.)* Its machine,
    traffic, weather and appliance clips (100) cost +0.00 to +0.07; its 60
    TV, café, station and people recordings cost +0.17 to +0.57, because
    the screen missed the voices in many of them (see Review and fixes).
  - Talker scenes (people, cafés, TV, a meeting): +0.97 (L1) / +0.96 (L2)
    points from a cold start, and +0.62 / +0.95 after speech, on BASE's
    46–58 %. The
    voice gate already shows most of that time.
  - At most +14.2 points on one clip: a muffled TV programme in which the
    independent screen hears no speech.
  - For comparison, C1 (the 5 s hold at any floor) cost +2.1 to +17.0
    points pooled in the same cells, and up to +69 on one clip.
- **Unchanged:** the pitch column, the hook, every u and the recorded
  sessions. Screen readers still read a held pause like a live position;
  adding "(last reading)" stays a separate user decision. *(2026-11-02:
  decided and built — see "After the round".)*

**What the confirmation does not cover:**
- a real phone or headset (the side-by-side kit, commit 7e00e59, is still
  to be run; *2026-11-02: that investigation is paused by user decision,
  after one session with the test sound only — see the status at the top*);
- noise louder than −40 dBFS in the pauses;
- speech in languages other than English;
- speech much quieter than −32 dBFS active, which brings the voice closer
  to the room.

*Added in review* (details in Review and fixes):
- **Only the default voice-gate path was measured.** Every guard used the
  gate-on records. With "Only show pitch while I'm speaking" off, or before
  the detector has decided (model loading, "slow"), the hold runs on the
  raw voiced flag, which is unmeasured.
- **A mid-session voice-level drop was not in the data.** Every stream ran
  at a fixed −32 dBFS. In a synthetic probe, a drop of more than ~6 dB
  below the voice's own last-minute level (the phone moved away, the head
  turned) switches the blink bridge and the hold off for ~12–33 s, until
  the reference catches up. The row is then as without the hold, never
  worse.

**How strong the evidence is** *(added in review)*:
- **K4 over K3 was an in-sample choice.** They tied on T-NOISY (7 / 7) and
  K4 won the dev tie-break by about 0.05 points (+0.078 vs +0.126). Their
  parameters were chosen with descriptive dev statistics in view (§5.1).
  Only K4 was tested on fresh data, so the confirmation shows K4 passes; it
  does not show that K4 beats K3.
- **The bound on the cost near other talkers is weak.** G-FT (dev) hit a
  ceiling and could not tell the candidates apart. The talker bars scale
  with BASE (+11.6 to +14.6 points). The talker class reached its size
  rule by one clip (31 vs 30), and two of its clips are machine room tones
  with no excess in any arm, so 29 clips inform it. The cost where other
  people talk is bounded mainly by the per-clip +15 bar. Its closest clip,
  a muffled TV programme the screen heard as speech-free, is at +14.17, and
  under phone-like 40 ms capture buffers another of its cells comes to
  +14.66.

### Reproduce (confirmation)

```
node scripts/resonance/mobile/screen-silero.mjs --set=fresh --list=scripts/resonance/mobile/narrow-confirm-noise-list.json
node scripts/resonance/mobile/as-run.mjs prep --set=fresh --readers=build/resonance-mobile/narrow/confirm/streams/readers-conf.json \
  --list=scripts/resonance/mobile/narrow-confirm-noise-list.json --quiet
for i in 0 1 2; do node scripts/resonance/mobile/as-run.mjs run --set=fresh --list=scripts/resonance/mobile/narrow-confirm-noise-list.json \
  --readers=build/resonance-mobile/narrow/confirm/streams/readers-conf.json --shard=$i/3 --quiet & done; wait
for i in 0 1 2; do SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/mobile/pause-row.mjs \
  --runs=build/resonance-mobile/narrow/runs-fresh --out=build/resonance-mobile/narrow/hook-fresh --shard=$i/3 --quiet & done; wait
node --max-old-space-size=4096 scripts/resonance/mobile/narrow-report.mjs --set=fresh --arms=BASE,C1,K4 \
  --list=scripts/resonance/mobile/narrow-confirm-noise-list.json \
  --speech-runs=build/resonance-mobile/narrow/confirm/pause/runs --speech-hook=build/resonance-mobile/narrow/confirm/pause/hook \
  --cold-runs=build/resonance-mobile/narrow/confirm/hold/runs --cold-hook=build/resonance-mobile/narrow/confirm/hold/hook
node scripts/resonance/mobile/narrow-info-t.mjs --pick=K4
```

The speech and cold-start chain and hook records came from
`narrow-confirm-queue.sh` (3 shards), `narrow-confirm-chain.mjs noise` and
`pause-row.mjs --quiet` (see those scripts' headers). The report is
`build/resonance-mobile/narrow/report-fresh.{md,json}` (gitignored; sha256
`d0039bbe…` / `31dd7e1f…`); copies are kept in a local folder outside the
repo (`confirm/`; not published).

## Review and fixes (2026-11-01)

Three independent reviewers checked the round after the confirmation:
- one checked the pre-registration and its timeline;
- one checked the app code and its wiring;
- one reproduced the numbers.

None of them found an error in a computation, and the **PASS verdict
stands**. Every number they reproduced matched exactly. None of the fixes
below changes the plan, a candidate, a bar, the dev pick or the verdict.
They are one test change, comments, wording, four added deviations or
qualifications, and some added information with no bar.

### What was reproduced

- **Reports and freeze.** The dev and fresh reports are byte-identical
  when rebuilt from the committed tree. The freeze check is 17 / 17. The
  shipped `createVoiceHoldRef` equals the normative code of §3.1 + §3.5 on
  800 000 fuzzed ticks (0 mismatches).
- **Chain and hook runs.** Independent re-runs of 60 speech streams and 40
  noise streams (dev and fresh; cold start through `hold-noise-run.mjs`,
  after speech through `as-run.mjs`) gave chain records identical field for
  field and hook records identical byte for byte. tLast, tCut and the
  pairing tables were rebuilt the same way.
- **Data.** The screen classes, the disjointness from dev, the licences
  (12 Freesound pages and the Zenodo record) and all 191 clip hashes check
  out.
- **This stage.**
  - The fresh report rerun with a 4096 MB cap is byte-identical.
  - `scripts/resonance/mobile/narrow-review-info.mjs` (below) reproduces
    the report's BASE and K4 row of every real-noise stream: 764 / 764
    fresh and 628 / 628 dev.

### Findings and what was done

**Review 1 (pre-registration):**
1. *Medium: the pre-plan descriptive statistics came close to a replay.*
   They computed K2–K4's arming predicate and outcome proxies on dev (§5.1:
   K3's hold coverage, a proxy for K2's T-QUIET, K4's −6 vs −3 dB
   reference), so K4 over K3 was an in-sample, partly tuned choice.
   **Accepted.** §5.1 already said so. The Verdict now adds that K4 won the
   tie-break by about 0.05 points and that only K4 was tested on fresh
   data. **Lesson for later rounds:** compute no candidate's own predicate,
   coverage or outcome proxy on the selection data before the plan, or
   split dev into a design half and a selection half.
2. *Low: voicing summaries in the confirmation records* (`pitchStats`,
   computed before the pushes, never printed or read). **Accepted:** added
   as deviation 10.
3. *Low: deviation 1 misdescribed the silent-preview rule's effect.*
   **Accepted:** corrected in place. The only change to the final list is
   fs__583249 → fs__388097, one speech-free clip. The "people nearby" swap
   held only in the base list, which extension 1 superseded: fs__543817
   and fs__857741 are both in the final list.
4. *Low: the fresh report ran with a 6 GB memory cap, not 4 GB.*
   **Accepted:** added as deviation 11. The rerun at 4096 MB is
   byte-identical, and the Reproduce block now says 4096.
5. *Low: the guards had little power against nearby talkers.*
   **Accepted:** see "How strong the evidence is" in the Verdict.

**Review 2 (app code):**
6. *Medium: the wiring test pinned the sha256 of the whole hook.* Any later
   hook change would fail `npm run test:unit` (CI and deploy), and
   `guided-exercises`' hook already differs. **Accepted.** The whole-file
   hash is gone. Four structural checks replace it, on what the hold reads
   from the hook:
   - the analysis handler takes `intensity` from the DSP frame;
   - all 3 throttled updaters set it;
   - it is null in the initial state and after `stop()`;
   - the hook returns `...state`.

   The four checks pass on this branch's hook and on the hooks of
   `origin/main` and `origin/guided-exercises`. The wiring test now has 21
   checks (it had 18). That the hook is unchanged on this branch rests on
   the round's harness (`narrow-freeze.json`, `pause-row.mjs` hint
   equality) and on git: `git diff 7e00e59 HEAD --
   src/audio/useAudioPipeline.js` is empty (LF sha256 `03f07112…`, the same
   as `origin/main`).
7. *Low: stale comments in `cueStripModel.js`.* They still described C1 as
   the wired hold. **Accepted:** the header, the `cueRowStates` doc and the
   `createTrail` comment now describe K4 as the wired hold and C1 as the
   reference arm. All three sit outside function bodies, so the frozen
   `toString()` hashes stay 17 / 17. The tick comment in `CueStrip.jsx` now
   names the level-drop case (finding 8). Both are comment-only changes.
8. *Low: a mid-session voice-level drop was never measured.* K4 counts an
   own-voice tick only within 6 dB of the median of the last 60 s of
   margin-qualified shown ticks. **Accepted:** added to the Verdict's
   limits. The rule is frozen and unchanged.

   The reviewer's synthetic probe, re-run as
   `scripts/resonance/mobile/narrow-level-drop-probe.mjs` (quiet room;
   cycles of 3 s of voice, 1 s of silence hold and an onset-blink tick;
   the voice drops after 60 s; fixed seed):

   | voice drop | trail clears in the next 90 s, K4 / BASE | mean trail, K4 / BASE | last blink that clears the trail |
   |---|---|---|---|
   | 0 dB | 0 / 21 | 15.0 / 1.4 | none |
   | 4 dB | 0 / 21 | 15.0 / 1.4 | none |
   | 7 dB | 1 / 21 | 11.7 / 1.4 | 12.0 s after the drop |
   | 10 dB | 6 / 21 | 8.5 / 1.4 | 33.3 s after the drop |

   The reviewer's run continued one random draw across the drops and got
   7 clears and a trail of 7.8 at 10 dB; the other figures are the same.
   K4 is never below BASE here: it acts only where BASE is idle (G4). A
   level step (for example −32 → −40 dBFS) belongs in the phone and
   headset session or the next round.
9. *Low: the voice gate's off and no-decision paths were never measured.*
   Every guard used gate-on records (`pause-row.mjs` skips the rest).
   **Accepted** as a stated limit in the Verdict.

   **Declined: the optional gate-off replay.** The existing chain records
   hold only the resonance posts made with gate-on hints. With the gate
   off, the resonance worker gets voiced hints on noise that the pitch
   chain voices, so its positions differ. A fair replay needs new
   resonance-chain runs with gate-off hints. That is a new measurement,
   not a fix of this round.

**Review 3 (numbers):**
10. *Medium: the "speech-free" class includes voiced scenes.* 60 of its 160
    fresh clips are TV, café, station or people recordings that Silero
    scored S = 0.
    **Accepted in substance.** The class name is the plan's (F5, §6), so it
    stays in the tables and bars. The Verdict now describes it as the clips
    the screen heard no speech in, and reports the split below. Checked on
    the −40 dBFS cold-start pitch caches:
    - 20 of those 60 have FireRedVAD "voice" together with posted pitch on
      10.4–64.9 % of pitch messages;
    - in the 102 clips of the speech-free metadata family, only fs__513489
      (a power pylon on a contact mic) reaches 10 % (17.9 %).

    The three clips named in the review do carry voices, by their list
    metadata:
    - fs__873562 "Muffled TV Program #7", tagged television / tv / program
      / show;
    - fs__333960 "indoor_ apartments_hall_noise 2", tagged television / tv
      / voice / voices / people;
    - fs__569649 "One.wav", tagged Television / Number / Weird.

    The direction is conservative. These clips face the stricter
    speech-free bars (+1.0 pooled), so PASS is not weakened.
11. *Low: the talker class reached 30 by one clip.* Two of its 31 clips are
    machine room tones (fs__403670 "ROOM TONE_KITCHEN", fs__182600 "Room
    Tone House") with a 2–3 s voice-like event that both detectors agree
    on. **Accepted:** see the Verdict.
    One correction to the review: neither clip has any K4 excess in any
    cell, but one is not at 0 %. fs__182600 after speech at L1 is drawn
    2.09 % in BASE and in K4. C1 adds +4.47 on fs__403670 after speech, at
    both levels.
12. *Low: the per-clip margin depends on timing.* **Accepted:** the noise
    timing rows are below. Every cell keeps every bar under both options,
    on fresh and dev data. Under `arrival40` (phone-like 40 ms capture
    buffers), the muffled-TV clip after speech at L1 comes to +14.66 (bar
    +15).
13. *Low: the after-speech window can catch the end of the reader's own
    speech.* In noise, the chain can post and show the reader's last words
    later than tLast, which comes from the speech-alone run. Example: dev
    fs__365255 at −48. Its tLast is 26.85 s, but the noisy mix's last
    posted voiced message before tCut + 1 s is at 27.975 s, and the hook
    last shows voice at 28.425 s. K4's hold of those words then runs to
    33.325 s, past the window's start at 32.850 s. That 0.5 s is this
    clip's whole excess (+1.84, BASE 0 %). This adds to K4's measured cost,
    so the guard is conservative. The tLast + 7 s rows (Information, fresh)
    already bound it. **Accepted:** stated here; no rule change.
14. *Minor: "12 of 191 from a cold start" holds per level.* There are 13
    distinct clips over both levels. **Accepted:** corrected in place.

### Information added (no bar)

Both tables come from `node --max-old-space-size=4096
scripts/resonance/mobile/narrow-review-info.mjs --set=fresh|dev`. It
replays BASE and K4 with `pause-report.mjs` `stripReplay` exactly as
`narrow-report.mjs` does, and checks its nominal rows against the report's.

**The screen class by metadata family** (nominal; K4 − BASE drawn, pooled,
in points):

| set | screen class | metadata family | clips | cold L1 | cold L2 | after L1 | after L2 | worst clip | BASE drawn |
|---|---|---|---|---|---|---|---|---|---|
| fresh | speech-free | speech-free (machines, traffic, weather, appliances) | 100 | +0.00 | +0.01 | +0.01 | +0.07 | +4.40 | 0.00–2.78 % |
| fresh | speech-free | talker (TV, café, station, people) | 60 | +0.31 | +0.17 | +0.32 | +0.57 | +14.17 | 10.21–25.42 % |
| fresh | talker | speech-free (2 room tones) | 2 | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | 0.00–1.07 % |
| fresh | talker | talker | 29 | +1.03 | +1.02 | +0.66 | +1.02 | +7.90 | 49.60–62.58 % |
| dev | speech-free | speech-free | 100 | +0.05 | +0.04 | +0.03 | +0.02 | +4.67 | 0.55–4.16 % |
| dev | speech-free | talker | 50 | +0.00 | +0.00 | +0.09 | +0.13 | +4.10 | 2.88–14.78 % |
| dev | talker | speech-free | 2 | +0.00 | +0.00 | +0.00 | +2.72 | +5.33 | 2.83–27.36 % |
| dev | talker | talker | 5 | +0.00 | +0.00 | +0.11 | +0.48 | +2.29 | 13.12–28.85 % |

**Noise guards under the timing options.** K4 − BASE drawn, pooled / the
worst clip, in points. `tickJitter150` uses one fixed seed (20261101).
Every §9 bar is recomputed on each option's BASE.

| fresh cell | clips | nominal | tickJitter150 | arrival40 |
|---|---|---|---|---|
| speech-free L1 −48, cold | 160 | +0.12 / +14.17 (fs__873562) | +0.11 / +13.96 (fs__873562) | +0.12 / +14.21 (fs__873562) |
| talker L1 −48, cold | 31 | +0.97 / +5.92 (fs__161929) | +0.96 / +6.25 (fs__161929) | +0.96 / +7.54 (fs__161929) |
| speech-free L1 −48, after | 160 | +0.13 / +7.48 (fs__873562) | +0.10 / +5.72 (fs__873562) | +0.15 / +14.66 (fs__873562) |
| talker L1 −48, after | 31 | +0.62 / +7.28 (fs__594415) | +0.38 / +3.42 (fs__660748) | +0.64 / +5.20 (fs__594415) |
| speech-free L2 −40, cold | 160 | +0.07 / +7.67 (fs__873562) | +0.09 / +7.67 (fs__873562) | +0.10 / +7.67 (fs__873562) |
| talker L2 −40, cold | 31 | +0.96 / +7.50 (fs__161929) | +1.03 / +7.63 (demand__OMEETING__3) | +1.08 / +10.67 (fs__161929) |
| speech-free L2 −40, after | 160 | +0.26 / +11.64 (fs__873562) | +0.25 / +11.64 (fs__873562) | +0.28 / +11.64 (fs__873562) |
| talker L2 −40, after | 31 | +0.95 / +7.90 (demand__OMEETING__3) | +0.86 / +7.47 (fs__161929) | +0.86 / +7.80 (demand__OMEETING__3) |

Every bar holds in all 24 fresh cells and all 24 dev cells. On dev the
largest single clip under any option is +5.92 (fs__254493, talker L2 after
speech, `tickJitter150`).

### Checks after the fixes

The changes were comment-only in `src/` plus the wiring test, and G5 was
re-run in full on the final tree:
- `npm run lint`: clean.
- `npm run test:unit`: 76 / 76 (including `tests/site/no-local-paths-test.js`).
- `npm run build`: OK.
- The cue-strip tests: model 167 / 167, geometry 8 / 8, voice-gate display
  48 / 48, wiring 21 / 21.
- `scripts/cue-strip-smoke.mjs`: phone 97 / 97, p402 97 / 97, p360 97 / 97,
  desktop 103 / 103.
- `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`: 78 / 78.
- The frozen hashes: 17 / 17 unchanged.

### Local folder paths (2026-11-02)

2026-11-02: local folder paths replaced by placeholders in this note,
`resonance-row-hold-2026-10-28.md`, `narrow-confirm-noise-list.json` (its
`root`), `narrow-confirm-readers.json` (the archive's `file`), the default
paths and comments of `as-run.mjs`, `screen-silero.mjs`,
`hold-noise-run.mjs`, `hold-noise-fetch.py`, `narrow-confirm-chain.mjs`,
`narrow-confirm-noise-fetch.py`, `narrow-confirm-librispeech-fetch.py` and
`ft-clips.mjs`, and the side-by-side kit's README and Chrome hints (no data
change). `../Syrinx-cache/` is the local data cache beside the repo (not
published); the scripts' defaults now resolve to it from the repo's own
folder, the same folder as before. Local evidence copies are named by
their folder only (`seen/`, `g5-working-copy-K4/`, `confirm/`).
- The earlier sha256 `9d59d8b30c8c…` of `narrow-confirm-noise-list.json`
  refers to commit fd60472. It is now `249b7a5f2f3b…`, and so is the
  `listSha256` in `narrow-screen.json` (`sets.fresh`) and in
  `narrow-confirm-screen.json`.
- The screens' `scriptSha256` `cfdcbba3057c…` (also in the list's
  `screen`) is left as recorded: it is `screen-silero.mjs` at fd60472,
  the version that ran. The edited script differs only in comments and
  default paths.
- Checked after the edit: all 191 confirmation clips and all 157 dev clips
  are found under the new default folders with their list sha256;
  `screen-silero.mjs --set=fresh --only=fs__240634` gives the committed
  row; the freeze check is 17 / 17.

### After the round (2026-11-02, display text only, outside the frozen functions)

- **One microphone sentence in the resonance info** (chosen 2026-11-02).
  Old, two sentences: "Your microphone, room and distance shift the whole
  scale, so trust how the marker moves more than where it sits. Readings
  depend on the microphone and how you hold or wear it, so compare
  yourself on one device, held or worn the same way." New, one sentence:
  "Your microphone, how you hold or wear it, the room and distance all
  shift the whole scale, so compare yourself on one device used the same
  way, and trust how the marker moves more than where it sits." The
  streak sentence of §11 ("… in a noisy room it can start over sooner,
  about 1 s into a pause.") is unchanged.
- **"(last reading)" for screen readers** (chosen 2026-11-02). While a
  row is "holding", its 1 Hz summary (`cueSummary`, `[data-cue-sr]`) says
  so: the pitch row "Pitch level N Hz (last reading)" when it keeps a
  level, the resonance row "Resonance (approximate, last reading): …"
  in the silence-gate hold and in K4's hold. The visible words are
  unchanged.
- **Outside the freeze.** `RESONANCE_INFO` and `cueSummary` are not
  among the frozen items; the freeze check is 17 / 17 after the change.
  No state, hold, trail or position changes.
- **Checks:** `npm run lint` clean; `npm run test:unit` 76 / 76 (cue-strip
  model 172 / 172, wiring 26 / 26); on a build of the change,
  `scripts/cue-strip-smoke.mjs` phone, p402, p360 and landscape 97 / 97,
  desktop 103 / 103, and `scripts/resonance-lab/lab-layout-smoke.mjs
  --panel=0` 78 / 78.
- **Hand check on a phone.** On a Pixel phone over the dev server, the
  K4 hold kept the resonance marker when speech stopped. No numbers were
  recorded; the measured phone / headset session stays paused.

### Still open

- **Paused (user decision 2026-11-02):** the phone and headset session (kit
  at 7e00e59), with a mid-session voice level step. One session with the
  test sound only ran on 2026-11-01 (status at the top). *(2026-11-02: K4
  was checked by hand on a Pixel phone — the hold keeps the marker when
  speech stops; no numbers, so the measured session stays paused.
  "After the round".)*
- The gate-off and no-decision paths: new chain runs with gate-off hints.
- **Resolved 2026-11-02:** screen readers read a held pause as a live
  position. Decided and built the same day: the summary says "(last
  reading)" while a row is holding, both rows ("After the round").
