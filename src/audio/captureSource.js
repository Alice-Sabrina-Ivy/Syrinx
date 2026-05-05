// captureSource.js — Factory for the audio-capture stage of the pipeline.
//
// Exposes a single createCaptureSource(stream, opts) factory whose returned
// object presents a uniform interface regardless of which capture mechanism
// was selected:
//
//   - "audiocontext" (default, current production):
//       getUserMedia stream → MediaStreamAudioSourceNode → AudioWorkletNode
//       → MessageChannel → consumer (DSP / ML worker)
//
//   - "mstp" (Stage 2 — Chrome main-thread only):
//       getUserMedia stream → MediaStreamTrackProcessor on main thread
//       → ReadableStream of AudioData → Float32Array → MessageChannel
//       → consumer (DSP / ML worker)
//       Worker-side MSTP isn't available on Chrome mobile (verified
//       Chrome 147 — typeof MediaStreamTrackProcessor === "undefined" in
//       worker globalScope). Firefox/Safari worker-MSTP support is
//       deferred (build-when-we-can-test work).
//
// The downstream message protocol is identical for both:
//   { buffer: ArrayBuffer (Float32 samples), contextTime: number (seconds) }
//
// `contextTime` semantics on each path:
//   - audiocontext: AudioContext.currentTime at the chunk's quantum,
//     converted to wall-clock via ctxCreatedAtEpochMs + contextTime*1000.
//   - mstp: track-time-of-latest-sample in seconds, converted via
//     trackStartedEpochMs + contextTime*1000 (derived from the first
//     AudioData's timestamp + duration vs wall arrival).
//
// Either way, the caller treats `audioOriginEpochMs` (returned from this
// factory) and `contextTime` (in chunk messages) the same way to compute
// audioCapturedEpochMs = audioOriginEpochMs + contextTime * 1000.

const isMSTPSupported = (() => {
  if (typeof MediaStreamTrackProcessor === "undefined") return false;
  if (typeof AudioData === "undefined") return false;
  return true;
})();

export function supportsMSTPAudio() {
  return isMSTPSupported;
}

// Production default. Stage 1 + Stage 2 keep this at "audiocontext"
// — MSTP is opt-in via diag flag for measurement only. Stage 3 flips
// this based on the Stage 2.5 measurement decision (MSTP-everywhere,
// MSTP-mobile-only, or stay-on-audiocontext).
const DEFAULT_KIND = "audiocontext";

// Pick the capture kind. forceKind overrides for diagnostic comparison.
function pickKind(forceKind) {
  if (forceKind === "mstp") {
    if (!isMSTPSupported) {
      throw new Error("forceKind='mstp' but MediaStreamTrackProcessor / AudioData unavailable in this browser");
    }
    return "mstp";
  }
  if (forceKind === "audiocontext") return "audiocontext";
  if (forceKind != null) {
    throw new Error(`Unknown forceKind: ${forceKind}`);
  }
  return DEFAULT_KIND;
}

/**
 * Create a capture source. Returns a Promise resolving to:
 *
 *   {
 *     kind: "audiocontext" | "mstp",
 *     sampleRate: number,
 *     audioOriginEpochMs: number,   // for converting chunk contextTime → wall-clock
 *     audioCtx: AudioContext | null,// only on audiocontext path
 *     audioInfoExtra(): object,     // path-specific fields for setAudioInfo
 *     connectConsumer(): MessagePort,
 *     close(): void,
 *   }
 *
 * Options:
 *   - stream: MediaStream from getUserMedia (caller owns it)
 *   - diag: bool — propagate diag flag to AudioWorklet/MSTP worker
 *   - chunkMs: number | null — override default chunk size (5..50)
 *   - latencyHint: string | number — for AudioContext constructor
 *   - sampleRate: number | null — request specific sample rate
 *   - forceKind: "mstp" | "audiocontext" | null — diag override
 *   - onInitAck(ack): callback when capture source's init-ack arrives
 *   - onError(err): callback when capture source surfaces an error
 */
export async function createCaptureSource(stream, opts = {}) {
  const kind = pickKind(opts.forceKind);
  if (kind === "mstp") {
    return await _createMstpSource(stream, opts);
  }
  return await _createAudioContextSource(stream, opts);
}

// ---------------------------------------------------------------------------
//  AudioContext + AudioWorklet path (current production)
// ---------------------------------------------------------------------------

