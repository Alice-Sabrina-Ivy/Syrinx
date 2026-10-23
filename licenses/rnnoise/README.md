# RNNoise

`COPYING` is RNNoise's licence file at xiph/rnnoise `372f7b4b76cde4ca1ec4605353dd17898a99de38`
(2024-04-16, RNNoise 0.2), the commit Voice Shaper's noise-reduction module is built from.
RNNoise (J.-M. Valin, Xiph.Org, Mozilla, Amazon) is under the BSD 3-clause licence, which requires
this text with binary copies: `src/voice-preview/rnnoise/rnnoise.wasm` contains compiled RNNoise
code and its model weights. `scripts/third-party-notices.mjs` appends it to the built site's
`THIRD_PARTY_NOTICES.txt` whenever the build contains that module.

The module is the RNNoise 0.2 build that the npm package `@jitsi/rnnoise-wasm` 0.2.1
(git `cb529a59a8478fe604e57986fc96afdaecfa6fb7`, whose `rnnoise` submodule is at the commit above)
embeds in `dist/rnnoise-sync.js`, taken out unchanged by `scripts/voice-preview/extract-rnnoise.mjs`
(sha256 pins in `src/voice-preview/denoise.js`). Jitsi compiled it with Emscripten 3.1.14
(`emscripten/emsdk:3.1.14`, the package's Dockerfile), so it also contains Emscripten's emmalloc and
a few libc routines — Emscripten's MIT / University of Illinois NCSA licence, the text in
[licenses/emscripten/LICENSE](../emscripten/LICENSE). `jitsi-rnnoise-wasm-LICENSE` is the package's
own licence file (Apache-2.0, for Jitsi's build scripts), copied unchanged.
