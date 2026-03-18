// capture-processor.js — AudioWorklet processor that runs in the audio thread
// Collects mic audio samples into ~50ms chunks and sends them directly to the
// DSP worker via a MessagePort (bypasses the main thread entirely).
// Falls back to this.port (main thread relay) if no direct port is provided.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.chunkSize = Math.floor(sampleRate * 0.05);
    this.directPort = null;

    // Listen for a MessagePort from the main thread
    this.port.onmessage = (e) => {
      if (e.data?.type === "port") {
        this.directPort = e.data.port;
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    const newBuffer = new Float32Array(this.buffer.length + input.length);
    newBuffer.set(this.buffer);
    newBuffer.set(input, this.buffer.length);
    this.buffer = newBuffer;

    const dest = this.directPort || this.port;
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);
      dest.postMessage(chunk.buffer, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
