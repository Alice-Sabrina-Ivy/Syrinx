// DebugPanel.jsx — Live-updating diagnostic panel for pipeline debugging
// Reads from debugRef on a 200ms interval (no React re-render coupling)

import { useState, useEffect } from "react";

export function DebugPanel({ debugRef }) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    const id = setInterval(() => {
      const dbg = debugRef.current;
      if (!dbg) return;
      setSnapshot({
        // Worker layer
        workerChunks: dbg.workerChunks,
        workerPitchDetected: dbg.workerPitchDetected,
        workerPitchNull: dbg.workerPitchNull,
        // Main-thread layer
        framesReceived: dbg.framesReceived,
        framesVoiced: dbg.framesVoiced,
        framesQuiet: dbg.framesQuiet,
        framesNoPitch: dbg.framesNoPitch,
        ratePerSec: dbg.ratePerSec,
        lastResultTime: dbg.lastResultTime,
        // Recent frames (shallow copy)
        recentFrames: dbg.recentFrames.slice(-10),
      });
    }, 200);
    return () => clearInterval(id);
  }, [debugRef]);

  if (!snapshot) {
    return (
      <div className="bg-yellow-900/40 border border-yellow-700/50 rounded-lg px-3 py-2 text-[11px] font-mono text-yellow-200">
        DEBUG: Waiting for first analysis frame...
      </div>
    );
  }

  const staleMs = snapshot.lastResultTime > 0
    ? Date.now() - snapshot.lastResultTime
    : null;

  return (
    <div className="bg-yellow-900/40 border border-yellow-700/50 rounded-lg px-3 py-2 text-[11px] font-mono text-yellow-200 leading-relaxed overflow-auto max-h-[280px]">
      <div className="font-bold text-yellow-300 mb-1">PIPELINE DEBUG</div>

      {/* Worker layer */}
      <div className="text-yellow-400 font-bold mt-1">DSP Worker:</div>
      <div>
        Chunks recv: <Val>{snapshot.workerChunks}</Val>{" "}
        | Pitch OK: <Val color="green">{snapshot.workerPitchDetected}</Val>{" "}
        | Pitch null: <Val color="red">{snapshot.workerPitchNull}</Val>
      </div>

      {/* Main thread layer */}
      <div className="text-yellow-400 font-bold mt-1">Main Thread:</div>
      <div>
        Results recv: <Val>{snapshot.framesReceived}</Val>{" "}
        | Rate: <Val>{snapshot.ratePerSec}/s</Val>{" "}
        | Stale: <Val color={staleMs > 200 ? "red" : "green"}>
          {staleMs !== null ? `${staleMs}ms` : "—"}
        </Val>
      </div>

      {/* Silence gate stats */}
      <div className="text-yellow-400 font-bold mt-1">Silence Gate (threshold: -50 dB, debounce: 3 frames):</div>
      <div>
        Voiced: <Val color="green">{snapshot.framesVoiced}</Val>{" "}
        | Gated quiet: <Val color="red">{snapshot.framesQuiet}</Val>{" "}
        | No pitch: <Val color="red">{snapshot.framesNoPitch}</Val>
      </div>

      {/* Per-frame log */}
      <div className="text-yellow-400 font-bold mt-1">Recent Frames (last 10):</div>
      <table className="w-full text-[10px] border-collapse mt-0.5">
        <thead>
          <tr className="text-yellow-500">
            <th className="text-left pr-2">Raw Pitch</th>
            <th className="text-left pr-2">Intensity</th>
            <th className="text-left pr-2">Quiet?</th>
            <th className="text-left pr-2">QRun</th>
            <th className="text-left pr-2">Gated?</th>
            <th className="text-left">Decision</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.recentFrames.map((f, i) => (
            <tr key={i} className={f.decision === "VOICED" ? "text-green-300" : "text-red-300"}>
              <td className="pr-2">{f.rawPitch !== null ? f.rawPitch.toFixed(1) : "null"}</td>
              <td className="pr-2">{f.rawIntensity !== null ? `${f.rawIntensity} dB` : "null"}</td>
              <td className="pr-2">{f.frameQuiet ? "YES" : "no"}</td>
              <td className="pr-2">{f.quietRun}</td>
              <td className="pr-2">{f.isQuiet ? "YES" : "no"}</td>
              <td className="font-bold">{f.decision || "?"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Val({ children, color }) {
  const cls = color === "green"
    ? "text-green-300"
    : color === "red"
      ? "text-red-300"
      : "text-white";
  return <span className={cls}>{children}</span>;
}
