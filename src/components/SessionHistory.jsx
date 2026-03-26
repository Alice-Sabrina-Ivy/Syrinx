// SessionHistory.jsx — Past sessions list with expandable cards + detail traces

import { useState, useEffect, useRef, useMemo } from "react";
import db from "../db";
import {
  DEFAULT_PITCH_TARGET,
  DEFAULT_F2_TARGET,
  PITCH_DISPLAY_RANGE,
  F2_DISPLAY_RANGE,
  COLORS,
} from "../utils/constants";

export function SessionHistory() {
  const [sessions, setSessions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    db.sessions
      .orderBy("startedAt")
      .reverse()
      .toArray()
      .then((all) => {
        if (!cancelled) {
          setSessions(all);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function deleteSession(id) {
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
            {formatDuration(session.durationSeconds)}
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
              Pitch in target:{" "}
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
              F2 in target:{" "}
              <span
                className={
                  session.pctTimeInResonanceTarget >= 50
                    ? "text-blue-400"
                    : "text-orange-400"
                }
              >
                {fmtPct(session.pctTimeInResonanceTarget)}
              </span>
            </span>
          )}
        </div>

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
            <Stat label="Pitch in Target" value={fmtPct(session.pctTimeInPitchTarget)} />
            <Stat label="F2 in Target" value={fmtPct(session.pctTimeInResonanceTarget)} />
            <Stat label="Total Duration" value={formatDuration(session.durationSeconds)} />
            <Stat label="Voiced Duration" value={formatDuration(session.voicedDurationSeconds)} />
          </div>

          {session.notes && (
            <p className="text-xs text-neutral-400 mt-3 italic">{session.notes}</p>
          )}

          {/* Static traces */}
          <SessionTraces sessionId={session.id} />

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
function SessionTraces({ sessionId }) {
  const [frames, setFrames] = useState(null);
  const pitchCanvasRef = useRef(null);
  const resCanvasRef = useRef(null);
  const pitchContainerRef = useRef(null);
  const resContainerRef = useRef(null);

  useEffect(() => {
    db.frames
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestampMs")
      .then(setFrames);
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

    drawStaticPitchTrace(canvas, frames, dpr);
  }, [frames]);

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

    drawStaticResonanceTrace(canvas, frames, dpr);
  }, [frames]);

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

function drawStaticPitchTrace(canvas, frames, dpr) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const targetLow = DEFAULT_PITCH_TARGET.low;
  const targetHigh = DEFAULT_PITCH_TARGET.high;
  const displayLow = PITCH_DISPLAY_RANGE.low;
  const displayHigh = PITCH_DISPLAY_RANGE.high;

  const pad = { left: 42 * dpr, right: 12 * dpr, top: 6 * dpr, bottom: 20 * dpr };
  const plotLeft = pad.left;
  const plotRight = w - pad.right;
  const plotTop = pad.top;
  const plotBottom = h - pad.bottom;

  const totalMs = frames[frames.length - 1].timestampMs;

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

  // Target band
  const bandTop = hzToY(targetHigh);
  const bandBottom = hzToY(targetLow);
  ctx.fillStyle = COLORS.targetBand;
  ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);
  ctx.strokeStyle = COLORS.targetBandBorder;
  ctx.lineWidth = 1;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(plotLeft, bandTop);
  ctx.lineTo(plotRight, bandTop);
  ctx.moveTo(plotLeft, bandBottom);
  ctx.lineTo(plotRight, bandBottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Pitch line
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let inSegment = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.voiced || f.f0 == null) {
      if (inSegment) { ctx.stroke(); inSegment = false; }
      continue;
    }
    const x = msToX(f.timestampMs);
    const y = hzToY(f.f0);
    const inTarget = f.f0 >= targetLow && f.f0 <= targetHigh;

    if (!inSegment) {
      ctx.beginPath();
      ctx.strokeStyle = inTarget ? COLORS.inTarget : COLORS.outOfTarget;
      ctx.moveTo(x, y);
      inSegment = true;
    } else {
      const prev = frames[i - 1];
      const prevInTarget = prev?.voiced && prev.f0 != null && prev.f0 >= targetLow && prev.f0 <= targetHigh;
      if (inTarget !== prevInTarget) {
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = inTarget ? COLORS.inTarget : COLORS.outOfTarget;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  if (inSegment) ctx.stroke();
}

function drawStaticResonanceTrace(canvas, frames, dpr) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const targetLow = DEFAULT_F2_TARGET.low;
  const targetHigh = DEFAULT_F2_TARGET.high;
  const displayLow = F2_DISPLAY_RANGE.low;
  const displayHigh = F2_DISPLAY_RANGE.high;

  const pad = { left: 42 * dpr, right: 12 * dpr, top: 6 * dpr, bottom: 20 * dpr };
  const plotLeft = pad.left;
  const plotRight = w - pad.right;
  const plotTop = pad.top;
  const plotBottom = h - pad.bottom;

  const totalMs = frames[frames.length - 1].timestampMs;

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

  // Target band
  const bandTop = hzToY(targetHigh);
  const bandBottom = hzToY(targetLow);
  ctx.fillStyle = COLORS.resTargetBand;
  ctx.fillRect(plotLeft, bandTop, plotRight - plotLeft, bandBottom - bandTop);
  ctx.strokeStyle = COLORS.resTargetBandBorder;
  ctx.lineWidth = 1;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(plotLeft, bandTop);
  ctx.lineTo(plotRight, bandTop);
  ctx.moveTo(plotLeft, bandBottom);
  ctx.lineTo(plotRight, bandBottom);
  ctx.stroke();
  ctx.setLineDash([]);

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
    const inTarget = f.f2 >= targetLow;

    if (!inSegment) {
      ctx.beginPath();
      ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
      ctx.moveTo(x, y);
      inSegment = true;
    } else {
      const prev = frames[i - 1];
      const prevInTarget = prev?.voiced && prev.f2 != null && prev.f2 >= targetLow;
      if (inTarget !== prevInTarget) {
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = inTarget ? COLORS.resInTarget : COLORS.resOutOfTarget;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  }
  if (inSegment) ctx.stroke();
}
