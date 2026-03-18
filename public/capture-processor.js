// capture-processor.js — AudioWorklet processor that runs in the audio thread
// Collects mic audio samples into ~50ms chunks and posts them to the main thread

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    // ~50ms at 48kHz = 2400 samples. Adjusted dynamically if sample rate differs.
    this.chunkSize = Math.floor(sampleRate * 0.05);
  }

  process(inputs) {
    const input = inputs[0]?.[0]; // mono channel
    if (!input || input.length === 0) return true;

    // Append incoming samples to our accumulation buffer
    const newBuffer = new Float32Array(this.buffer.length + input.length);
    newBuffer.set(this.buffer);
    newBuffer.set(input, this.buffer.length);
    this.buffer = newBuffer;

    // Send complete chunks via transferable ArrayBuffer (zero-copy)
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }

    return true; // Keep processor alive
  }
}

registerProcessor("capture-processor", CaptureProcessor);
