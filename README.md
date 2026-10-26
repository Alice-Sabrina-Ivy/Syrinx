# Syrinx

A free voice training toolkit that runs in your browser. It shows your pitch and resonance live from your microphone and keeps your practice sessions on your own device.

**[Open Syrinx](https://alice-sabrina-ivy.github.io/Syrinx/)**

The name comes from the syrinx, the vocal organ of songbirds, and from a Greek myth about transformation.

## Why it exists

Voice training is one of the most useful parts of transition, and one of the least well served by tools. The tools that exist each cover only part of it:

- **Pitch-only apps** track pitch and nothing else. Pitch matters, but it doesn't decide on its own how a voice is heard: resonance does much of the work, especially in the range where adult voices overlap in pitch.
- **Praat** is the standard tool for acoustic analysis, but it is built for phoneticians, not for practice.
- **Commercial coaching apps** are mostly subscription-based and closed-source.

Syrinx aims to give live feedback on more than pitch, for free, privately and with nothing to install.

## Who it's for

Voice training in any direction. Each time you open it, Syrinx asks what you're aiming for (more feminine, more masculine, androgynous or in between, or just exploring) and sets its targets from your answer. It never assumes a direction.

- Trans and gender-diverse people training toward a more feminine, more masculine or more androgynous voice, including following voice changes on testosterone
- Voice coaches who want a free practice tool for clients between sessions
- Anyone working on their voice on purpose, such as singers and speakers

## Design principles

1. **Nothing to install.** No download, no account, no sign-up: open the page, allow the microphone and start.
2. **Your voice stays on your device.** All audio analysis runs in your browser, and there is no server your voice could be sent to. Sessions are stored in your browser and leave it only if you export them. The app is served from GitHub Pages, and the voice models some features use are downloaded from the project's own Hugging Face account. No analytics, no tracking.
3. **More than pitch, but only what can be measured.** Syrinx shows pitch and resonance today. A cue is added only after it has been tested on public speech recordings, and its known limits are stated in the app. Vocal weight and clarity are not shown, because no measure for them has passed that test yet.
4. **Simple first.** The Dashboard shows a few cues you can read at a glance. Experimental features are labelled as experimental, and the research view (the Resonance lab) stays hidden unless you turn it on in Settings.
5. **Phones first.** Most people practise on their phones, so layouts are designed and checked on phone screens first.

## Roadmap

Ideas not built yet are in [ROADMAP.md](ROADMAP.md). The original plan from March 2026 is archived at [docs/archive/ARCHITECTURE-original-plan-2026-03.md](docs/archive/ARCHITECTURE-original-plan-2026-03.md).

## License

Syrinx is released under the [MIT License](LICENSE). Third-party libraries, models and data keep their own licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
