# variants.py NAME PATCH[=VAL] ... — candidate src trees for the low-register
# voicing pass (2026-10-04; private measurement, kept outside this repo):
# copies ./src to build/trees/NAME/src and applies named patches to
# boersma-ac.js / pitch-worker.js (each asserts its anchor matched exactly
# once). The trees are scored by run_variant.sh + table.py. Patch names are
# the variant names used in the measurement file (vt, vuc, deb, ratio, ih,
# ihk, odd, odd3, need, hp, hs, g3, lvl, rx, pf).
import sys, os, shutil, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
TMPL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guard_fn.js.tmpl")
BAC = "dsp/boersma-ac.js"
PW = "dsp/pitch-worker.js"


def sub1(text, old, new):
    assert text.count(old) == 1, f"anchor count {text.count(old)}: {old[:60]!r}"
    return text.replace(old, new)


IH_FLOOR = '''    const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
    const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
    const band = [];
    for (let b = flo; b <= fhi; b++) band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);'''
IH_NEW = '''    const band = [];
    {
      const lobe = 2 / (buffer.length / sampleRate) + __LOBEPAD__;
      const w = Math.max(f0 - lobe, lobe + 2 * binHz);
      for (let b = Math.max(1, Math.floor((f - w) / binHz)); b <= Math.min(half - 1, Math.ceil((f + w) / binHz)); b++) {
        const df = Math.abs(b * binHz - f);
        if (df < lobe) continue;
        if (f0 - df < lobe && df <= w) continue;
        band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);
      }
      if (band.length < 4) {
        band.length = 0;
        const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
        const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
        for (let b = flo; b <= fhi; b++) band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);
      }
    }'''


G2_OLD_HEAD = """  let count = 0;
  for (let k = 1; k <= 4; k++) {
    const f = k * f0;
    if (f > sampleRate / 2 - 100) break;"""
G2_NEW_HEAD = """  let count = 0;
  const pdb = [0, -99, -99, -99, -99, -99];
  for (let k = 1; k <= 5; k++) {
    const f = k * f0;
    if (f > sampleRate / 2 - 100) break;"""
G2_OLD_TAIL = """    if (peak >= ratio * floor) count++;
  }
  return count;"""
G2_NEW_TAIL = """    pdb[k] = 10 * Math.log10(peak / floor + 1e-12);
    if (k <= 4 && peak >= ratio * floor) count++;
  }
  if (__HS__ && Math.max(pdb[3], pdb[5]) < __HSLO__ && Math.min(pdb[2], pdb[4]) >= __HSHI__) return 0;
  return count;"""

HP_BLOCK = """    if (oe && cands.length > 1) {
      // HP: candidates above the display range whose sub-multiple f = F/k
      // (k = 2..maxK) is a candidate with prominent non-multiple partials
      const m = cands.length;
      for (let i = 0; i < m; i++) pen[i] = 0;
      for (let i = 0; i < m; i++) {
        const F = cands[i].freq;
        if (F <= 420) continue;
        for (let j = 0; j < m; j++) {
          const f = cands[j].freq;
          if (j === i || f > 400) continue;
          const k = Math.round(F / f);
          if (k < 2 || k > __MAXK__ || Math.abs(F / (k * f) - 1) > 0.03) continue;
          if (nonMultipleProminenceDb(f, k) >= __THR__) { pen[i] = __PEN__; break; }
        }
      }
      for (let i = 0; i < m; i++) cands[i].strength -= pen[i];
    }
"""
NMP_FN = """  function nonMultipleProminenceDb(f, k) {
    let sn = 0, nn = 0, sm = 0, nm = 0;
    for (let m = 2; m <= oe.maxMultiple && m * f < oe.fMaxHz; m++) {
      const x = m * f;
      const half = Math.min(0.03 * x, 0.2 * f);
      const v = 0.5 * (meanPow(x - 0.5 * f, 0.1 * f) + meanPow(x + 0.5 * f, 0.1 * f));
      const prom = DB * Math.log(peakPow(x, half) / v);
      if (m % k) { sn += prom; nn++; } else { sm += prom; nm++; }
    }
    return (nn ? sn / nn : 0) - (nm ? sm / nm : 0);
  }

"""


