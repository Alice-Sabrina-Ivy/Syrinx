// scenarios.mjs — held-note voice-training scenario grid (2026-10-04;
// round 1 adds 0.15 / 0.25 s catch breaths to the repeat families).
// Each scenario: { name, family, build(sr) -> { x, truthAt(t), holds:[[t0,t1]],
// promoF:[[fLo,fHi]] } }. truthAt = base F0 trajectory (vibrato/wander/jitter
// ride on top, all << the 8 % scoring tolerance).
import { synth, mulberry } from "./synth.mjs";

const VOW = ["a", "i", "u"];
const cents = (f, c) => f * Math.pow(2, c / 1200);

// speech-like voicing: syllables (0.12-0.30 s) with per-syllable base F0
// random-walking +-4 st around `center`, a +-2 st contour, vowel rotation,
// amplitude jitter +-3 dB; inter-syllable gaps 0.04-0.12 s carry a consonant
// noise burst (unvoiced, 50 % of the gaps) or silence.
function speechPlan(t0, dur, center, seed) {
  const rnd = mulberry(seed);
  const syl = [];
  let t = t0, st = 0;
  while (t < t0 + dur - 0.1) {
    const d = 0.12 + 0.18 * rnd();
    const end = Math.min(t + d, t0 + dur);
    st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3));
    syl.push({ a: t, b: end, f: cents(center, 100 * st), c: (rnd() - 0.5) * 400, v: VOW[Math.floor(rnd() * 3)], g: Math.pow(10, (rnd() - 0.5) * 6 / 20), cons: rnd() < 0.5 });
    t = end + 0.04 + 0.08 * rnd();
  }
  // last syllable ends exactly at t0+dur
  if (syl.length) syl[syl.length - 1].b = t0 + dur;
  return syl;
}
function inSyl(syl, t) {
  for (const s of syl) if (t >= s.a && t <= s.b) return s;
  return null;
}

// generic timeline: list of parts { kind: "hold"|"speech", a, b, f0At?, center?, vowel, gain, ramp }
function buildTimeline(parts, dur, { qual = "modal", speechQual = "modal", vibCents = 10, wanderCents = 3, seed = 1, holdVowelAt }) {
  return (sr) => {
    const plans = parts.map((p, i) => (p.kind === "speech" ? speechPlan(p.a, p.b - p.a, p.center, seed * 31 + i) : null));
    const f0At = (t) => {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (t < p.a || t > p.b) continue;
        if (p.kind === "hold") return p.f0At(t - p.a);
        const s = inSyl(plans[i], t);
        if (!s) return 0;
        const u = (t - s.a) / Math.max(1e-3, s.b - s.a);
        return cents(s.f, s.c * (u - 0.5));
      }
      return 0;
    };
    const ampAt = (t) => {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (t < p.a || t > p.b) continue;
        const r = p.ramp ?? 0.06;
        if (p.kind === "hold") {
          const g = p.gainAt ? p.gainAt(t - p.a) : (p.gain ?? 1);
          return g * Math.max(0, Math.min(1, (t - p.a) / r, (p.b - t) / r));
        }
        const s = inSyl(plans[i], t);
        if (!s) {
          // consonant burst in gaps (unvoiced): find the following syllable's flag
          const nx = plans[i].find((q) => q.a > t);
          return nx && nx.cons && nx.a - t < 0.05 ? 0.6 * (p.gain ?? 1) : 0;
        }
        return (p.gain ?? 1) * s.g * Math.max(0, Math.min(1, (t - s.a) / 0.02, (s.b - t) / 0.02));
      }
      return 0;
    };
    const vowelAt = (t) => {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (t < p.a || t > p.b) continue;
        if (p.kind === "hold") return p.vowelAt ? p.vowelAt(t - p.a) : p.vowel;
        const s = inSyl(plans[i], t);
        return s ? s.v : "a";
      }
      return "a";
    };
    // quality: holds use `qual`, speech uses `speechQual` -> synthesize both
    // and pick per part (simple, synthesis is cheap relative to clarity)
    const isHold = (t) => parts.some((p) => p.kind === "hold" && t >= p.a && t <= p.b);
    const xh = synth({ sr, dur, f0At: (t) => (isHold(t) ? f0At(t) : 0), ampAt: (t) => (isHold(t) ? ampAt(t) : 0), vowelAt, qual, vibCents, wanderCents, seed });
    const hasSpeech = parts.some((p) => p.kind === "speech");
    if (hasSpeech) {
      const xs = synth({ sr, dur, f0At: (t) => (isHold(t) ? 0 : f0At(t)), ampAt: (t) => (isHold(t) ? 0 : ampAt(t)), vowelAt, qual: speechQual, vibCents: 0, wanderCents: 0, seed: seed + 7, floorDb: -200 });
      for (let i = 0; i < xh.length; i++) xh[i] += xs[i];
    }
    return { x: xh, truthAt: f0At };
  };
}

