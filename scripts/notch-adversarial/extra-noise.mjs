// extra tonal classes (the 2026-10-03 notch agent's), unit RMS, 16 kHz
const SR = 16000;
function rumble(n, seed, corner = 0.056) { let a = seed >>> 0 || 1, lp = 0; const x = new Float32Array(n); for (let i = 0; i < n; i++) { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; lp += corner * ((a / 0x7fffffff - 1) - lp); x[i] = lp; } return x; }
function norm(x) { let s = 0; for (const v of x) s += v * v; const r = Math.sqrt(s / x.length) || 1; for (let i = 0; i < x.length; i++) x[i] /= r; return x; }
function hum(n, fOf, amps, rumbleGain = 2.2, seed = 3) { const r = rumble(n, seed); const x = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { ph += 2 * Math.PI * fOf(i / SR) / SR; let s = 0; for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * ph + k * 1.1); x[i] = s + rumbleGain * r[i]; } return norm(x); }
const FAN = [1, 0.25, 0.12];
export const EXTRA_NOISE = {
  "fan-wobble0.6": (n) => hum(n, (t) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t) + 0.18 * Math.sin(2 * Math.PI * 0.135 * t), FAN),
  "fan-wobble1.5": (n) => hum(n, (t) => 120 + 1.5 * Math.sin(2 * Math.PI * 0.1 * t) + 0.45 * Math.sin(2 * Math.PI * 0.27 * t), FAN),
  "fan-drift": (n) => hum(n, (t) => 118 + 4 * t / 40, FAN),
  "hum-rich120": (n) => hum(n, () => 120, [1, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15], 1.0),
  "hum-rich60": (n) => hum(n, (t) => 60 + 0.02 * Math.sin(2 * Math.PI * 0.07 * t), [0.5, 1, 0.8, 0.6, 0.5, 0.45, 0.4, 0.3, 0.3, 0.25, 0.2, 0.2, 0.15, 0.15, 0.1, 0.1], 0.6),
  "fan-wobble0.6+rich": (n) => hum(n, (t) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t), [1, 0.5, 0.35, 0.25, 0.2, 0.15], 1.5),
};