def patch(files, name, val):
    if name == "vt":
        files[BAC] = sub1(files[BAC], "voicingThreshold: 0.35,", f"voicingThreshold: {val},")
    elif name == "vuc":
        files[BAC] = sub1(files[BAC], "voicedUnvoicedCost: 0.20,", f"voicedUnvoicedCost: {val},")
    elif name == "ojc":
        files[BAC] = sub1(files[BAC], "octaveJumpCost: 0.15,", f"octaveJumpCost: {val},")
    elif name == "deb":
        files[BAC] = sub1(files[BAC], "{ ratio = 10, debounce = 4 } = {}", f"{{ ratio = 10, debounce = {val} }} = {{}}")
    elif name == "ratio":
        files[BAC] = sub1(files[BAC], "export function createHarmonicVoicingGuard({ ratio = 10,", f"export function createHarmonicVoicingGuard({{ ratio = {val},")
    elif name == "ih":  # inter-harmonic floor (val = lobe pad Hz, default 5)
        files[BAC] = sub1(files[BAC], IH_FLOOR, IH_NEW.replace("__LOBEPAD__", val or "5"))
    elif name == "ihlow":  # inter-harmonic floor only when f0 < val Hz
        new = IH_NEW.replace("__LOBEPAD__", "5").replace("    const band = [];\n    {", f"    const band = [];\n    if (f0 < {val}) {{", 1)
        new += '''
    else {
      const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
      const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
      for (let b = flo; b <= fhi; b++) band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);
    }'''
        files[BAC] = sub1(files[BAC], IH_FLOOR, new)
    elif name == "hp":  # high-partner arbitration: val = "penalty,thrDb,maxK"
        pen, thr, maxk = (val or "0.1,-3,8").split(",")
        files[BAC] = sub1(files[BAC], """    let bestR = 0;
    for (const c of cands) if (c.r > bestR) bestR = c.r;""", HP_BLOCK.replace("__PEN__", pen).replace("__THR__", thr).replace("__MAXK__", maxk) + """    let bestR = 0;
    for (const c of cands) if (c.r > bestR) bestR = c.r;""")
        files[BAC] = sub1(files[BAC], """  // Window autocorrelation, computed once.""", NMP_FN + """  // Window autocorrelation, computed once.""")
    elif name == "odd":  # count >= 2 only if an odd harmonic (k = 1 or 3) passed
        files[BAC] = sub1(files[BAC], """    if (peak >= ratio * floor) count++;
  }
  return count;""", """    if (peak >= ratio * floor) { count++; if (k & 1) oddPass = true; }
  }
  return oddPass ? count : Math.min(count, 1);""")
        files[BAC] = sub1(files[BAC], """  let count = 0;
  for (let k = 1; k <= 4; k++) {""", """  let count = 0, oddPass = false;
  for (let k = 1; k <= 4; k++) {""")
    elif name == "need":
        files[BAC] = sub1(files[BAC], "if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2) {", f"if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= {val}) {{")
    elif name == "odd3":  # count >= 2 only if H3 (or H5 when val == "35") passed
        files[BAC] = sub1(files[BAC], """    if (peak >= ratio * floor) count++;
  }
  return count;""", """    if (peak >= ratio * floor) { if (k === 5) oddPass = true; else { count++; if (k === 3) oddPass = true; } }
  }
  return oddPass ? count : Math.min(count, 1);""".replace("__H5__", "true" if val == "35" else "false"))
        files[BAC] = sub1(files[BAC], """  let count = 0;
  for (let k = 1; k <= 4; k++) {""", """  let count = 0, oddPass = false;
  for (let k = 1; k <= 5; k++) {
    if (k === 5 && (oddPass || !__H5__)) break;""".replace("__H5__", "true" if val == "35" else "false"))
    elif name == "ihk":  # inter-harmonic floor only for harmonics k >= val (k below keeps the prod band)
        new = IH_NEW.replace("__LOBEPAD__", "5").replace("    const band = [];\n    {", f"    const band = [];\n    if (k >= {val}) {{", 1)
        new += """
    else {
      const flo = Math.max(1, Math.floor((f * 0.65) / binHz));
      const fhi = Math.min(half - 1, Math.ceil((f * 1.35) / binHz));
      for (let b = flo; b <= fhi; b++) band.push(s.re[b] * s.re[b] + s.im[b] * s.im[b]);
    }"""
        files[BAC] = sub1(files[BAC], IH_FLOOR, new)
    elif name == "hs":  # half-signature veto: lo,hi (dB) on the guard's own floors; k loop to 5
        lo, hi = (val or "8,12").split(",")
        files[BAC] = sub1(files[BAC], G2_OLD_HEAD, G2_NEW_HEAD)
        files[BAC] = sub1(files[BAC], G2_OLD_TAIL, G2_NEW_TAIL.replace("__HS__", "true").replace("__HSLO__", lo).replace("__HSHI__", hi))
    elif name == "g3":  # whole-function guard: need,ihkmax,ihratio,hs(0/1),hslo,hshi
        need, ihkmax, ihratio, hs, hslo, hshi = (val or "5,8,10,1,8,12").split(",")
        fn = open(TMPL, encoding="utf8").read()
        fn = (fn.replace("__KMAX__", str(max(int(ihkmax), 5))).replace("__IHKMAX__", ihkmax).replace("__IHRATIO__", ihratio)
                .replace("__HS__", "true" if hs == "1" else "false").replace("__HSLO__", hslo).replace("__HSHI__", hshi).replace("__NEED__", need))
        t = files[BAC]
        a = t.index("export function harmonicStructureCount(")
        b = t.index("// createHarmonicVoicingGuard")
        files[BAC] = t[:a] + fn + chr(10) + t[b:]
    elif name == "lvl":  # level-gated relaxed guard: theta[,ihkmax]  (relaxed = k1 prod + ih k2..ihkmax >= 2)
        theta, ihkmax = ((val or "0.3") + ",4").split(",")[:2]
        fn = open(TMPL, encoding="utf8").read()
        fn = (fn.replace("__KMAX__", str(max(int(ihkmax), 5))).replace("__IHKMAX__", ihkmax).replace("__IHRATIO__", "ratio")
                .replace("__HS__", "false").replace("__HSLO__", "0").replace("__HSHI__", "0").replace("__NEED__", "99"))
        fn = fn.replace("      if (peak >= ratio * floor) count++;", "      if (peak >= ratio * floor) { count++; if (k === 1) k1 = 1; }")
        fn = fn.replace("  let count = 0, ihCount = 0;", "  let count = 0, ihCount = 0, k1 = 0;")
        fn = fn.replace("  if (false &&", "  _lastRelaxed = k1 + ihCount;" + chr(10) + "  if (false &&")
        fn = "let _lastRelaxed = 0;" + chr(10) + fn
        t = files[BAC]
        a = t.index("export function harmonicStructureCount(")
        b = t.index("// createHarmonicVoicingGuard")
        t = t[:a] + fn + chr(10) + t[b:]
        t = sub1(t, """    check(buffer, f0, sampleRate) {
      if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2) {""", """    check(buffer, f0, sampleRate, level = 0) {
      if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2 || (level >= THETA && _lastRelaxed >= 2)) {""".replace("THETA", theta))
        t = sub1(t, "    return { voiced: cands, unvoicedStrength };", "    return { voiced: cands, unvoicedStrength, level: localPeak / globalPeak };")
        files[BAC] = t
        files[PW] = sub1(files[PW], "    unvoicedStrength: frameCandidates.unvoicedStrength," + chr(10) + "  });", "    unvoicedStrength: frameCandidates.unvoicedStrength," + chr(10) + "    level: frameCandidates.level || 0," + chr(10) + "  });")
        files[PW] = sub1(files[PW], "!harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)", "!harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE, meta.level)")
    elif name == "rx":  # relaxed guard (OR on top of prod): theta,rule  rule R1=(k1+ih2..4>=2)&ih3  R2=(ih2..5>=3)&(ih3|ih5)
        theta, rule = (val or "0,R2").split(",")
        fn = open(TMPL, encoding="utf8").read()
        fn = (fn.replace("__KMAX__", "5").replace("__IHKMAX__", "5").replace("__IHRATIO__", "ratio")
                .replace("__HS__", "false").replace("__HSLO__", "0").replace("__HSHI__", "0").replace("__NEED__", "99"))
        fn = fn.replace("      if (peak >= ratio * floor) count++;", "      if (peak >= ratio * floor) { count++; if (k === 1) k1 = 1; }")
        fn = fn.replace("  let count = 0, ihCount = 0;", "  let count = 0, ihCount = 0, k1 = 0; const ih = [0, 0, 0, 0, 0, 0];")
        fn = fn.replace("        if (k <= 5 && peak >= ratio * floor) ihCount++;", "        if (k <= 5 && peak >= ratio * floor) { ihCount++; ih[k] = 1; }")
        expr = {"R1": "(k1 + ih[2] + ih[3] + ih[4] >= 2) && ih[3] === 1", "R2": "(ih[2] + ih[3] + ih[4] + ih[5] >= 3) && (ih[3] + ih[5] >= 1)"}[rule]
        fn = fn.replace("  if (false &&", "  _lastRelaxed = " + expr + ";" + chr(10) + "  if (false &&")
        fn = "let _lastRelaxed = false;" + chr(10) + fn
        assert "ih[k] = 1" in fn and "k1 = 1" in fn
        t = files[BAC]
        a = t.index("export function harmonicStructureCount(")
        b = t.index("// createHarmonicVoicingGuard")
        t = t[:a] + fn + chr(10) + t[b:]
        t = sub1(t, """    check(buffer, f0, sampleRate) {
      if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2) {""", """    check(buffer, f0, sampleRate, level = 0) {
      if (harmonicStructureCount(buffer, f0, sampleRate, ratio) >= 2 || (level >= THETA && _lastRelaxed)) {""".replace("THETA", theta))
        t = sub1(t, "    return { voiced: cands, unvoicedStrength };", "    return { voiced: cands, unvoicedStrength, level: localPeak / globalPeak };")
        files[BAC] = t
        files[PW] = sub1(files[PW], "    unvoicedStrength: frameCandidates.unvoicedStrength," + chr(10) + "  });", "    unvoicedStrength: frameCandidates.unvoicedStrength," + chr(10) + "    level: frameCandidates.level || 0," + chr(10) + "  });")
        files[PW] = sub1(files[PW], "!harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)", "!harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE, meta.level)")
    elif name == "pf":
        files[BAC] = sub1(files[BAC], "peakFloor: 0.15,", f"peakFloor: {val},")
    else:
        raise SystemExit(f"unknown patch {name}")


if __name__ == "__main__":
    name, specs = sys.argv[1], sys.argv[2:]
    dst = f"{ROOT}/build/trees/{name}/src"
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(f"{ROOT}/src", dst)
    files = {}
    for rel in (BAC, PW):
        files[rel] = open(f"{dst}/{rel}", encoding="utf8").read()
    for sp in specs:
        k, _, v = sp.partition("=")
        patch(files, k, v)
    for rel, txt in files.items():
        open(f"{dst}/{rel}", "w", encoding="utf8").write(txt)
    print("tree", name, specs)
