# Phone vs headset: the side-by-side session

A ~15-minute session with your own devices that settles three questions from
[the diagnosis note](../../../../measurements/resonance-phone-vs-desktop-2026-10-28.md) (§6):

- **(a)** On the *same* sound, does the Pixel's built-in mic path or the
  Maxwell boom read darker / brighter, and by how much?
- **(b)** Why does the phone's resonance meter swing less: the microphone's
  frequency response, room noise, or the phone's speed?
- **(c)** Is the phone's pause floor in the "dropout" range, where the
  resonance thumb and the pitch number disappear about a second into every
  pause?

Both devices run the normal app (the deployed site, nothing changed in it).
The kit only listens alongside it: it records what each microphone captured,
what the app computed, and what the meter showed.

**Privacy.** The session records your voice.
- Everything is saved under `build/resonance-mobile/sbs/runs/`, which git
  ignores. Nothing from it is ever committed or uploaded. Temporary copies the
  analysis makes stay inside the run folder (`analysis/`, `replay-tmp/`, the
  latter deleted when done).
- **Nothing to send back.** Tell Claude the session is done, and Claude reads
  the run folder on this PC.
- **For whoever writes up the results:** only the test-sound results (the
  phone / boom response, its prediction on the public readers) and the device
  diagnostics (timing, dropouts on the test sound) may go into a public note in
  `measurements/`. Everything measured on your own voice (holds, tries,
  placements, the pause floor of your own speech, the cued silences) goes to
  the private project only (CLAUDE.md §Private session data).

The kit is in this repo, under `scripts/resonance/mobile/sbs/` (added on
branch `resonance-mobile`). Every command below runs from the repo root.

## One-time setup

1. **Desktop Chrome with the debug port.** Your normal Chrome can stay open:
   with its own `--user-data-dir` this starts a separate Chrome. In PowerShell:

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="$env:TEMP\chrome-debug-profile"
   ```

   Any folder outside your normal Chrome profile will do; use the same one
   every time, so the microphone choice below is kept.

   - Check that <http://localhost:9223/json/version> answers.
   - In that Chrome, open `chrome://settings/content/microphone` and choose
     the **Maxwell**.
   - Keep one empty tab open: the session opens its own window and closes only
     that window afterwards.
   - The session grants the app the microphone in that profile. If the window
     still asks, click **Allow**.
   - Leave the Maxwell's noise filter as you normally use it. The session asks
     you for its setting and records it.
2. **The Pixel.**
   - In Developer options, turn on **USB debugging** and **Stay awake**.
   - Plug the phone in by USB and set USB to "File transfer".
   - Accept "Allow USB debugging" with "Always allow".
   - Unlock the phone and bring Chrome to the front.
   - `adb devices` should list exactly one device.
   - **The session closes every other Syrinx tab on the phone** (a second
     listening copy would load the phone and hold the microphone). If one of
     them is recording a practice session, save it first.
   - The USB cable has to reach the "chest height" and "on the desk 40 cm
     away" placements. If it doesn't, use wireless debugging (below).
3. **A loudspeaker.** Any speaker that is not the Pixel or the Maxwell will
   do: PC speakers, a laptop, or a tablet.
   - Copy `build/resonance-mobile/sbs/sound/sbs-test.wav` to it. If the file
     is missing, make it with
     `node scripts/resonance/mobile/sbs/sbs-sound.mjs`.
   - Set the volume to about a normal speaking voice at 25 cm.
   - To let this PC play the sound itself, add
     `--play-pc="<repo>\build\resonance-mobile\sbs\sound\sbs-test.wav"`
     to the session command, with `<repo>` the full path of this repo's
     folder. **It plays through Windows' default playback device**, which on
     this PC is currently the Maxwell. The session checks the device and
     refuses when it is the headset. Set the PC speakers as the default first
     (Windows Settings > System > Sound > Output).

### Wireless debugging (needed for the dongle step; optional otherwise)

