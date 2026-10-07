// SessionHistory.jsx — Past sessions list with expandable cards + detail traces
//
// Targets come from each session's own direction log (the training
// direction(s) in effect while it was recorded — utils/trainingDirection.js),
// so a session is always judged against what the user was aiming for then.
// Sessions recorded before directions existed have no log: their traces
// are drawn neutrally with no band, and their stored time-in-range figures
// are labelled with the fixed range they were computed against.

import { useState, useEffect, useRef, useMemo } from "react";
import db from "../db";
import { EXCURSION_SEMI } from "../audio/pitchPaintGate";
import { isLiveSession } from "../utils/sessionRepair";
import {
  PITCH_DISPLAY_RANGE,
  F2_DISPLAY_RANGE,
  COLORS,
} from "../utils/constants";
import {
  directionAt,
  directionsUsed,
  directionLabel,
  pitchTargetFor,
  f2TargetFor,
  inTarget as isInTarget,
  bandForDisplay,
  formatTarget,
} from "../utils/trainingDirection";

// The fixed ranges sessions recorded before training directions existed
// were scored against (their stored pctTimeIn* figures) — labels only.
const LEGACY_PITCH_RANGE_LABEL = "165–255 Hz";
const LEGACY_F2_RANGE_LABEL = "≥ 1400 Hz";

function hasDirectionLog(session) {
  return Array.isArray(session.directionLog) && session.directionLog.length > 0;
}

// "More feminine", "More feminine → Just exploring", or null (legacy).
function goalText(session) {
  if (!hasDirectionLog(session)) return null;
  return directionsUsed(session.directionLog).map(directionLabel).join(" → ");
}

// Label for a time-in-target stat: "Pitch in target (165–255 Hz)" for a
// single-direction session, "Pitch in target" when it changed, the fixed
// range for legacy sessions.
function targetStatLabel(session, kind) {
  if (!hasDirectionLog(session)) {
    return kind === "pitch" ? `Pitch in ${LEGACY_PITCH_RANGE_LABEL}` : `F2 ${LEGACY_F2_RANGE_LABEL}`;
  }
  const used = directionsUsed(session.directionLog);
  const base = kind === "pitch" ? "Pitch in target" : "F2 in target";
  if (used.length !== 1) return base;
  const t = kind === "pitch" ? pitchTargetFor(used[0]) : f2TargetFor(used[0]);
  return t ? `${base} (${formatTarget(t)})` : base;
}

