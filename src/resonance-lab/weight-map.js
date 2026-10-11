// weight-map.js — the weight × clarity lab view's binning, personal voice map
// and reading (pure; runs in the lab worker and in the Node tests).
//
// Spec: measurements/weight-lab-prototype-2026-10-08.md §4 (the sceptic
// checks' "C1a voice-map cells + C3b resonance gate" package).
//
//   * Posted pitch frames (25 ms) are pooled into absolute 1-s bins. A bin is
//     valid with >= 3 voiced frames that gave features and a voiced fraction
//     >= 0.3; it is a RUNNING-SPEECH bin when it is valid and also has voicing
//     breaks (voiced fraction <= 0.95, i.e. >= 2 unvoiced frames). A bin is
//     closed 1.5 s after its end so the VTLN bins for it have arrived.
//   * Per bin: mean w, mean c, F = mean log2 f0, Lb = power-mean frame level
//     (dBFS), median VTLN (ln alpha).
//   * Voice map: cells of 2 semitones x 4 dB, (floor(12 F / 2), floor(Lb / 4)),
//     filled during a guided mapping step (five prompts, 30 bins each or until
//     "next"); a cell is ready at >= 5 bins; the map is then FROZEN (no sliding
//     window). Units: the pooled within-cell SDs of w and c over ready cells —
//     the user's own 1-s variation (the spec's 0.268 teacher step is fitted on
//     unlicensed demos and is not shipped).
//   * Reading per bin: Rw = (w - cell mean w) / sdW, Rc = (c - cell mean c) / sdC;
//     displayed = median of the last 3 readable bins within the last 5 s.
//   * No reading (with a reason) when: gain control on / unknown; microphone
//     differs from the map's; not mapped; < 3 of the last 5 bins are running
//     speech; this bin not valid; its cell not ready; its VTLN missing or more
//     than 0.05 ln from the cell's median (resonance changed).

export const BIN_S = 1;
export const CLOSE_LAG_S = 1.5;
export const MIN_FEAT_FRAMES = 3;
export const MIN_VOICED_FRAC = 0.3;
export const MAX_RUNNING_VOICED_FRAC = 0.95;
export const CELL_ST = 2;
export const CELL_DB = 4;
export const CELL_READY_BINS = 5;
export const PROMPT_BINS = 30;
export const VTLN_GATE = 0.05;
export const RUNNING_WINDOW = 5;
export const RUNNING_MIN = 3;
export const DISPLAY_BINS = 3;
export const TRAIL_S = 10;

export const PROMPTS = [
  { key: "usual", label: "Talk in your usual voice" },
  { key: "softer", label: "A little softer" },
  { key: "louder", label: "A little louder" },
  { key: "higher", label: "A little higher in pitch" },
  { key: "lower", label: "A little lower in pitch" },
];

export const REASONS = {
  agc: "Gain control is on or unknown: loudness can't be matched",
  device: "New microphone: map your voice again",
  unmapped: "Not mapped yet",
  speech: "Speak in sentences: held vowels and single words mislead",
  voiced: "Waiting for voiced speech",
  cell: "Not mapped at this pitch / loudness",
  resonance: "Resonance changed: comparison paused",
};

export const cellOf = (F, Lb) => [Math.floor((12 * F) / CELL_ST), Math.floor(Lb / CELL_DB)];
const key = (pi, li) => `${pi},${li}`;