The Pixel's only USB-C port is needed for the Maxwell's dongle in the optional
last step, so the session must reach the phone over Wi-Fi instead:

1. Phone and PC on the same Wi-Fi.
2. Developer options > **Wireless debugging** > on.
3. Tap "Pair device with pairing code", then on the PC run
   `adb pair <ip>:<pairing port> <code>` with the numbers it shows.
4. On the Wireless debugging screen, note "IP address & Port", then run
   `adb connect <ip>:<port>`.
5. Run the session with `--phone-serial=<ip>:<port>`.
   - The screen is kept on for the session over Wi-Fi.
   - Your "Stay awake" setting is restored at the end.

## The session

From the repo root:

```
node scripts/resonance/mobile/sbs/sbs-session.mjs
```

Optional flags:
- `--dongle` adds the optional last step. It needs wireless debugging.
- `--play-pc=<wav>` lets this PC play the test sound.
- `--phone-serial=<serial>` picks the phone when more than one device is
  connected.

The terminal names each step and counts it down. Steps that need you ready
wait for **Enter**. **Ctrl+C** at any point stops cleanly and keeps everything
recorded so far: it does the end clock sync, closes the desktop window and
removes the phone link.

1. **Start (about 1 min).**
   - Both devices open the app.
   - The desktop starts listening by itself.
   - **Tap Start on the phone** (the goal sheet's "Start practicing"). If it
     asks for the microphone, allow it.
   - The terminal says when both are listening. It also warns if the desktop
     microphone is not the Maxwell, and if the phone page it watches is not
     the one in front.
   - It prints which microphone the phone records from.
   - It asks for the Maxwell's noise-filter setting (type e.g. `off`, `low`,
     `high`, then Enter).
2. **Claps (6 s).** Clap three times between the two mics.
3. **Room (30 s).** Stay quiet. This measures each microphone's room floor.
4. **Test sound (about 3.5 min).**
   - Take the headset off.
   - Put the boom and the phone side by side, about 25 cm in front of the
     loudspeaker, with the phone's microphone end toward the speaker. The
     terminal names that end: normally the **bottom end** (the main mic); the
     back mic if the phone reports it. Nothing should touch them.
   - Press Enter, start the sound, and stay quiet until it ends.
   - The sound has clicks, noise, a sweep, and two public LibriSpeech readers
     whose voices are made brighter and darker for a few seconds at a time.
5. **Your voice (about 3 min).** Put the headset on and hold the phone the way
   you did when you saw the difference.
   - Read the passage shown for 60 s.
   - Four 8 s holds: brighter, then darker, twice, with your normal voice
     between them.
   - Four 3 s quick tries.
   - Four times, say one sentence and then stay silent for 3 s. Watch the
     phone: does the resonance thumb vanish?
6. **Phone placements (about 1.5 min).** For each, read 20 s, then stay silent
   4 s:
   - the phone's mic about 5 cm from the corner of your mouth;
   - the phone at chest height;
   - the phone lying on the desk 40 cm away.
7. **Optional, with `--dongle`** (wireless debugging only).
   - Plug the Maxwell's USB dongle into the Pixel.
   - On the phone, tap **Turn Mic off** and start again.
   - Read 30 s, then play the test sound once more next to the boom.
   - This compares the phone with the boom as its microphone against the
     desktop with the same boom.
8. **Claps again (6 s).**

When it ends, the terminal prints the run folder.

### If something goes wrong

- **"no phone on ADB" / "unauthorized"**: unlock the phone, accept the USB
  debugging prompt, then run again.
- **"N devices on ADB"**: USB and Wi-Fi are both connected. Pass
  `--phone-serial=` with one of the serials shown.
- **"no Chrome debugging endpoint on port 9223"**: the debug Chrome is not
  running. Start it with the command above.
- **"desktop microphone is …, not the maxwell"**: in the debug Chrome, choose
  the Maxwell in `chrome://settings/content/microphone`. Then tap Turn Mic off
  and start again, or Ctrl+C and rerun.
