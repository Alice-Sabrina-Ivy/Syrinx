// build.mjs — reproducible WebAssembly build of WORLD + the spike's C API
// (wasm/vp_world.cpp) for the voice-preview spike (measurements/voice-preview-spike-2026-10-12.md §P2a).
//
//   node scripts/voice-preview/build.mjs [--install] [--repro] [--only=simd|nosimd]
//
//   --install  clone emsdk at the pinned commit and install + activate the pinned
//              release (downloads ~760 MB into VP_CACHE/emsdk; archives are kept
//              and their sha256 recorded), and fetch WORLD at the pinned commit
//   --repro    build everything a second time from clean output directories with a
//              fresh Emscripten system-library cache and require byte-identical output
//
// Pins (checked on every run; the script refuses to build from anything else):
//   WORLD   mmorise/World 8d79b88b7dd92e8a132996cf74080b2d6f881b98 (2024-10-23; the
//           commit pyworld 0.3.5 bundles), LICENSE.txt sha256 below
//   emsdk   6.0.10, emsdk commit a2b92777574c2feda07994cd4f1079a3dfc151f8 (2026-09-21)
// Output: VP_CACHE/wasm/<simd|nosimd>/vp_world.{mjs,wasm} and VP_CACHE/wasm/build-info.json
// (sha256, raw / gzip -9 / brotli q11 sizes, WebAssembly feature list, exact command lines).
// Nothing is written inside the repository.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { P, VP_DIR, CACHE } from "./lib/paths.mjs";

export const PINS = {
  world: {
    repo: "https://github.com/mmorise/World.git",
    commit: "8d79b88b7dd92e8a132996cf74080b2d6f881b98",
    licenseSha256: "cb19c28611fcee6ce200c075a0e5bc91f0dcb0637985797b830990d2fe2fcffe",
  },
  emsdk: {
    repo: "https://github.com/emscripten-core/emsdk.git",
    commit: "a2b92777574c2feda07994cd4f1079a3dfc151f8",
    version: "6.0.10",
    // archives emsdk downloads for 6.0.10 on Windows x64 (recorded 2026-10-12)
    winArchives: {
      "666337b525e673e769121856d175f6f52b8ead64-wasm-binaries.zip": "6de0bf6bad8214a89dedafb5db3cdcfbdf8c395e421ba257e83cb21b77030931",
      "node-v24.19.0-win-x64.zip": "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
      "python-3.13.3-0-win-amd64.zip": "6fe7a540c6b8b185780467cf7495e884ee62316ec4abb19e1c735b8a77c62465",
    },
  },
};

