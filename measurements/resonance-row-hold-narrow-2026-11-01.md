# Resonance row: a narrower hold through pauses (2026-11-01)

Branch `resonance-hold-narrow` (from `resonance-mobile` 7e00e59; `main` is
9e1696b). Public data only. Follows
[resonance-row-hold-2026-10-28.md](resonance-row-hold-2026-10-28.md), whose
candidate C1 (hold the resonance row for 5 s after the last shown voice, any
noise floor) passed its speech targets and failed its noise guard, and
[resonance-phone-vs-desktop-2026-10-28.md](resonance-phone-vs-desktop-2026-10-28.md)
§5 (the onset blink and the noisy-pause dropout).

Owner decision 2026-11-01: "Try a narrower version in a new measured round"
(instead of adopting C1 or reverting it). On the branch only: no PR, no merge.

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
  pre-registered by the owner's decision.

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
- Adding "(last reading)" stays a separate owner decision. It is not part
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

This is the owner's second example, taken literally. It holds while the
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
script), are copied to
`C:/Coding Projects/_oneshot/resonance-hold-narrow/seen/` (outside the
repo). Its `MANIFEST.sha256` (36 files; Appendix A) has sha256
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
  `C:/Coding Projects/Syrinx-cache/resonance-lab/data/train-clean-100.tar.gz`;
- its MD5 checked against the same folder's `md5sum.txt` **before any
  member is extracted**; a mismatch deletes the download and stops;
- extracted in one pass, only `LibriSpeech/train-clean-100/<id>/` for the
  first 8 readers of each sex — men 26, 27, 60, 78, 118, 163, 196, 201;
  women 19, 32, 39, 40, 83, 87, 89, 103 — into
  `C:/Coding Projects/Syrinx-cache/resonance-lab/data/LibriSpeech/`
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
`C:/Coding Projects/Syrinx-cache/noise-real-narrow/` (outside the repo). The
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
  `C:/Coding Projects/Syrinx-cache/models/silero/`.
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
| 1.3 (medium) | The seen record left out the compared alternatives; evidence in a scratchpad. | §5.1 names every alternative and says dev is in-sample. stats4–7 re-run unchanged to files; everything copied to `_oneshot` with a sha256 manifest (Appendix A); the desc4 sentence corrected (its output was in a file). |
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

`C:/Coding Projects/_oneshot/resonance-hold-narrow/seen/MANIFEST.sha256`
(sha256 of the manifest file:
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
