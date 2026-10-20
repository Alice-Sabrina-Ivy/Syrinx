# Emscripten runtime and system libraries in the voice preview's WebAssembly module

`src/voice-preview/wasm/vp_world.mjs` (the JavaScript glue) and the two `vp_world.wasm`
builds were produced by Emscripten 6.0.10 (emsdk commit
`a2b92777574c2feda07994cd4f1079a3dfc151f8`, emscripten `d6c521a7f05449857c76bd99e396895583cf2083`;
`scripts/voice-preview/build.mjs`). The glue is Emscripten's JavaScript runtime; the
`.wasm` files link parts of Emscripten's system libraries (musl libc, dlmalloc, LLVM
compiler-rt, libc++ and libc++abi). Their licence texts, copied unchanged from that
emsdk release:

| File | Source in the emsdk (`upstream/emscripten/`) | Licence | sha256 |
|---|---|---|---|
| `LICENSE` | `LICENSE` | MIT / University of Illinois NCSA | `620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86` |
| `musl-COPYRIGHT` | `system/lib/libc/musl/COPYRIGHT` | MIT | `b870108ec5e7790e9f9919064f1b9421d62d5f9b0e6c230c6adf7ea2da62e97b` |
| `dlmalloc-NOTICE.txt` | header of `system/lib/dlmalloc.c` (excerpt) | public domain (CC0) | — |
| `compiler-rt-LICENSE.TXT` | `system/lib/compiler-rt/LICENSE.TXT` | Apache-2.0 WITH LLVM-exception | `1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d` |
| `libcxx-LICENSE.TXT` | `system/lib/libcxx/LICENSE.TXT` | Apache-2.0 WITH LLVM-exception | `539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b` |
| `libcxxabi-LICENSE.TXT` | `system/lib/libcxxabi/LICENSE.TXT` | Apache-2.0 WITH LLVM-exception | `e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c` |

`scripts/third-party-notices.mjs` appends these texts to the built site's
`THIRD_PARTY_NOTICES.txt` whenever the build contains the voice preview's WebAssembly module.
