// capture-processor.js — AudioWorklet processor that runs in the audio thread
// Collects mic audio samples into ~25ms chunks and posts them to the main thread.
// Uses a pre-allocated ring buffer to avoid GC pauses on the audio thread.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~25ms at sample rate (e.g. 1200 samples at 48kHz)
    // Smaller chunks = more frequent analysis = faster pitch change detection
    this.chunkSize = Math.floor(sampleRate * 0.025);
    // Pre-allocate buffer large enough for 2 chunks + headroom for input frames
    // (avoids creating new Float32Array objects in process(), reducing GC pressure)
    this.bufferSize = this.chunkSize * 3;
    this.buffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    // Reusable chunk for sending (avoids allocation per send)
    this.chunk = new Float32Array(this.chunkSize);

    // Diagnostic mode: when enabled by an `init` message from the main
    // thread (?diag=1 URL flag), each chunk message carries a postedAt
    // timestamp used to measure capture-processor → DSP worker handoff
    // latency. Off by default; the only cost is a property read per chunk.
    this.diag = false;

    // Direct MessagePorts to downstream consumer Workers (DSP + ML).
    // Each consumer that wants audio sends a `{ type: "port", port }`
    // message; the worklet then broadcasts every chunk to all of them.
    this.workerPorts = [];
    this.port.onmessage = (e) => {
      if (e.data.type === "init") {
        if (e.data.diag) this.diag = true;
      } else if (e.data.type === "port") {
        this.workerPorts.push(e.data.port);
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
      // Shift remaining data left
      const chunkStart = 0;
      // Build a transferable buffer per consumer (transfer detaches the
      // ArrayBuffer, so it can't be reused across postMessage calls).
      // postedAt is computed once per outgoing batch and only when diag
      // is on; the AudioWorkletGlobalScope's performance.now() shares
      // its origin with other AudioWorklet contexts but can drift from
      // the main thread by a few ms (no shared timeOrigin guarantee).
      // For relative-cadence diagnosis (chunk handoff vs detectPitch
      // cost) the small bias is fine.
      const postedAt = this.diag ? performance.now() : 0;
      if (this.workerPorts.length > 0) {
        for (let i = 0; i < this.workerPorts.length; i++) {
          const out = new Float32Array(this.chunkSize);
          out.set(this.buffer.subarray(chunkStart, chunkStart + this.chunkSize));
          this.workerPorts[i].postMessage(
            { buffer: out.buffer, contextTime: currentTime, postedAt },
            [out.buffer],
          );
        }
      } else {
        // Fallback: relay through the main-thread port if no direct
        // consumers are registered yet.
        const out = new Float32Array(this.chunkSize);
        out.set(this.buffer.subarray(chunkStart, chunkStart + this.chunkSize));
        this.port.postMessage(
          { buffer: out.buffer, contextTime: currentTime, postedAt },
          [out.buffer],
        );
      }
      this.buffer.copyWithin(0, this.chunkSize, this.writePos);
      this.writePos -= this.chunkSize;
    }

    return true; // Keep processor alive
  }
}

registerProcessor("capture-processor", CaptureProcessor);