async function _createAudioContextSource(stream, opts) {
  const ctxOpts = { latencyHint: opts.latencyHint ?? "balanced" };
  if (opts.sampleRate) ctxOpts.sampleRate = opts.sampleRate;
  const audioCtx = new AudioContext(ctxOpts);
  const ctxCreatedAtEpochMs = performance.timeOrigin + performance.now();

  await audioCtx.audioWorklet.addModule("capture-processor.js");
  const workletNode = new AudioWorkletNode(audioCtx, "capture-processor");

  // Worklet message handling — init-ack and error surfaces. The
  // addEventListener pattern (vs onmessage) requires explicit start().
  workletNode.port.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === "worklet-init-ack") {
      // Re-shape the ack into a kind-agnostic payload so the overlay's
      // status.capture field has consistent shape across paths.
      opts.onInitAck?.({
        kind: "audiocontext",
        diag: msg.diag,
        chunkSize: msg.chunkSize,
        chunkMs: msg.chunkMs,
        sampleRate: msg.sampleRate,
      });
    } else if (msg.type === "worklet-error") {
      opts.onError?.({ where: msg.where, message: msg.message, stack: msg.stack });
    }
  });
  workletNode.port.start();
  workletNode.port.postMessage({
    type: "init",
    diag: !!opts.diag,
    ...(opts.chunkMs != null ? { chunkMs: opts.chunkMs } : {}),
  });

  // Connect mic source to worklet.
  const mediaSrc = audioCtx.createMediaStreamSource(stream);
  mediaSrc.connect(workletNode);

  // Connect worklet to destination via a muted gain node. Without this,
  // the browser may stop calling process() on the AudioWorklet because
  // its output isn't consumed (no path to destination). Per spec, the
  // UA may skip processing for nodes whose output isn't reachable.
  const muteNode = audioCtx.createGain();
  muteNode.gain.value = 0;
  workletNode.connect(muteNode);
  muteNode.connect(audioCtx.destination);

  return {
    kind: "audiocontext",
    sampleRate: audioCtx.sampleRate,
    audioOriginEpochMs: ctxCreatedAtEpochMs,
    audioCtx,
    audioInfoExtra() {
      return {
        baseLatencySec: audioCtx.baseLatency ?? null,
        outputLatencySec: audioCtx.outputLatency ?? null,
        ctxCreatedAtEpochMs,
        ctxLatencyHint: ctxOpts.latencyHint,
        audioWorkletSupported: true,
      };
    },
    connectConsumer() {
      // Direct MessagePort between AudioWorklet and a consumer (DSP / ML
      // worker), so audio chunks bypass the main thread entirely. The
      // worklet broadcasts each chunk to all registered ports.
      const channel = new MessageChannel();
      workletNode.port.postMessage(
        { type: "port", port: channel.port1 },
        [channel.port1],
      );
      return channel.port2;
    },
    close() {
      try { mediaSrc.disconnect(); } catch { /* ignore */ }
      try { workletNode.disconnect(); } catch { /* ignore */ }
      try { audioCtx.close(); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------
//  MediaStreamTrackProcessor + main-thread reader path
// ---------------------------------------------------------------------------
//
// Reads AudioData frames from the MSTP's ReadableStream on the main
// thread, copies channel-0 samples into a Float32 ring, emits chunkMs-
// sized chunks via MessageChannel to each consumer port. The DSP / ML
// workers are unaffected — they receive the same {buffer, contextTime}
// message shape as on the AudioWorklet path.
//
// Why main-thread (not worker): Chrome 147 mobile doesn't expose
// MediaStreamTrackProcessor in worker globalScope. The user-plan's
// "single worker code path" assumed otherwise; verified false at
// runtime. Long-session drift behavior under main-thread MSTP is a
// known unknown — measured at Stage 2.5.

async function _createMstpSource(stream, opts) {
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) throw new Error("MSTP path: stream has no audio track");
  const track = tracks[0];

  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  const chunkMs = opts.chunkMs ?? 25;
  const consumerPorts = [];
  let chunkSize = 0;
  let pendingBuffer = null;
  let pendingFill = 0;
  let trackStartedEpochMs = null;
  let lastFrameEndUs = 0;
  let lastFrameSampleRate = 0;
  let stopped = false;

  // Resolved by the read loop on first frame, with the values the
  // factory needs (sampleRate, audioOriginEpochMs, etc.). The factory's
  // outer await blocks on this so the caller gets a fully-initialized
  // source handle.
  let resolveReady, rejectReady;
  const readyPromise = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  // Read loop — async IIFE so it doesn't block the factory's resolution.
  // Each `await reader.read()` yields to the event loop, so React renders
  // and other main-thread work can interleave between frames.
  (async () => {
    try {
      while (!stopped) {
        const { value: frame, done } = await reader.read();
        if (done) return;
        const wallMs = performance.timeOrigin + performance.now();

        if (trackStartedEpochMs === null) {
          // First frame: derive the audio-time origin and chunk geometry.
          // trackStartedEpochMs ≈ wall when audio time = 0, computed as
          // wall_now − end-of-frame audio time. The end of THIS frame is
          // the most recently captured sample, ~now in wall time.
          trackStartedEpochMs = wallMs - (frame.timestamp + frame.duration) / 1000;
          chunkSize = Math.floor((frame.sampleRate * chunkMs) / 1000);
          // 3× chunkSize headroom — a single AudioData frame can be
          // larger than chunkSize (40 ms hw frame vs 25 ms chunk default).
          const headroom = Math.max(chunkSize * 3, frame.numberOfFrames * 2);
          pendingBuffer = new Float32Array(headroom);

          resolveReady({
            sampleRate: frame.sampleRate,
            chunkSize,
            chunkMs,
            trackStartedEpochMs,
            frameDurationMs: frame.duration / 1000,
            channels: frame.numberOfChannels,
            format: frame.format,
          });

          opts.onInitAck?.({
            kind: "mstp",
            diag: !!opts.diag,
            chunkSize,
            chunkMs,
            sampleRate: frame.sampleRate,
            frameDurationMs: frame.duration / 1000,
            channels: frame.numberOfChannels,
            format: frame.format,
          });
        }

        // Copy plane 0 (channel 0) as f32-planar. AudioData converts
        // formats on the fly; source could be s16/u8/etc.
        const frames = frame.numberOfFrames;
        if (pendingFill + frames > pendingBuffer.length) {
          const newBuf = new Float32Array((pendingFill + frames) * 2);
          newBuf.set(pendingBuffer.subarray(0, pendingFill));
          pendingBuffer = newBuf;
        }
        try {
          frame.copyTo(pendingBuffer.subarray(pendingFill, pendingFill + frames), {
            planeIndex: 0,
            format: "f32-planar",
          });
        } catch (err) {
          opts.onError?.({
            where: "audioData.copyTo",
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          });
          try { frame.close(); } catch { /* ignore */ }
          return;
        }
        pendingFill += frames;
        lastFrameEndUs = frame.timestamp + frame.duration;
        lastFrameSampleRate = frame.sampleRate;
        try { frame.close(); } catch { /* ignore */ }

        // Emit chunks while the buffer has at least chunkSize samples
        // AND there's a consumer to send to. If consumerPorts is empty
        // (e.g. caller hasn't called connectConsumer yet), accumulate
        // and let the next frame's emission catch up.
        while (pendingFill >= chunkSize && consumerPorts.length > 0) {
          const remainingAfterEmit = pendingFill - chunkSize;
          const remainingDurationUs = (remainingAfterEmit / lastFrameSampleRate) * 1e6;
          const contextTimeSec = (lastFrameEndUs - remainingDurationUs) / 1e6;

          // Each consumer needs its own ArrayBuffer (transfer detaches),
          // so allocate per consumer per chunk.
          for (let i = 0; i < consumerPorts.length; i++) {
            const out = new Float32Array(chunkSize);
            out.set(pendingBuffer.subarray(0, chunkSize));
            try {
              consumerPorts[i].postMessage(
                { buffer: out.buffer, contextTime: contextTimeSec },
                [out.buffer],
              );
            } catch {
              // Port may have been closed; ignore. Cleanup of dead
              // ports happens in close() (terminating workers releases
              // their port refs).
            }
          }
          pendingBuffer.copyWithin(0, chunkSize, pendingFill);
          pendingFill -= chunkSize;
        }
      }
    } catch (err) {
      opts.onError?.({
        where: "mstp-read-loop",
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : null,
      });
      try { rejectReady(err); } catch { /* already-resolved is fine */ }
    }
  })();

  // Wait for first AudioData → readyPromise resolves with metadata. 5 s
  // timeout in case the track silently fails to produce data.
  const ready = await Promise.race([
    readyPromise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("MSTP first-frame timeout (5s)")), 5000)),
  ]);

  return {
    kind: "mstp",
    sampleRate: ready.sampleRate,
    audioOriginEpochMs: ready.trackStartedEpochMs,
    audioCtx: null,
    audioInfoExtra() {
      return {
        baseLatencySec: null,
        outputLatencySec: null,
        ctxCreatedAtEpochMs: ready.trackStartedEpochMs,
        ctxLatencyHint: null,
        // audioWorkletSupported intentionally omitted on this path;
        // overlay guards on `!== undefined`.
        mstpFrameDurationMs: ready.frameDurationMs,
        mstpFormat: ready.format,
        mstpChannels: ready.channels,
      };
    },
    connectConsumer() {
      // Reader runs on this thread, so we just keep port1 in our
      // consumerPorts array and post outbound. Port2 goes to the worker
      // (caller transfers via worker.postMessage(..., [port2])).
      const channel = new MessageChannel();
      consumerPorts.push(channel.port1);
      return channel.port2;
    },
    close() {
      stopped = true;
      try { reader.cancel(); } catch { /* ignore */ }
      try { track.stop(); } catch { /* ignore */ }
      consumerPorts.length = 0;
    },
  };
}