- **"the Syrinx page the session is watching is hidden"**: bring that tab to
  the front. On the phone it is the newest Syrinx tab; the session has closed
  the others.
- **"pulls are failing … reconnecting"**: the link to that device dropped (a
  cable, Wi-Fi, or Chrome's debugger). The session reconnects by itself. The
  page keeps recording meanwhile, holding up to ~3 minutes of audio, so
  nothing is lost if the link comes back within that time.
- **"no capture chunks seen on the page"**: the phone fell back to its
  AudioContext capture path. The session still records the app's posts and
  the meter, but not the raw audio, so there is no transfer function.
- **The phone's resonance meter never starts** (stays "starting" or shows an
  error): the kit's small hook on the resonance worker may not load on that
  Chrome. Ctrl+C and rerun with `--worker-hook=0`. The meter and the posts are
  still recorded. Each post's audio time is then estimated from when it
  reached the page (a few tens of ms late), and the relay lag and worker CPU
  figures are missing.
- **"the PC's default playback device is … the headset"**: see setup step 3.

### Optional follow-up: is it the headset's noise filter?

If the analysis says the pink / sweep / speech estimates disagree (it names the
filter setting you gave), repeat only the test sound with the filter **off**:

```
node scripts/resonance/mobile/sbs/sbs-session.mjs --protocol=sound --tag=filter-off
```

## What is recorded (for Claude)

Each device folder (`phone/`, `desktop/`) holds:
- `log.jsonl`: one line per one-second pull from the page logger.
- `pcm.f32` and `pcm.jsonl`: the exact chunks the workers got.
- `clock.jsonl`: the clock syncs.
- `meta.json`: the device, the pull statistics and any reconnects.
- On the phone: `dumpsys-*.txt` and `dumpsys-summary-*.json`, the Android
  audio input path (source or preset, device, rate) while listening and at the
  end.

`session.json` holds the steps' times, the headset's noise-filter setting,
the PC playback device used for `--play-pc`, and how the session stopped.

The page logger (`sbs-logger.mjs`) is injected before the app loads. It does
not change `src/`. It records:
- every capture chunk: time, contextTime, level, and the samples;
- every pitch-worker message, including the voice detector's decision;
- every DSP frame's intensity;
- every resonance-worker post. The worker is started through a small hook
  that adds the chunk and hint times it had seen.
- the cue strip's states, value and thumb, both as they change and as a 4 Hz
  sample;
- long tasks, and the microphone track's label and settings.

Its own main-thread cost is small: one pass over each 25 ms chunk, and one
pull per second.

Analysis (about 10 minutes; everything is on by default):

```
node scripts/resonance/mobile/sbs/sbs-analyze.mjs --session=<run folder>
```

writes `analysis/analysis.md` and `analysis/analysis.json` in the run folder:

- **alignment:** the test sound in each capture, from the chunk-level
  envelope, then refined to the sample with the two click trains;
- **transfer function:** the phone / boom response in 1/3 octaves from 200 Hz
  to 8 kHz, from the pink noise, the sweep and the readers' speech, each
  device's room floor subtracted. The speech estimate is the one used: a
  headset noise filter can treat steady pink noise as noise. A large
  disagreement between the three in 0.8–5 kHz is flagged.
- **levels:** clipping, a test sound too quiet against the room, and a check
  against the claps that the sound came from the loudspeaker and not from
  next to one microphone;
- **(a) is decided on the prediction:** the response turned into a
  linear-phase FIR and run through `chain.mjs` on the 12 public readers
  (`sbs-predict.mjs`; bias, steady sensitivity, 3 / 5 / 8 s excursions, with a
  bootstrap CI over readers). The note's §6 thresholds apply to these.
  - The prediction refuses to run if the resonance chain files in this
    worktree differ from `origin/main`.