export function heldScenarios() {
  const out = [];
  let seed = 100;
  const MODS = {
    steady: { vibCents: 0, wanderCents: 0, drift: 0 },
    vib10: { vibCents: 10, wanderCents: 3, drift: 0 },
    vib25: { vibCents: 25, wanderCents: 3, drift: 0 },
    drift15: { vibCents: 0, wanderCents: 3, drift: 15 },
  };
  // 1. steady holds
  for (const f0 of [120, 180, 220, 250]) for (const dur of [8, 12, 20]) for (const [mn, m] of Object.entries(MODS)) for (const qual of ["modal", "breathy"]) {
    seed++;
    const vowel = VOW[(f0 + dur + mn.length) % 3];
    const hold = { kind: "hold", a: 1, b: 1 + dur, vowel, f0At: (tn) => cents(f0, m.drift * tn / dur) };
    out.push({ name: `steady/${f0}/${dur}s/${mn}/${qual}`, family: "steady", holds: [[1, 1 + dur]], promoF: [[f0, cents(f0, m.drift)]], dur: dur + 2,
      build: buildTimeline([hold], dur + 2, { qual, vibCents: m.vibCents, wanderCents: m.wanderCents, seed }) });
  }
  // 2. mid-hold glides / steps (16 s holds, shift at ts s after onset)
  for (const f0 of [120, 180, 220, 250]) for (const sh of [20, 50, 100, 150, -50]) for (const ts of [2, 4, 8]) for (const type of ["glide", "step"]) for (const qual of ["modal", "breathy"]) {
    if (qual === "breathy" && ts !== 4) continue;
    seed++;
    const g = type === "glide" ? 1 : 0.05;
    const hold = { kind: "hold", a: 1, b: 17, vowel: VOW[(f0 + ts) % 3], f0At: (tn) => cents(f0, tn < ts ? 0 : tn < ts + g ? sh * (tn - ts) / g : sh) };
    out.push({ name: `shift/${f0}/${sh > 0 ? "+" : ""}${sh}c@${ts}s/${type}/${qual}`, family: "shift", holds: [[1, 17]], promoF: [[Math.min(f0, cents(f0, sh)), Math.max(f0, cents(f0, sh))]], dur: 18,
      build: buildTimeline([hold], 18, { qual, vibCents: 10, wanderCents: 3, seed }) });
  }
  // 3. speech running into a hold (gap 0 / 60 / 150 ms), hold 12 s
  for (const f0 of [120, 220]) for (const S of [1, 3, 6]) for (const G of [0, 0.06, 0.15]) for (const qual of ["modal", "breathy"]) for (const lev of [0, -10]) {
    seed++;
    const a = 1 + S + G;
    const parts = [{ kind: "speech", a: 1, b: 1 + S, center: f0, gain: 1 }, { kind: "hold", a, b: a + 12, vowel: VOW[(S + f0) % 3], gain: Math.pow(10, lev / 20), ramp: G === 0 ? 0.02 : 0.06, f0At: () => f0 }];
    out.push({ name: `speech2hold/${f0}/${S}s/gap${G * 1000}ms/${qual}/${lev}dB`, family: "speech2hold", holds: [[a, a + 12]], promoF: [[f0, f0]], dur: a + 13,
      build: buildTimeline(parts, a + 13, { qual, vibCents: 10, wanderCents: 3, seed }) });
  }
  // 4. phonation from session start (t = 0 and t = 0.15 s), and speech from t = 0
  for (const f0 of [120, 180, 220, 250]) for (const dur of [8, 12, 20]) for (const qual of ["modal", "breathy"]) for (const t0 of [0, 0.15]) {
    seed++;
    const hold = { kind: "hold", a: t0, b: t0 + dur, vowel: VOW[(f0 + dur) % 3], ramp: 0.02, f0At: () => f0 };
    out.push({ name: `start/${f0}/${dur}s/${qual}/t0=${t0}`, family: t0 === 0 ? "start0" : "start015", holds: [[t0, t0 + dur]], promoF: [[f0, f0]], dur: t0 + dur + 1,
      build: buildTimeline([hold], t0 + dur + 1, { qual, vibCents: 10, wanderCents: 3, seed }) });
  }
  for (const f0 of [120, 180, 220, 250]) for (const qual of ["modal", "breathy"]) {
    seed++;
    const parts = [{ kind: "speech", a: 0, b: 3, center: f0, gain: 1 }, { kind: "hold", a: 3.06, b: 15.06, vowel: "a", f0At: () => f0 }];
    out.push({ name: `startspeech/${f0}/${qual}`, family: "startspeech", holds: [[3.06, 15.06]], promoF: [[f0, f0]], dur: 16,
      build: buildTimeline(parts, 16, { qual, vibCents: 10, wanderCents: 3, seed }) });
  }
  // 5. repeated same-pitch holds with breaths
  for (const f0 of [120, 220]) for (const H of [8, 10]) for (const B of [0.15, 0.25, 0.3, 0.5, 1, 2]) for (const qual of ["modal", "breathy"]) for (const vib of [0, 20]) {
    seed++;
    const parts = []; let t = 1;
    for (let k = 0; k < 3; k++) { parts.push({ kind: "hold", a: t, b: t + H, vowel: VOW[(f0 + H) % 3], f0At: () => f0 }); t += H + B; }
    const end = t - B;
    out.push({ name: `repeat/${f0}/3x${H}s/breath${B}s/${qual}/vib${vib}`, family: "repeat", holds: parts.map((p) => [p.a, p.b]), promoF: [[f0, f0]], dur: end + 1,
      build: buildTimeline(parts, end + 1, { qual, vibCents: vib, wanderCents: vib ? 3 : 0, seed }) });
  }
  // 5b. repeated holds with AUDIBLE inhalations (broadband noise in the breath
  // at -20 / -30 dB re the note's RMS)
  for (const f0 of [120, 220]) for (const B of [0.15, 0.25, 0.3, 0.5, 1]) for (const lev of [-20, -30]) for (const qual of ["modal", "breathy"]) {
    seed++;
    const parts = []; let t = 1; const H = 10;
    for (let k = 0; k < 3; k++) { parts.push({ kind: "hold", a: t, b: t + H, vowel: VOW[(f0 + H) % 3], f0At: () => f0 }); t += H + B; }
    const end = t - B;
    const base = buildTimeline(parts, end + 1, { qual, vibCents: 10, wanderCents: 3, seed });
    const mySeed = seed;
    out.push({ name: `repeatnoisy/${f0}/3x10s/breath${B}s/${lev}dB/${qual}`, family: "repeatnoisy", holds: parts.map((p) => [p.a, p.b]), promoF: [[f0, f0]], dur: end + 1,
      build: (sr) => {
        const r = base(sr);
        const rnd = mulberry(mySeed * 13);
        const g = 0.2 / Math.SQRT2 * Math.pow(10, lev / 20) * Math.sqrt(3);
        let hp = 0, prev = 0;
        for (let k = 0; k < 2; k++) {
          const a = parts[k].b, b = parts[k + 1].a;
          for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) {
            const tt = i / sr, env = Math.max(0, Math.min(1, (tt - a) / 0.05, (b - tt) / 0.05));
            const w = 2 * rnd() - 1; hp = 0.9 * (hp + w - prev); prev = w;   // crude high-pass (breath noise)
            r.x[i] += env * g * hp;
          }
        }
        return r;
      } });
  }
  // 6. vowel change mid-hold (a -> u at 6 s) and dynamics (+-10 dB swell)
  for (const f0 of [120, 180, 220, 250]) for (const qual of ["modal", "breathy"]) {
    seed++;
    const hv = { kind: "hold", a: 1, b: 15, vowelAt: (tn) => (tn < 6 ? "a" : "u"), f0At: () => f0 };
    out.push({ name: `vowelchange/${f0}/${qual}`, family: "vowelchange", holds: [[1, 15]], promoF: [[f0, f0]], dur: 16,
      build: buildTimeline([hv], 16, { qual, vibCents: 10, wanderCents: 3, seed }) });
    seed++;
    const hd = { kind: "hold", a: 1, b: 15, vowel: "a", gainAt: (tn) => Math.pow(10, (-10 * Math.abs(Math.sin(Math.PI * tn / 7))) / 20), f0At: () => f0 };
    out.push({ name: `dynamics/${f0}/${qual}`, family: "dynamics", holds: [[1, 15]], promoF: [[f0, f0]], dur: 16,
      build: buildTimeline([hd], 16, { qual, vibCents: 10, wanderCents: 3, seed }) });
  }
  return out;
}