export function SessionHistory() {
  const [sessions, setSessions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  // IndexedDB can be unavailable (site data blocked, some private modes):
  // without a catch the query rejected silently and the list showed
  // "Loading sessions..." forever.
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      db.sessions
        .orderBy("startedAt")
        .reverse()
        .toArray()
        .then((all) => {
          if (!cancelled) {
            setSessions(all);
            setError(null);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to load sessions:", err);
          if (!cancelled) {
            setError("Session storage unavailable");
            setLoading(false);
          }
        });
    };
    load();
    // A session can finalize asynchronously (flush → recorder stop →
    // stats → sessions.update) while this list is mounted — e.g. the
    // start-up repair of interrupted sessions — so the initial query can
    // show it without duration/stats. Re-query when a finalize announces
    // completion.
    window.addEventListener("syrinx:session-finalized", load);
    // Delete-all / import in the settings overlay (which renders OVER
    // this still-mounted list) — without this the list kept showing
    // deleted sessions and missed imported ones.
    window.addEventListener("syrinx:data-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("syrinx:session-finalized", load);
      window.removeEventListener("syrinx:data-changed", load);
    };
  }, []);

  async function deleteSession(id) {
    // If this is the dashboard's in-progress recording (History is
    // reachable mid-recording), stop it first — otherwise its flush
    // interval keeps writing frames against the deleted id.
    window.dispatchEvent(new CustomEvent("syrinx:abort-recording", { detail: { sessionId: id } }));
    await db.frames.where("sessionId").equals(id).delete();
    await db.sessions.delete(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-neutral-500 animate-pulse">Loading sessions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-1">{error}</p>
          <p className="text-neutral-600 text-sm">
            Your browser is blocking site storage, so sessions can&apos;t be saved or shown.
          </p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-neutral-400 mb-1">No sessions recorded yet</p>
          <p className="text-neutral-600 text-sm">
            Go to Dashboard and click &quot;Save Session&quot; to start recording
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4">
      <div className="max-w-2xl mx-auto space-y-3">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            expanded={expandedId === session.id}
            onToggle={() =>
              setExpandedId(expandedId === session.id ? null : session.id)
            }
            onDelete={() => deleteSession(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, expanded, onToggle, onDelete }) {
  const formatDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDuration = (secs) => {
    if (secs == null) return "--:--";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const fmtHz = (v) => (v != null ? `${Math.round(v)} Hz` : "--");
  const fmtPct = (v) => (v != null ? `${v}%` : "--");

  return (
    <div
      className={`rounded-xl border transition-colors ${
        expanded
          ? "border-neutral-600 bg-neutral-800/60"
          : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
      }`}
    >
      {/* Card header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-neutral-300">
              {formatDate(session.startedAt)}
            </span>
            <span className="text-neutral-600 mx-2">·</span>
            <span className="text-xs text-neutral-500">
              {formatTime(session.startedAt)}
            </span>
          </div>
          <span className="text-xs text-neutral-500 font-mono tabular-nums">
            {session.endedAt == null && isLiveSession(session.id)
              ? "recording…"
              : formatDuration(session.durationSeconds)}
          </span>
        </div>

        {/* Mini summary */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
          <span className="text-neutral-400">
            F0: <span className="text-neutral-300">{fmtHz(session.avgF0)}</span>
          </span>
          <span className="text-neutral-400">
            F2: <span className="text-neutral-300">{fmtHz(session.avgF2)}</span>
          </span>
          {session.pctTimeInPitchTarget != null && (
            <span className="text-neutral-400">
              {targetStatLabel(session, "pitch")}:{" "}
              <span
                className={
                  session.pctTimeInPitchTarget >= 50
                    ? "text-green-400"
                    : "text-red-400"
                }
              >
                {fmtPct(session.pctTimeInPitchTarget)}
              </span>
            </span>
          )}
          {session.pctTimeInResonanceTarget != null && (
            <span className="text-neutral-400">
              {targetStatLabel(session, "f2")}:{" "}
              <span
                className={
                  session.pctTimeInResonanceTarget >= 50
                    ? "text-green-400"
                    : "text-red-400"
                }
              >
                {fmtPct(session.pctTimeInResonanceTarget)}
              </span>
            </span>
          )}
        </div>

        {goalText(session) && (
          <p className="text-[11px] text-neutral-500 mt-1">Goal: {goalText(session)}</p>
        )}

        {session.notes && (
          <p className="text-xs text-neutral-500 mt-1 truncate italic">
            {session.notes}
          </p>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-neutral-700/50">
          {/* Full stats breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-3 text-xs">
            <Stat label="Avg F0" value={fmtHz(session.avgF0)} />
            <Stat label="Median F0" value={fmtHz(session.medianF0)} />
            <Stat label="Pitch Range" value={
              session.pitchRangeLow != null
                ? `${Math.round(session.pitchRangeLow)}–${Math.round(session.pitchRangeHigh)} Hz`
                : "--"
            } />
            <Stat label="Pitch Stdev" value={
              session.pitchStdev != null ? `${session.pitchStdev.toFixed(1)} Hz` : "--"
            } />
            <Stat label="Avg F2" value={fmtHz(session.avgF2)} />
            <Stat label="Median F2" value={fmtHz(session.medianF2)} />
            <Stat label="Avg Spectral Tilt" value={
              session.avgSpectralTilt != null
                ? `${session.avgSpectralTilt.toFixed(1)} dB`
                : "--"
            } />
            <Stat label="Avg HNR" value={
              session.avgHnr != null ? `${session.avgHnr.toFixed(1)} dB` : "--"
            } />
            <Stat label={targetStatLabel(session, "pitch")} value={fmtPct(session.pctTimeInPitchTarget)} />
            <Stat label={targetStatLabel(session, "f2")} value={fmtPct(session.pctTimeInResonanceTarget)} />
            <Stat label="Total Duration" value={formatDuration(session.durationSeconds)} />
            <Stat label="Voiced Duration" value={formatDuration(session.voicedDurationSeconds)} />
          </div>

          {session.notes && (
            <p className="text-xs text-neutral-400 mt-3 italic">{session.notes}</p>
          )}

          {/* Static traces */}
          <SessionTraces sessionId={session.id} directionLog={hasDirectionLog(session) ? session.directionLog : null} />

          {/* Audio playback */}
          {session.audioBlob && <AudioPlayer blob={session.audioBlob} />}

          {/* Delete button */}
          <div className="mt-3 flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this session and all its data?")) {
                  onDelete();
                }
              }}
              className="text-xs text-red-400/60 hover:text-red-400 transition-colors cursor-pointer"
            >
              Delete session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-300 ml-1.5">{value}</span>
    </div>
  );
}

function AudioPlayer({ blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <div className="mt-3">
      <audio controls src={url} className="w-full h-8" />
    </div>
  );
}

// Static pitch + resonance traces for a completed session
function SessionTraces({ sessionId, directionLog }) {
  const [frames, setFrames] = useState(null);
  const pitchCanvasRef = useRef(null);
  const resCanvasRef = useRef(null);
  const pitchContainerRef = useRef(null);
  const resContainerRef = useRef(null);
  // Re-draw on container resize (rotation, window resize) — the canvases
  // are CSS-stretched, so without this the bitmaps distort until the
  // card is collapsed and re-expanded. Keyed on the containers EXISTING:
  // they only render once frames have loaded, so a mount-time ([] deps)
  // effect ran while "Loading traces..." was showing, found both refs
  // null, and observed nothing.
  const [resizeTick, setResizeTick] = useState(0);
  const hasTraces = !!frames && frames.length > 0;
  useEffect(() => {
    if (!hasTraces) return;
    const obs = new ResizeObserver(() => setResizeTick((t) => t + 1));
    if (pitchContainerRef.current) obs.observe(pitchContainerRef.current);
    if (resContainerRef.current) obs.observe(resContainerRef.current);
    return () => obs.disconnect();
  }, [hasTraces]);

  const [framesError, setFramesError] = useState(false);
  useEffect(() => {
    db.frames
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestampMs")
      .then(setFrames)
      .catch((err) => {
        console.error("Failed to load session frames:", err);
        setFramesError(true);
      });
  }, [sessionId]);

  // Draw pitch trace
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    const canvas = pitchCanvasRef.current;
    const container = pitchContainerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    drawStaticPitchTrace(canvas, frames, dpr, directionLog);
  }, [frames, resizeTick, directionLog]);

  // Draw resonance trace
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    const canvas = resCanvasRef.current;
    const container = resContainerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    drawStaticResonanceTrace(canvas, frames, dpr, directionLog);
  }, [frames, resizeTick, directionLog]);

  if (framesError) {
    return (
      <p className="text-xs text-red-400/80 mt-3">Couldn&apos;t load traces (session storage unavailable)</p>
    );
  }

  if (!frames) {
    return (
      <p className="text-xs text-neutral-600 mt-3 animate-pulse">
        Loading traces...
      </p>
    );
  }

  if (frames.length === 0) {
    return (
      <p className="text-xs text-neutral-600 mt-3">No frame data recorded</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Pitch (F0)
        </span>
        <div
          ref={pitchContainerRef}
          className="relative h-28 rounded-lg overflow-hidden border border-neutral-800 mt-1"
        >
          <canvas
            ref={pitchCanvasRef}
            className="absolute inset-0 w-full h-full"
          />
        </div>
      </div>
      <div>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Resonance (F2)
        </span>
        <div
          ref={resContainerRef}
          className="relative h-28 rounded-lg overflow-hidden border border-neutral-800 mt-1"
        >
          <canvas
            ref={resCanvasRef}
            className="absolute inset-0 w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}

// Target bands for a session: one rect per direction-log segment (a
// session whose direction changed shows each target where it applied).
// No log (legacy) or "Just exploring" segments draw nothing.
function drawTargetBands(ctx, log, targetFor, displayRange, totalMs, msToX, hzToY, plotLeft, plotRight, dpr) {
  if (!log) return;
  for (let i = 0; i < log.length; i++) {
    const band = bandForDisplay(targetFor(log[i].direction), displayRange);
    if (!band) continue;
    const x0 = Math.max(plotLeft, msToX(i === 0 ? 0 : log[i].atMs));
    const x1 = Math.min(plotRight, msToX(i + 1 < log.length ? log[i + 1].atMs : totalMs));
    if (x1 <= x0) continue;
    const top = hzToY(band.high);
    const bottom = hzToY(band.low);
    ctx.fillStyle = COLORS.targetBand;
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    ctx.strokeStyle = COLORS.targetBandBorder;
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x1, top);
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x1, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Line colour for a value at a session time: in/out of that moment's
// target, neutral without one.
function traceColor(log, targetFor, atMs, value) {
  const t = log ? isInTarget(value, targetFor(directionAt(log, atMs))) : null;
  return t === null ? COLORS.neutralTrace : t ? COLORS.inTarget : COLORS.outOfTarget;
}

function drawStaticPitchTrace(canvas, frames, dpr, log) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const displayLow = PITCH_DISPLAY_RANGE.low;
  const displayHigh = PITCH_DISPLAY_RANGE.high;

  const pad = { left: 42 * dpr, right: 12 * dpr, top: 6 * dpr, bottom: 20 * dpr };
  const plotLeft = pad.left;
  const plotRight = w - pad.right;
  const plotTop = pad.top;
  const plotBottom = h - pad.bottom;

  // Single-frame sessions land timestampMs=0 → divide-by-zero in msToX.
  // Floor to 1 so the lone point lands at the trace start instead of NaN.
  const totalMs = Math.max(1, frames[frames.length - 1].timestampMs);

  const hzToY = (hz) => {
    const frac = (hz - displayLow) / (displayHigh - displayLow);
    return plotBottom - frac * (plotBottom - plotTop);
  };
  const msToX = (ms) => plotLeft + (ms / totalMs) * (plotRight - plotLeft);

  // Background
  ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
  ctx.fillRect(0, 0, w, h);

  // Grid
  const gridHz = [100, 150, 200, 250, 300, 350, 400];
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${10 * dpr}px system-ui`;

  for (const hz of gridHz) {
    if (hz < displayLow || hz > displayHigh) continue;
    const y = hzToY(hz);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.gridLabel;
    ctx.fillText(`${hz}`, plotLeft - 4 * dpr, y);
  }

  // Time labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const totalSec = Math.ceil(totalMs / 1000);
  const stepSec = totalSec <= 30 ? 5 : totalSec <= 120 ? 15 : totalSec <= 300 ? 30 : 60;
  for (let sec = 0; sec <= totalSec; sec += stepSec) {
    const x = msToX(sec * 1000);
    if (x < plotLeft || x > plotRight) continue;
    ctx.fillStyle = COLORS.gridLabel;
    const label = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
    ctx.fillText(label, x, plotBottom + 3 * dpr);
  }

  // Target band(s)
  drawTargetBands(ctx, log, pitchTargetFor, PITCH_DISPLAY_RANGE, totalMs, msToX, hzToY, plotLeft, plotRight, dpr);

  // Pitch line. Clip to the plot rect: sessions recorded before the
  // 2026-06-10 detector-floor change can hold stored F0 below the 75 Hz
  // display floor, which would otherwise paint under the chart here too.
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
  ctx.clip();

  // Draw the live trace's voiced frames: frames recorded since 2026-10-03
  // carry the paint-gate decision (`painted`); a recorded-but-unpainted
  // frame (octave excursion the live gate suppressed) is a gap here too.
  // Frames the live trace bridged with the 400 ms pitch hold are recorded
  // voiced:false and are gaps here (a sizeable share of live-painted
  // hops on the private session recordings, 2026-10-04) — history is
  // not an exact replica.
  // Legacy frames (no field) draw as before. Stats keep using voiced/f0.
  let inSegment = false;
  let lastDrawnF0 = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.voiced || f.f0 == null || f.painted === false) {
      if (inSegment) { ctx.stroke(); inSegment = false; }
      lastDrawnF0 = null;
      continue;
    }
    const x = msToX(f.timestampMs);
    const y = hzToY(f.f0);
    const color = traceColor(log, pitchTargetFor, f.timestampMs, f.f0);
    // Octave-class step: start a new segment rather than stroking a
    // near-vertical connecting line (same rule as the live trace).
    if (inSegment && lastDrawnF0 !== null &&
        Math.abs(12 * Math.log2(f.f0 / lastDrawnF0)) >= EXCURSION_SEMI) {
      ctx.stroke();
      inSegment = false;
    }
    lastDrawnF0 = f.f0;

    if (!inSegment) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.moveTo(x, y);
      inSegment = true;
    } else {
      const prev = frames[i - 1];
      const prevColor = prev?.voiced && prev.f0 != null ? traceColor(log, pitchTargetFor, prev.timestampMs, prev.f0) : null;
      if (color !== prevColor) {
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  if (inSegment) ctx.stroke();
  ctx.restore(); // end plot-rect clip
}

function drawStaticResonanceTrace(canvas, frames, dpr, log) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const displayLow = F2_DISPLAY_RANGE.low;
  const displayHigh = F2_DISPLAY_RANGE.high;

  const pad = { left: 42 * dpr, right: 12 * dpr, top: 6 * dpr, bottom: 20 * dpr };
  const plotLeft = pad.left;
  const plotRight = w - pad.right;
  const plotTop = pad.top;
  const plotBottom = h - pad.bottom;

  // Single-frame sessions land timestampMs=0 → divide-by-zero in msToX.
  // Floor to 1 so the lone point lands at the trace start instead of NaN.
  const totalMs = Math.max(1, frames[frames.length - 1].timestampMs);

  const hzToY = (hz) => {
    const frac = (hz - displayLow) / (displayHigh - displayLow);
    return plotBottom - frac * (plotBottom - plotTop);
  };
  const msToX = (ms) => plotLeft + (ms / totalMs) * (plotRight - plotLeft);

  // Background
  ctx.fillStyle = "rgba(10, 10, 10, 0.95)";
  ctx.fillRect(0, 0, w, h);

  // Grid
  const gridHz = [1000, 1500, 2000, 2500, 3000, 3500];
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${10 * dpr}px system-ui`;

  for (const hz of gridHz) {
    if (hz < displayLow || hz > displayHigh) continue;
    const y = hzToY(hz);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.gridLabel;
    ctx.fillText(`${hz}`, plotLeft - 4 * dpr, y);
  }

  // Time labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const totalSec = Math.ceil(totalMs / 1000);
  const stepSec = totalSec <= 30 ? 5 : totalSec <= 120 ? 15 : totalSec <= 300 ? 30 : 60;
  for (let sec = 0; sec <= totalSec; sec += stepSec) {
    const x = msToX(sec * 1000);
    if (x < plotLeft || x > plotRight) continue;
    ctx.fillStyle = COLORS.gridLabel;
    const label = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
    ctx.fillText(label, x, plotBottom + 3 * dpr);
  }

  // Target band(s)
  drawTargetBands(ctx, log, f2TargetFor, F2_DISPLAY_RANGE, totalMs, msToX, hzToY, plotLeft, plotRight, dpr);

  // F2 line
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let inSegment = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.voiced || f.f2 == null) {
      if (inSegment) { ctx.stroke(); inSegment = false; }
      continue;
    }
    const x = msToX(f.timestampMs);
    const y = hzToY(f.f2);
    const color = traceColor(log, f2TargetFor, f.timestampMs, f.f2);

    if (!inSegment) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.moveTo(x, y);
      inSegment = true;
    } else {
      const prev = frames[i - 1];
      const prevColor = prev?.voiced && prev.f2 != null ? traceColor(log, f2TargetFor, prev.timestampMs, prev.f2) : null;
      if (color !== prevColor) {
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  if (inSegment) ctx.stroke();
}