- **cross-check, the meter on the same sound:** the phone − boom bias and
  swing of the meter on the two test readers. Two captures of the same sound
  differ by up to ~0.2 u per reader on their own, so this cannot decide
  anything by itself.
  - Its noise band (2.5 sd) comes from replaying each capture 6 times through
    the real workers with another chunk phase and level.
  - It is compared with what the measured response predicts on the *same*
    events: the boom's capture passed through the response and replayed.
  - "Not consistent" means something beyond a fixed frequency response
    differs: a noise filter, gain control or compression in one path, or the
    runtime.
- **pause floor and display:** from the logged frames, with the cue strip's
  own state as ground truth:
  - a thumb dropout that starts at least 0.3 s before speech resumes counts as
    *inside* the pause (the noisy-floor dropout, ~0.8 s after the last voiced
    frame). One that starts later is the onset blink.
  - The regime is judged on 1.5–5 s pauses as the screen showed them. The
    floor gives three labels: quiet below −54 dBFS, near the threshold from
    −54 to −49, dropout above.
  - The trail and the streak.
- **the real hook:** replayed over the logged messages, giving the idle
  causes;
- **runtime health:** capture holes, dispatch / pitch / relay lag, voice
  detector status, dropped frames, resonance worker ms per audio second, long
  tasks, pull errors and reconnects;
- **replay:** each capture through the REAL workers in Node, compared with its
  live meter on the same-sound levels and post by post (the share that
  differs by > 0.05 u);
- **verdict:** the note's §6 rules applied in plain words.

Flags `--no-predict`, `--no-noise`, `--no-replay` and `--no-hook` skip parts.
`--shards=<n>` sets the prediction's parallel processes (default 4; use 2 when
the PC is busy).

## Checking the kit without a phone

```
node scripts/resonance/mobile/sbs/sbs-validate.mjs
```

builds the app from `origin/main` (a clean `git archive`), makes the test
sound, a copy through a known FIR and a null copy (1.337 s later, −5 dB). It
then records with spawned Chromes (their fake microphones play the WAVs):
- the cued protocol, time-scaled;
- a two-device session on identical inputs, with the phone half in its
  `--dry-run` form;
- one device on the FIR copy;
- the voice protocol with a Syrinx tab already open on the "phone";
- the null session, with the desktop's link dropped once on purpose;
- a session whose terminal input ends at once;
- one device on the test sound over a steady −44 dBFS pink floor, the
  dropout regime's positive control.

It then checks:
- the logger, the alignment and the transfer function;
- the prediction deciding (a), and the cross-check with its noise band
  (consistent on the FIR, the null inside the band);
- the pause classification on quiet pauses;
- the replays;
- the reconnect, the duplicate-tab closing, and the clean stop on Ctrl+C or
  closed input.

Every spawned Chrome and server is killed by its own PID.

## Files

| file | what |
|---|---|
| `sbs-session.mjs` | both devices at once, clock sync, cued protocol, clean stop |
| `sbs-phone.mjs`, `sbs-desktop.mjs` | one device each (`--dry-run=<CDP url>` / `--spawn=<wav>` for checks) |
| `sbs-device.mjs` | CDP client, recorder with reconnect, desktop attach / spawn, phone over ADB (USB or wireless) |
| `sbs-logger.mjs` | the injected page logger and the resonance-worker hook |
| `sbs-audio-out.ps1` | Windows' default playback device (read-only), for `--play-pc` |
| `sbs-sound.mjs` | the test sound |
| `sbs-analyze.mjs`, `sbs-align.mjs`, `sbs-load.mjs`, `sbs-dsp.mjs` | the analysis |
| `sbs-predict.mjs` | the response as an FIR through `chain.mjs` on public readers |
| `sbs-replay.mjs` | a logged capture through the real workers (re-chunked / filtered variants; `chain.mjs`) |
| `sbs-hook.mjs` | the real hook over the logged messages (idle causes) |
| `sbs-validate.mjs`, `sbs-validate-checks.mjs` | the kit's own check |
