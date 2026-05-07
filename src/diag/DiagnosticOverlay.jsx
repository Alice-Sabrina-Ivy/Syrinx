// DiagnosticOverlay.jsx — Fixed top-right panel rendered only when ?diag=1.
// Reads from the diag ring buffer at rAF cadence; doesn't observe the audio
// pipeline directly so the hot path stays untouched.
//
// Sections:
//   1. Per-frame timing breakdown (current value + p95 over last 5s)
//   2. Voicedness sparkline + pitch / RMS overlay (last 5s)
//   3. Audio context introspection (static, captured at start)
//   4. Tap-to-display latency tracker
//   5. "Snapshot last 5s" download button
//
// The component is dynamically imported by App.jsx only when DIAG_ENABLED
// so its Tailwind classes and helper code don't ship in production bundles.

import { useEffect, useRef, useState } from "react";
import {
  diagState,
  getTimingStats,
  pushTap,
  downloadSnapshot,
  getStatus,
} from "./diag";

const REFRESH_HZ = 10; // overlay refresh rate; cheap because we read from refs

function fmtMs(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}ms`;
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

// Color the drift number by magnitude — green near 0, amber for slow
// growth, red for fast. The threshold "fast" is set against the mobile
// regression baseline (+11.5 ms/s); anything > 1 ms/s after the fix
// should already be a yellow flag.
function driftClass(driftMsPerSec) {
  if (driftMsPerSec == null || !Number.isFinite(driftMsPerSec)) return "text-neutral-500";
  const a = Math.abs(driftMsPerSec);
  if (a < 0.2) return "text-neutral-400";
  if (a < 1) return "text-amber-400";
  return "text-red-400";
}

function fmtDrift(d) {
  if (d == null || !Number.isFinite(d)) return "—";
  const sign = d >= 0 ? "+" : "−";
  return `${sign}${Math.abs(d).toFixed(2)}ms/s`;
}

function TimingRow({ label, stats, hint, showDrift }) {
  return (
    <div className="flex items-baseline justify-between text-[10px] gap-2">
      <span className="text-neutral-400 truncate" title={hint}>{label}</span>
      <span className="font-mono text-neutral-200 tabular-nums whitespace-nowrap">
        {fmtMs(stats?.current)}{" "}
        <span className="text-neutral-500">p95 {fmtMs(stats?.p95)}</span>
        {showDrift && (
          <>
            {" "}
            <span className={driftClass(stats?.driftMsPerSec)} title="linear-fit slope of this metric vs session time over the diag ring">
              {fmtDrift(stats?.driftMsPerSec)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

// Tiny canvas sparkline: draws two series stacked on a shared 0..1 y-axis.
// confidence (cyan, SwiftF0's voicing probability — replaced pYIN's HMM-
// smoothed `voicedness` and raw `voicednessObs` at the Stage 4 cutover) and
// inputRms (orange × 4 so quiet speech is visible). Pitch is shown as a
// separate row above with its own 60..400 Hz scale.
function Sparkline({ frames }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (frames.length < 2) return;

    const t0 = frames[0].tEpochMs;
    const t1 = frames[frames.length - 1].tEpochMs;
    const dt = Math.max(1, t1 - t0);

    // Top half: pitch (auto-scaled to 60..400 Hz typical voice range)
    const pitchMin = 60, pitchMax = 400;
    const topH = h * 0.45;

    ctx.strokeStyle = "#fbbf24"; // amber
    ctx.lineWidth = 1;
    ctx.beginPath();
    let first = true;
    for (const fr of frames) {
      if (fr.pitch == null) { first = true; continue; }
      const x = ((fr.tEpochMs - t0) / dt) * w;
      const y = topH - ((fr.pitch - pitchMin) / (pitchMax - pitchMin)) * topH;
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Bottom half: confidence (cyan), inputRms ×4 (orange).
    const botY0 = topH + 4;
    const botH = h - topH - 4;

    const drawSeries = (key, color, scale = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let f = true;
      for (const fr of frames) {
        const v = fr[key];
        if (v == null) { f = true; continue; }
        const x = ((fr.tEpochMs - t0) / dt) * w;
        const clamped = Math.max(0, Math.min(1, v * scale));
        const y = botY0 + botH - clamped * botH;
        if (f) { ctx.moveTo(x, y); f = false; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    };
    drawSeries("confidence", "#22d3ee");
    drawSeries("inputRms", "#fb923c", 4); // ×4 so quiet speech is visible

    // Baseline + 0.5 gridline for the bottom panel
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, botY0 + botH * 0.5);
    ctx.lineTo(w, botY0 + botH * 0.5);
    ctx.moveTo(0, botY0 + botH);
    ctx.lineTo(w, botY0 + botH);
    ctx.stroke();
  }, [frames]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-24 bg-black/30 rounded"
    />
  );
}

export default function DiagnosticOverlay() {
  const [tick, setTick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const lastTapRef = useRef(null);

  // rAF-paced refresh at REFRESH_HZ. Reads ring buffer on each tick.
  useEffect(() => {
    let stop = false;
    const periodMs = 1000 / REFRESH_HZ;
    let last = 0;
    function loop(t) {
      if (stop) return;
      if (t - last >= periodMs) {
        last = t;
        setTick((n) => n + 1);
      }
      requestAnimationFrame(loop);
    }
    const id = requestAnimationFrame(loop);
    return () => { stop = true; cancelAnimationFrame(id); };
  }, []);

  // Tap-to-display latency: capture event.timeStamp + epoch ms when the
  // user taps anywhere; on the next refresh cycle compute the gap.
  useEffect(() => {
    function onPointerDown(e) {
      const tapEpochMs = performance.timeOrigin + performance.now();
      lastTapRef.current = tapEpochMs;
      pushTap({ tapEpochMs, eventTimeStamp: e.timeStamp });
    }
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, []);

  const frames = diagState?.frames.toArray() ?? [];
  const stats = getTimingStats();
  const audio = diagState?.audio;
  const status = getStatus();
  const lastTap = lastTapRef.current;
  const tapAgeMs = lastTap ? (performance.timeOrigin + performance.now()) - lastTap : null;

  // Suppress unused-var lint: tick triggers the rerender.
  void tick;

  if (collapsed) {
    return (
      <div className="fixed top-2 right-2 z-50">
        <button
          onClick={() => setCollapsed(false)}
          className="bg-black/80 border border-neutral-700 rounded px-2 py-1 text-[10px] text-cyan-400 font-mono hover:bg-neutral-900"
          title="Show diagnostics"
        >
          diag
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-2 right-2 z-50 w-72 bg-black/85 border border-neutral-700 rounded-lg p-3 text-white text-[11px] backdrop-blur-sm font-sans shadow-xl select-text">
      <div className="flex items-center justify-between mb-2">
        <span className="text-cyan-400 font-mono text-[10px] tracking-wider">DIAG ?diag=1</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-neutral-500 hover:text-white text-[14px] leading-none"
          title="Collapse"
        >×</button>
      </div>

      {/* Pipeline status — surfaces silent failures */}
      <div className="mb-3">
        <div className="text-[10px] uppercase text-neutral-500 mb-1 tracking-wider">Pipeline status</div>
        <div className="space-y-0.5 text-[10px] font-mono">
          <div className="flex justify-between">
            <span className="text-neutral-400">capture init:</span>
            <span className={status?.capture ? "text-green-400" : "text-amber-400"}>
              {status?.capture
                ? `✓ ${status.capture.kind} diag=${String(status.capture.diag)} chunk=${status.capture.chunkSize} sr=${status.capture.sampleRate}`
                : "no ack"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">worker init:</span>
            <span className={status?.worker ? "text-green-400" : "text-amber-400"}>
              {status?.worker
                ? `✓ diag=${String(status.worker.diag)} sr=${status.worker.sampleRate}`
                : "no ack"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">errors:</span>
            <span className={(status?.errors?.length ?? 0) > 0 ? "text-red-400" : "text-neutral-500"}>
              {status?.errors?.length ?? 0}
            </span>
          </div>
          {status?.errors?.length > 0 && (
            <div className="mt-1 max-h-24 overflow-y-auto bg-red-950/50 border border-red-900 rounded p-1 text-[9px] text-red-300 leading-tight">
              {status.errors.slice(-3).map((err, i) => (
                <div key={i} className="mb-1">
                  <span className="text-red-400">[{err.source}{err.where ? `/${err.where}` : ""}]</span>{" "}
                  {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Timings */}
      <div className="mb-3">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-[10px] uppercase text-neutral-500 tracking-wider">Timings (cur / p95 / drift)</span>
          <span className="text-[9px] text-neutral-500 font-mono">
            window {stats ? stats._windowSec.toFixed(1) : "0.0"}s
          </span>
        </div>
        {stats ? (
          <div className="space-y-0.5">
            <TimingRow label="audio→worker" stats={stats.chunkArrivalMs} hint="capture-processor → DSP worker arrival; growing drift here = mobile audio-clock skew or buffer accumulation" showDrift />
            <TimingRow label="worker total" stats={stats.workerProcessingMs} hint="formants + tilt + HNR (every 6th frame); pitch is in pitch-worker, see SwiftF0 inference timings below" />
            <TimingRow label="worker→main" stats={stats.handoffToMainMs} hint="DSP postMessage → main onmessage" />
            <TimingRow label="main handler" stats={stats.mainHandlerMs} hint="handleAnalysisResult duration" />
            <TimingRow label="end-to-end" stats={stats.totalMs} hint="audio captured (ctx time → epoch) → display update" showDrift />
          </div>
        ) : (
          <div className="text-neutral-500 text-[10px]">waiting for first frame…</div>
        )}
      </div>

      {/* Sparkline */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] uppercase text-neutral-500 mb-1 tracking-wider">
          <span>Last 5s</span>
          <span className="text-[9px] normal-case">
            <span className="text-amber-400">pitch</span>{" · "}
            <span className="text-cyan-400">conf</span>{" · "}
            <span className="text-orange-400">rms×4</span>
          </span>
        </div>
        <Sparkline frames={frames} />
        <div className="grid grid-cols-3 gap-2 mt-1 text-[9px] text-neutral-400 font-mono">
          <div>n={frames.length}</div>
          <div>queue={frames.length ? frames[frames.length - 1].pendingChunks : "—"}</div>
          <div>hidden={diagState?.framesWhileHidden ?? 0}</div>
        </div>
      </div>

      {/* Audio context */}
      <div className="mb-3">
        <div className="text-[10px] uppercase text-neutral-500 mb-1 tracking-wider">Audio context</div>
        {audio ? (
          <div className="space-y-0.5 text-[10px] text-neutral-300 font-mono">
            <div>captureSource: <span className={audio.captureKind === "mstp" ? "text-cyan-400" : "text-neutral-200"}>{audio.captureKind ?? "—"}</span>{audio.captureKindOverride ? <span className="text-amber-400"> (forced)</span> : null}</div>
            <div>sampleRate: <span className={audio.sampleRate < 44100 ? "text-amber-400" : "text-neutral-200"}>{audio.sampleRate} Hz</span></div>
            <div>baseLatency: {audio.baseLatencySec != null ? fmtMs(audio.baseLatencySec * 1000) : "—"} · outputLatency: {audio.outputLatencySec != null ? fmtMs(audio.outputLatencySec * 1000) : "—"}</div>
            {audio.audioWorkletSupported !== undefined && (
              <div>worklet: <span className={audio.audioWorkletSupported ? "text-green-400" : "text-red-400"}>{audio.audioWorkletSupported ? "✓ AudioWorklet" : "✗ ScriptProcessor fallback"}</span></div>
            )}
            {audio.grantedConstraints && (
              <div className="text-[9px] text-neutral-400 leading-tight">
                granted: ec={String(audio.grantedConstraints.echoCancellation)} ns={String(audio.grantedConstraints.noiseSuppression)} agc={String(audio.grantedConstraints.autoGainControl)}
                {audio.grantedConstraints.sampleRate ? ` sr=${audio.grantedConstraints.sampleRate}` : ""}
              </div>
            )}
          </div>
        ) : (
          <div className="text-neutral-500 text-[10px]">not yet started…</div>
        )}
      </div>

      {/* Tap latency + lifecycle */}
      <div className="mb-3 flex justify-between text-[10px] text-neutral-300 font-mono">
        <span>tap age: {fmtNum(tapAgeMs / 1000, 1)}s</span>
        <span>vis: <span className={typeof document !== "undefined" && document.visibilityState === "visible" ? "text-green-400" : "text-amber-400"}>{typeof document !== "undefined" ? document.visibilityState : "—"}</span></span>
      </div>

      <button
        onClick={downloadSnapshot}
        className="w-full bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] py-1.5 rounded transition-colors"
      >
        Snapshot last 5s ↓
      </button>
    </div>
  );
}
