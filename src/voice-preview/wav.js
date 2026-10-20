// wav.js — the voice preview's download format: 16-bit PCM mono WAV (pure;
// tests/voice-preview/wav-test.js). measurements/voice-preview-phase1-2026-10-19.md §13.
// Samples are clipped to [-1, 1] and rounded to the nearest of -32767..32767, halves away
// from zero (symmetric, so a full-scale sine stays symmetric); NaN is written as 0.

export function encodeWav(pcm, sampleRate) {
  const n = pcm.length;
  const bytes = 44 + 2 * n;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);          // PCM fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  ascii(36, "data");
  v.setUint32(40, 2 * n, true);
  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    const c = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
    const q = Math.round(Math.abs(c) * 32767);
    v.setInt16(44 + 2 * i, c < 0 ? -q : q, true);
  }
  return buf;
}

/** Parses what encodeWav writes (and any 16-bit PCM mono WAV): { sampleRate, pcm (Float32, /32767) }. */
export function decodeWav16(buf) {
  const v = new DataView(buf);
  const tag = (off) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12, sampleRate = 0, channels = 0, bits = 0, format = 0;
  while (off + 8 <= v.byteLength) {
    const id = tag(off), len = v.getUint32(off + 4, true);
    if (id === "fmt ") {
      format = v.getUint16(off + 8, true);
      channels = v.getUint16(off + 10, true);
      sampleRate = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === "data") {
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("not 16-bit PCM mono");
      const pcm = new Float32Array(len / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = v.getInt16(off + 8 + 2 * i, true) / 32767;
      return { sampleRate, channels, bits, pcm };
    }
    off += 8 + len + (len & 1);
  }
  throw new Error("no data chunk");
}