// WORLD sources the C API needs (codec.cpp / synthesisrealtime.cpp are not used).
const WORLD_SOURCES = ["cheaptrick", "common", "d4c", "dio", "fft", "harvest", "matlabfunctions", "stonemask", "synthesis"];
export const EXPORTS = [
  "_malloc", "_free", "_vp_version", "_vp_dio_frames", "_vp_harvest_frames", "_vp_dio", "_vp_harvest",
  "_vp_stonemask", "_vp_cheaptrick_fft_size", "_vp_cheaptrick", "_vp_d4c", "_vp_warp",
  "_vp_synthesis_length", "_vp_synthesize",
];
const VARIANTS = { simd: ["-msimd128"], nosimd: [] };

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((s) => s.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
function run(cmd, argv, { cwd, env, quiet } = {}) {
  const r = spawnSync(cmd, argv, { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${r.status})\n${r.stdout}\n${r.stderr}`);
  }
  if (!quiet && r.stderr.trim()) process.stderr.write(r.stderr);
  return r.stdout.trim();
}
const git = (cwd, ...a) => run("git", a, { cwd, quiet: true });

function emsdkPython() {
  const pyRoot = path.join(P.emsdk, "python");
  if (existsSync(pyRoot)) {
    for (const d of readdirSync(pyRoot)) {
      const exe = path.join(pyRoot, d, process.platform === "win32" ? "python.exe" : "bin/python3");
      if (existsSync(exe)) return exe;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function installEmsdk() {
  if (!existsSync(P.emsdk)) {
    mkdirSync(path.dirname(P.emsdk), { recursive: true });
    run("git", ["clone", "--quiet", PINS.emsdk.repo, P.emsdk]);
  }
  git(P.emsdk, "fetch", "--quiet", "origin", PINS.emsdk.commit);
  git(P.emsdk, "checkout", "--quiet", PINS.emsdk.commit);
  const py = process.platform === "win32" ? "python" : "python3"; // emsdk bootstraps with the system Python
  const env = { EMSDK_KEEP_DOWNLOADS: "1", EMSDK_NOTTY: "1" };
  run(py, ["emsdk.py", "install", PINS.emsdk.version], { cwd: P.emsdk, env });
  run(py, ["emsdk.py", "activate", PINS.emsdk.version], { cwd: P.emsdk, env }); // writes emsdk/.emscripten only
}

function fetchWorld() {
  if (!existsSync(P.world)) {
    mkdirSync(P.world, { recursive: true });
    git(P.world, "init", "--quiet");
    git(P.world, "remote", "add", "origin", PINS.world.repo);
  }
  git(P.world, "fetch", "--quiet", "--depth", "1", "origin", PINS.world.commit);
  git(P.world, "checkout", "--quiet", PINS.world.commit);
}

function checkPins() {
  const out = {};
  if (!existsSync(path.join(P.emsdk, "emsdk.py"))) throw new Error(`no emsdk at ${P.emsdk} (run with --install)`);
  const eh = git(P.emsdk, "rev-parse", "HEAD");
  if (eh !== PINS.emsdk.commit) throw new Error(`emsdk at ${eh}, expected ${PINS.emsdk.commit}`);
  const ev = JSON.parse(readFileSync(path.join(P.emsdk, "upstream/emscripten/emscripten-version.txt"), "utf8"));
  if (ev !== PINS.emsdk.version) throw new Error(`emscripten ${ev}, expected ${PINS.emsdk.version}`);
  out.emsdk = { commit: eh, version: ev, archives: {} };
  const dl = path.join(P.emsdk, "downloads");
  if (existsSync(dl)) {
    for (const f of readdirSync(dl).sort()) {
      const h = sha256(readFileSync(path.join(dl, f)));
      out.emsdk.archives[f] = h;
      const want = process.platform === "win32" ? PINS.emsdk.winArchives[f] : undefined;
      if (want && want !== h) throw new Error(`emsdk archive ${f}: sha256 ${h}, expected ${want}`);
    }
  }
  if (!existsSync(path.join(P.world, "LICENSE.txt"))) throw new Error(`no WORLD source at ${P.world} (run with --install)`);
  const wh = git(P.world, "rev-parse", "HEAD");
  if (wh !== PINS.world.commit) throw new Error(`WORLD at ${wh}, expected ${PINS.world.commit}`);
  const dirty = git(P.world, "status", "--porcelain");
  if (dirty) throw new Error(`WORLD tree is modified:\n${dirty}`);
  const lh = sha256(readFileSync(path.join(P.world, "LICENSE.txt")));
  if (lh !== PINS.world.licenseSha256) throw new Error(`WORLD LICENSE.txt sha256 ${lh}, expected ${PINS.world.licenseSha256}`);
  out.world = { commit: wh, licenseSha256: lh };
  return out;
}

export function emccArgs(variant, outFile) {
  return [
    "-O3", ...VARIANTS[variant],
    "-fno-exceptions",
    `-I${path.join(P.world, "src")}`,
    // keep absolute paths out of the output (reproducible from any checkout)
    `-ffile-prefix-map=${P.world}=world`, `-ffile-prefix-map=${VP_DIR}=vp`,
    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createVpWorld",
    "-sENVIRONMENT=web,worker,node",
    "-sFILESYSTEM=0", "-sALLOW_MEMORY_GROWTH=1",
    `-sEXPORTED_FUNCTIONS=${EXPORTS.join(",")}`,
    "-sEXPORTED_RUNTIME_METHODS=HEAPF64",
    path.join(VP_DIR, "wasm", "vp_world.cpp"),
    ...WORLD_SOURCES.map((s) => path.join(P.world, "src", `${s}.cpp`)),
    "-o", outFile,
  ];
}

function emcc(argv, emCache) {
  const env = { EM_CONFIG: path.join(P.emsdk, ".emscripten") };
  if (emCache) env.EM_CACHE = emCache;
  return run(emsdkPython(), [path.join(P.emsdk, "upstream/emscripten/em++.py"), ...argv], { env, quiet: true });
}

// Features binaryen (wasm-opt, from the same emsdk) needs enabled to read and validate
// the module: start from MVP + a candidate set, require that it validates, then drop
// every candidate the module validates without. The result is the minimal feature set
// the module uses. Anything outside the candidates (threads, exception handling, GC,
// memory64, relaxed SIMD, tail calls, ...) would make the first validation fail.
const FEATURE_CANDIDATES = [
  "sign-ext", "mutable-globals", "bulk-memory", "bulk-memory-opt", "nontrapping-float-to-int",
  "simd", "multivalue", "reference-types", "call-indirect-overlong", "extended-const",
];
function features(wasmFile) {
  const bin = path.join(P.emsdk, "upstream/bin", process.platform === "win32" ? "wasm-opt.exe" : "wasm-opt");
  const sink = process.platform === "win32" ? "NUL" : "/dev/null";
  const ok = (fs) => spawnSync(bin, [wasmFile, "--mvp-features", ...fs.map((f) => `--enable-${f}`), "-o", sink], { encoding: "utf8" }).status === 0;
  if (!ok(FEATURE_CANDIDATES)) return ["(uses a feature outside: " + FEATURE_CANDIDATES.join(", ") + ")"];
  let used = [...FEATURE_CANDIDATES];
  for (const f of FEATURE_CANDIDATES) if (ok(used.filter((u) => u !== f))) used = used.filter((u) => u !== f);
  return used;
}

function sizes(buf) {
  return {
    raw: buf.length,
    gzip9: gzipSync(buf, { level: 9 }).length,
    brotli11: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
  };
}

function buildAll(root, emCache) {
  const res = {};
  for (const v of Object.keys(VARIANTS)) {
    if (opt("only") && opt("only") !== v) continue;
    const dir = path.join(root, v);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, "vp_world.mjs");
    const argv = emccArgs(v, outFile);
    const t0 = Date.now();
    emcc(argv, emCache);
    const wasm = readFileSync(path.join(dir, "vp_world.wasm"));
    const glue = readFileSync(outFile);
    res[v] = {
      seconds: (Date.now() - t0) / 1000,
      command: ["em++", ...argv.map((a) => a.split(CACHE).join("$VP_CACHE").split(VP_DIR).join("<repo>/scripts/voice-preview"))].join(" "),
      wasm: { sha256: sha256(wasm), ...sizes(wasm) },
      glue: { sha256: sha256(glue), ...sizes(glue) },
      features: features(path.join(dir, "vp_world.wasm")),
    };
    console.log(`${v}: wasm ${wasm.length} B (gzip ${res[v].wasm.gzip9}, br ${res[v].wasm.brotli11}) sha256 ${res[v].wasm.sha256}; ` +
      `glue ${glue.length} B; features [${res[v].features.join(", ")}]; ${res[v].seconds.toFixed(1)} s`);
  }
  return res;
}

if (flag("install")) { installEmsdk(); fetchWorld(); }
const pins = checkPins();
const emver = emcc(["--version"]).split(/\r?\n/)[0];
console.log(`emsdk ${pins.emsdk.version} @ ${pins.emsdk.commit}; ${emver}\nWORLD @ ${pins.world.commit}`);
const builds = buildAll(P.wasm, null);
const info = { date: new Date().toISOString(), pins: PINS, checked: pins, emcc: emver, builds };
if (flag("repro")) {
  const rr = path.join(CACHE, "wasm-repro");
  const cacheDir = path.join(CACHE, "emcache-repro");
  rmSync(cacheDir, { recursive: true, force: true });
  const again = buildAll(rr, cacheDir);
  info.repro = {};
  for (const v of Object.keys(again)) {
    const same = again[v].wasm.sha256 === builds[v].wasm.sha256 && again[v].glue.sha256 === builds[v].glue.sha256;
    info.repro[v] = { identical: same, wasmSha256: again[v].wasm.sha256, glueSha256: again[v].glue.sha256 };
    console.log(`repro ${v}: ${same ? "byte-identical" : "DIFFERENT"}`);
    if (!same) process.exitCode = 1;
  }
  rmSync(rr, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
}
writeFileSync(path.join(P.wasm, "build-info.json"), JSON.stringify(info, null, 1));
console.log(`wrote ${path.join(P.wasm, "build-info.json")}`);
