# WORLD

`LICENSE.txt` is WORLD's licence file at the commit the voice preview's WebAssembly module
is built from (mmorise/World `8d79b88b7dd92e8a132996cf74080b2d6f881b98`, sha256
`cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe`, checked by
`scripts/voice-preview/build.mjs` and `tests/voice-preview/wasm-files-test.js`). WORLD
(M. Morise) is under the modified BSD licence, which requires this text with binary
copies: `src/voice-preview/wasm/{simd,nosimd}/vp_world.wasm` contain compiled WORLD code.
`scripts/third-party-notices.mjs` appends it to the built site's `THIRD_PARTY_NOTICES.txt`
whenever the build contains that module.
