// capture-processor.js — AudioWorklet processor that runs in the audio thread
// Collects mic audio samples into ~50ms chunks and posts them to the main thread.
// Uses a pre-allocated ring buffer to avoid GC pauses on the audio thread.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~50ms at sample rate (e.g. 2400 samples at 48kHz)
    this.chunkSize = Math.floor(sampleRate * 0.05);
    // Pre-allocate buffer large enough for 2 chunks + headroom for input frames
    // (avoids creating new Float32Array objects in process(), reducing GC pressure)
    this.bufferSize = this.chunkSize * 3;
    this.buffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    // Reusable chunk for sending (avoids allocation per send)
    this.chunk = new Float32Array(this.chunkSize);

    // Direct MessagePort to DSP Worker (bypasses main thread)
    this.workerPort = null;
    this.port.onmessage = (e) => {
      if (e.data.type === "port") {
        this.workerPort = e.data.port;
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0]; // mono channel
    if (!input || input.length === 0) return true;

    // Copy input into pre-allocated buffer
    if (this.writePos + input.length > this.bufferSize) {
      // Should rarely happen — compact by shifting data left
      if (this.writePos > 0) {
        this.buffer.copyWithin(0, 0, this.writePos);
      }
      // If still not enough room, expand (very rare)
      if (this.writePos + input.length > this.bufferSize) {
        this.bufferSize = (this.writePos + input.length) * 2;
        const newBuf = new Float32Array(this.bufferSize);
        newBuf.set(this.buffer.subarray(0, this.writePos));
        this.buffer = newBuf;
      }
    }
    this.buffer.set(input, this.writePos);
    this.writePos += input.length;

    // Send complete chunks
    while (this.writePos >= this.chunkSize) {
      // Copy chunk data into a new transferable buffer
      // (must be a fresh ArrayBuffer since transfer detaches it)
      const out = new Float32Array(this.chunkSize);
      out.set(this.buffer.subarray(0, this.chunkSize));
      // Shift remaining data left
      this.buffer.copyWithin(0, this.chunkSize, this.writePos);
      this.writePos -= this.chunkSize;
      // Send directly to DSP Worker (or fall back to main-thread relay)
      const target = this.workerPort || this.port;
      target.postMessage(out.buffer, [out.buffer]);
    }

    return true; // Keep processor alive
  }
}

registerProcessor("capture-processor", CaptureProcessor);
