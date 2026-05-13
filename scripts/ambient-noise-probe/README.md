# Ambient Noise Probe

Standalone diagnostic utility for identifying persistent narrowband
tonal sources in a recording environment. **Not integrated into
Syrinx production.** Use this when SwiftF0 pitch detection is
reporting suspiciously wrong values (e.g., reporting 175 Hz when
the user's actual F0 is 85-95 Hz) — the probe identifies tonal
interference sources that could be confusing the model.

Background: see the negative-finding investigation at commit
`pitch-half-period-octave-fix` branch. Frame-local autocorrelation
fixes don't work when the interferer dominates the signal, so the
remaining mitigation paths are either (a) noise-reduction
front-end (Direction D, not pursued), or (b) identify and
physically remove the interference source (Direction F, this
tool).

## Running it

Mic capture (`getUserMedia`) requires HTTPS or `localhost`, so the
HTML must be served — `file://` won't work.

### Option 1: Node http-server (no extra install)

```
npx serve scripts/ambient-noise-probe
```

Then open the URL printed by the command (typically
`http://localhost:3000`).

### Option 2: Python

```
cd scripts/ambient-noise-probe
python -m http.server 8000
```

Open `http://localhost:8000`.

### Option 3: Vite dev server

If a Syrinx dev server is already running (`npm run dev`), you
can copy `index.html` to a different directory and serve it
separately — but easier to use Option 1 or 2.

## What to do

1. Open the page, click "Start probe".
2. Grant mic permission. **Do NOT speak** — the probe is
   characterizing AMBIENT noise.
3. Wait 5-10 seconds while the running average accumulates.
4. Look at the peak table:
   - **Red rows (prominence ≥ 18 dB)**: strong narrowband
     tonal source. Likely culprit for pitch-detection failures.
   - **Amber rows (prominence ≥ 10 dB)**: moderate narrowband
     tonal source. May confuse pitch detection.
   - **Gray rows**: weak or broadband. Less likely to be the
     issue.
5. Peaks marked "in speech F0 range" (75-300 Hz) are
   particularly concerning — they directly overlap with the
   range pitch detectors search.

## Interpreting peaks

- **50 / 60 Hz**: electrical mains hum. Indicates a ground loop
  or poorly-shielded equipment. Pretty hard to remove without
  fixing wiring.
- **100 / 120 Hz**: mains 2nd harmonic. Same source as mains hum.
- **80-200 Hz with -12 dB/oct rolloff and harmonics at 2×, 3×, ...**:
  classic motor / compressor signature. Refrigerator, HVAC unit,
  pump, fan with brushless motor.
- **200-400 Hz**: small motors, fans, transformer harmonics.
- **Sharp peak at one frequency**: room standing wave or
  resonance. Try the formula `room dimension cm = 17150 / peak Hz`
  and see if it matches a wall-to-wall distance — if yes, the
  room is acoustically resonating at that frequency.

## Privacy

Audio capture is local. No recording is stored, no data leaves
the device. Stop the probe and close the tab to release the mic.

## When to use

- After Syrinx pitch trace looks wrong on your voice (especially
  reported 2 × your actual F0).
- Before reporting a Syrinx pitch issue, to characterize whether
  the cause is in-room interference.
- When moving to a new recording environment (different room,
  different mic) and want to assess acoustic quality.

## Limitations

- This is just a spectrum probe. It identifies the WHAT (what
  frequencies are present) but not the WHERE (which physical
  source). Identifying the source is a manual investigation: try
  turning off / unplugging suspected devices one at a time and
  re-running the probe.
- Peaks below 50 Hz aren't shown (HVAC rumble, traffic, etc. —
  not typically a pitch-detection issue).
- The probe doesn't tell you whether the interferer is loud
  enough to actually cause pitch failures — that depends on the
  ratio between the interferer level and your voice level at the
  mic. A prominence ≥ 15 dB peak in the speech F0 range is
  empirically enough to cause SwiftF0 octave-up failures (see
  the harmonic-stack reproducer test in the
  pitch-half-period-octave-fix branch).
