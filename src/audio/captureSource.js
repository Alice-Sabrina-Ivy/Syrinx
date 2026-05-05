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
//   - "mstp" (Stage 2; not yet implemented in this commit):
//       getUserMedia stream → MediaStreamTrackProcessor (in worker)
//       → ReadableStream of AudioData → MessageChannel → consumer
//
// The downstream message protocol is identical for both:
//   { buffer: ArrayBuffer (Float32 samples), contextTime: number (seconds) }
//
// `contextTime` semantics on each path:
//   - audiocontext: AudioContext.currentTime at the chunk's quantum,
//     converted to wall-clock via ctxCreatedAtEpochMs + contextTime*1000.
//   - mstp: track-time-of-latest-sample in seconds, converted via
//     trackStartedEpochMs + contextTime*1000 (the MSTP worker derives
//     trackStartedEpochMs from the first AudioData timestamp).
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
//  MediaStreamTrackProcessor + Worker path (Stage 2 — implemented separately)
// ---------------------------------------------------------------------------

async function _createMstpSource(_stream, _opts) {
  // Stage 2 lands the worker-based MSTP implementation. Until then, the
  // factory rejects forceKind='mstp' and the default falls back to
  // audiocontext (because Stage 1 is the abstraction-only commit).
  throw new Error(
    "MSTP capture path not yet implemented. Use forceKind='audiocontext' or omit forceKind."
  );
}
