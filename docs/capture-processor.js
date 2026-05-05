// capture-processor.js — AudioWorklet processor that runs in the audio thread
// Collects mic audio samples into ~25ms chunks and posts them to the main thread.
// Uses a pre-allocated ring buffer to avoid GC pauses on the audio thread.
//
// Note on time sources: AudioWorkletGlobalScope does NOT expose `performance`
// (verified in Chrome 147 — `typeof performance === "undefined"`). The only
// time sources available here are `currentTime` (AudioContext time, seconds)
// and `currentFrame` (sample count). For any cross-context timing in
// diagnostic mode, the DSP worker timestamps chunk arrival on its own side
// using its `performance.timeOrigin + performance.now()` and the main thread
// reconciles against `ctxCreatedAtEpochMs + contextTime * 1000`.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Default chunk: 25 ms (e.g. 1200 samples at 48 kHz). The init
    // message from the main thread can override via { chunkMs: N }
    // (diag-mode-only — see DIAG_CHUNK_MS_OVERRIDE in src/diag/diag.js).
    // Smaller chunks reduce start-of-utterance latency (the time a
    // sample waits for the chunk to fill before being sent) at the
    // cost of more frequent DSP-worker analysis cycles.
    this.chunkMs = 25;
    this._reallocBuffers();

    // Diagnostic mode: when enabled by an `init` message from the main thread
    // (?diag=1 URL flag), this.diag flips to true and the worklet posts an
    // init-ack so the overlay can confirm the flag propagated. The worklet
    // does NOT itself attach timing fields — see the time-source note above.
    this.diag = false;

    // Direct MessagePorts to downstream consumer Workers (DSP + ML).
    // Each consumer that wants audio sends a `{ type: "port", port }`
    // message; the worklet then broadcasts every chunk to all of them.
    this.workerPorts = [];
  }

  // Re-allocate the chunk-aggregation buffers when chunkMs changes
  // (init message). Called from the constructor with the default and
  // again on init if an override is provided.
  _reallocBuffers() {
    this.chunkSize = Math.floor(sampleRate * (this.chunkMs / 1000));
    this.bufferSize = this.chunkSize * 3;
    this.buffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    this.chunk = new Float32Array(this.chunkSize);
    this.port.onmessage = (e) => {
      try {
        if (e.data.type === "init") {
          if (e.data.diag) this.diag = true;
          if (typeof e.data.chunkMs === "number" && e.data.chunkMs >= 5 && e.data.chunkMs <= 50) {
            this.chunkMs = e.data.chunkMs;
            this._reallocBuffers();
          }
          // Ack so the main thread can confirm init landed and the diag
          // flag was honored. Always sent regardless of diag value.
          this.port.postMessage({
            type: "worklet-init-ack",
            diag: this.diag,
            chunkSize: this.chunkSize,
            chunkMs: this.chunkMs,
            sampleRate,
          });
        } else if (e.data.type === "port") {
          this.workerPorts.push(e.data.port);
        }
      } catch (err) {
        // Surface any init-handler error so an empty pipeline doesn't
        // look like "everything's fine". Throwing here would not affect
        // process() but the silent failure mode bit us once already.
        this.port.postMessage({
          type: "worklet-error",
          where: "onmessage",
          message: err && err.message ? err.message : String(err),
          stack: err && err.stack ? err.stack : null,
        });
      }
    };
  }

  process(inputs) {
    // Defensive: any throw inside process() permanently disconnects the
    // AudioWorkletNode from the graph (per Web Audio spec), making the
    // pipeline silently die. Wrap so a bug surfaces as an error message
    // instead of audio just stopping.
    try {
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
        const chunkStart = 0;
        // Build a transferable buffer per consumer (transfer detaches the
        // ArrayBuffer, so it can't be reused across postMessage calls).
        // Only `contextTime` is attached as a timestamp; the DSP worker
        // can convert that to wall time on its end via the
        // ctxCreatedAtEpochMs the main thread already tracks.
        if (this.workerPorts.length > 0) {
          for (let i = 0; i < this.workerPorts.length; i++) {
            const out = new Float32Array(this.chunkSize);
            out.set(this.buffer.subarray(chunkStart, chunkStart + this.chunkSize));
            this.workerPorts[i].postMessage(
              { buffer: out.buffer, contextTime: currentTime },
              [out.buffer],
            );
          }
        } else {
          // Fallback: relay through the main-thread port if no direct
          // consumers are registered yet.
          const out = new Float32Array(this.chunkSize);
          out.set(this.buffer.subarray(chunkStart, chunkStart + this.chunkSize));
          this.port.postMessage(
            { buffer: out.buffer, contextTime: currentTime },
            [out.buffer],
          );
        }
        this.buffer.copyWithin(0, this.chunkSize, this.writePos);
        this.writePos -= this.chunkSize;
      }

      return true; // Keep processor alive
    } catch (err) {
      // Surface the error and KEEP the processor alive (return true) so
      // the pipeline doesn't die. The main thread's diag overlay will
      // show the error, and at least we don't lose all audio.
      try {
        this.port.postMessage({
          type: "worklet-error",
          where: "process",
          message: err && err.message ? err.message : String(err),
          stack: err && err.stack ? err.stack : null,
        });
      } catch { /* nothing to do if even the error post fails */ }
      return true;
    }
  }
}

registerProcessor("capture-processor", CaptureProcessor);