function median(a) {
  if (!a.length) return null;
  const s = Float64Array.from(a).sort();
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Centre of a pitch cell in Hz and the level range of a loudness cell. */
export const cellHz = (pi) => 2 ** (((pi + 0.5) * CELL_ST) / 12);
export const cellDb = (li) => [li * CELL_DB, (li + 1) * CELL_DB];

export function createWeightMap() {
  const open = new Map(); // bin index -> accumulator
  const vt = new Map();   // bin index -> [vtln values]
  const closed = [];      // recent closed bin summaries (last ~20)
  let lastT = -Infinity;
  let lastLevel = null;
  let capture = { autoGainControl: undefined, deviceId: undefined };

  let phase = "unmapped"; // unmapped | mapping | mapped
  let prompt = 0;
  let promptHave = 0;
  let cal = new Map();    // key -> {pi, li, w: [], c: [], v: []}
  let map = null;         // frozen: {deviceId, cells: {key: {pi, li, n, w, c, v}}, sdW, sdC, nReady}
  let note = null;
  let readings = [];      // [{b, rw, rc}]
  let display = null;     // {rw, rc}
  let trail = [];         // [{b, rw, rc}]
  let reason = REASONS.unmapped;
  let current = null;     // last valid bin's cell info
  let lastB = null;       // last closed bin index
  const counts = { bins: 0, valid: 0, readable: 0, paused: {} };

  function acc(b) {
    let a = open.get(b);
    if (!a) {
      a = { b, n: 0, voiced: 0, feat: 0, sw: 0, sc: 0, sf: 0, sp: 0 };
      open.set(b, a);
    }
    return a;
  }

  function capturedOk() { return capture.autoGainControl === false; }
  function deviceOk() { return !map || map.deviceId === capture.deviceId; }

  function freeze() {
    const cells = {};
    let ssW = 0, ssC = 0, dof = 0, nReady = 0;
    for (const [k, c] of cal) {
      const n = c.w.length;
      if (n < CELL_READY_BINS) continue;
      const mw = c.w.reduce((s, v) => s + v, 0) / n;
      const mc = c.c.reduce((s, v) => s + v, 0) / n;
      for (let i = 0; i < n; i++) { ssW += (c.w[i] - mw) ** 2; ssC += (c.c[i] - mc) ** 2; }
      dof += n - 1;
      nReady++;
      cells[k] = { pi: c.pi, li: c.li, n, w: mw, c: mc, v: median(c.v.filter((x) => x !== null)) };
    }
    const sdW = dof > 0 ? Math.sqrt(ssW / dof) : 0;
    const sdC = dof > 0 ? Math.sqrt(ssC / dof) : 0;
    if (!nReady || !(sdW > 0) || !(sdC > 0)) {
      phase = map ? "mapped" : "unmapped";
      note = "No part of your voice had 5 seconds of running speech at one pitch and loudness — try mapping again.";
      return;
    }
    map = { deviceId: capture.deviceId, cells, sdW, sdC, nReady, madeAt: Date.now() };
    phase = "mapped";
    note = null;
    readings = []; trail = []; display = null;
  }

  function runningOk(b) {
    let k = 0;
    for (const s of closed) if (s.b > b - RUNNING_WINDOW && s.b <= b && s.running) k++;
    return k >= RUNNING_MIN;
  }

  function closeBin(a) {
    const vv = vt.get(a.b) ?? [];
    vt.delete(a.b);
    const valid = a.feat >= MIN_FEAT_FRAMES && a.n > 0 && a.voiced / a.n >= MIN_VOICED_FRAC;
    const s = {
      b: a.b,
      voicedFrac: a.n ? a.voiced / a.n : 0,
      nFeat: a.feat,
      valid,
      running: valid && a.voiced / a.n <= MAX_RUNNING_VOICED_FRAC,
      w: a.feat ? a.sw / a.feat : null,
      c: a.feat ? a.sc / a.feat : null,
      F: a.feat ? a.sf / a.feat : null,
      Lb: a.feat ? 10 * Math.log10(a.sp / a.feat) : null,
      vtln: median(vv),
    };
    closed.push(s);
    lastB = s.b;
    if (closed.length > 20) closed.shift();
    counts.bins++;
    if (valid) counts.valid++;
    const run = runningOk(s.b);
    let cell = null;
    if (valid) {
      const [pi, li] = cellOf(s.F, s.Lb);
      cell = { pi, li };
      const frozen = map?.cells[key(pi, li)] ?? null;
      const calCell = cal.get(key(pi, li));
      current = { b: s.b, pi, li, hz: 2 ** s.F, dbfs: s.Lb, ready: !!frozen, n: frozen ? frozen.n : calCell ? calCell.w.length : 0 };
    }

    if (phase === "mapping") {
      if (valid && run && capturedOk()) {
        const k = key(cell.pi, cell.li);
        let c = cal.get(k);
        if (!c) { c = { pi: cell.pi, li: cell.li, w: [], c: [], v: [] }; cal.set(k, c); }
        c.w.push(s.w); c.c.push(s.c); c.v.push(s.vtln);
        promptHave++;
        if (current) current.n = c.w.length;
        if (promptHave >= PROMPT_BINS) advance();
      }
      reason = null;
      return;
    }

    let r = null;
    let cellRef = null;
    if (!capturedOk()) r = REASONS.agc;
    else if (map && !deviceOk()) r = REASONS.device;
    else if (phase !== "mapped") r = REASONS.unmapped;
    else if (!run) r = REASONS.speech;
    else if (!valid) r = REASONS.voiced;
    else {
      cellRef = map.cells[key(cell.pi, cell.li)];
      if (!cellRef) r = REASONS.cell;
      else if (s.vtln === null || cellRef.v === null || Math.abs(s.vtln - cellRef.v) > VTLN_GATE) r = REASONS.resonance;
    }
    if (r) {
      reason = r;
      display = null;
      counts.paused[r] = (counts.paused[r] ?? 0) + 1;
      return;
    }
    reason = null;
    counts.readable++;
    const rw = (s.w - cellRef.w) / map.sdW;
    const rc = (s.c - cellRef.c) / map.sdC;
    readings.push({ b: s.b, rw, rc });
    readings = readings.filter((x) => x.b > s.b - RUNNING_WINDOW).slice(-DISPLAY_BINS);
    display = { rw: median(readings.map((x) => x.rw)), rc: median(readings.map((x) => x.rc)), n: readings.length };
    trail.push({ b: s.b, rw: display.rw, rc: display.rc });
    trail = trail.filter((x) => x.b > s.b - TRAIL_S);
  }

  function advance() {
    prompt++;
    promptHave = 0;
    if (prompt >= PROMPTS.length) freeze();
  }

  function closeUpTo(t) {
    const keys = [...open.keys()].sort((x, y) => x - y);
    for (const b of keys) {
      if ((b + 1) * BIN_S + CLOSE_LAG_S > t) break;
      closeBin(open.get(b));
      open.delete(b);
    }
    for (const b of vt.keys()) if ((b + 1) * BIN_S + CLOSE_LAG_S + 5 < t) vt.delete(b);
  }

  return {
    setCapture(c) { capture = { autoGainControl: c?.autoGainControl, deviceId: c?.deviceId }; },
    /**
     * One posted pitch frame, in time order. f0 > 0 = voiced; res = the frame's
     * { w, c, level } (null when voiced but no features, or unvoiced).
     */
    frame(t, f0, res) {
      lastT = t;
      const a = acc(Math.floor(t / BIN_S));
      a.n++;
      if (f0 > 0) {
        a.voiced++;
        if (res && Number.isFinite(res.w) && Number.isFinite(res.c)) {
          a.feat++;
          a.sw += res.w; a.sc += res.c; a.sf += Math.log2(f0); a.sp += 10 ** (res.level / 10);
          lastLevel = { t, dbfs: res.level };
        }
      }
      closeUpTo(t);
    },
    /** One VTLN bin value (te = bin end, 150 ms bins). */
    vtln(te, s) {
      if (s === null || !Number.isFinite(s)) return;
      const b = Math.floor((te - 0.075) / BIN_S);
      if (!vt.has(b)) vt.set(b, []);
      vt.get(b).push(s);
    },
    startMapping() {
      if (!capturedOk()) return false;
      phase = "mapping"; prompt = 0; promptHave = 0; cal = new Map(); note = null;
      return true;
    },
    nextPrompt() { if (phase === "mapping") advance(); },
    finishMapping() { if (phase === "mapping") freeze(); },
    cancelMapping() { if (phase === "mapping") { phase = map ? "mapped" : "unmapped"; cal = new Map(); } },
    /** Restore a frozen map made earlier in this page visit (exportMap()). */
    restore(saved) {
      if (!saved?.cells || !(saved.sdW > 0) || !(saved.sdC > 0)) return false;
      map = { ...saved };
      phase = "mapped";
      readings = []; trail = []; display = null;
      return true;
    },
    exportMap() { return map ? { ...map } : null; },
    /** Offline end of stream (tests): close every open bin. */
    finish() { closeUpTo(Infinity); },
    snapshot() {
      const cells = [];
      if (phase === "mapping") {
        for (const c of cal.values()) cells.push({ pi: c.pi, li: c.li, n: c.w.length, ready: c.w.length >= CELL_READY_BINS });
      } else if (map) {
        for (const c of Object.values(map.cells)) cells.push({ pi: c.pi, li: c.li, n: c.n, ready: true });
      }
      const live = lastLevel && lastT - lastLevel.t < 1 ? lastLevel.dbfs : null;
      return {
        phase,
        prompt: phase === "mapping" ? { index: prompt, of: PROMPTS.length, label: PROMPTS[prompt]?.label, have: promptHave, need: PROMPT_BINS } : null,
        note,
        capture: { autoGainControl: capture.autoGainControl ?? null, deviceKnown: !!capture.deviceId },
        captureOk: capturedOk(),
        deviceOk: deviceOk(),
        map: map ? { nReady: map.nReady, sdW: map.sdW, sdC: map.sdC, madeAt: map.madeAt } : null,
        cells,
        current,
        liveDbfs: live,
        reading: display,
        reason: phase === "mapping" ? null : reason,
        trail: trail.map((x) => ({ age: (lastB ?? x.b) - x.b, rw: x.rw, rc: x.rc })),
        counts: { ...counts, paused: { ...counts.paused } },
      };
    },
  };
}
