// DataManagement.jsx — Settings/data panel: export, import, delete all, audio recording toggle

import { useState, useRef, useEffect } from "react";
import db from "../db";

export function DataManagement({ onClose }) {
  const [recordAudio, setRecordAudio] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    db.settings.get("default").then((s) => {
      if (s?.recordAudio) setRecordAudio(true);
    });
  }, []);

  async function toggleRecordAudio() {
    const next = !recordAudio;
    setRecordAudio(next);
    const existing = await db.settings.get("default");
    if (existing) {
      await db.settings.update("default", { recordAudio: next, updatedAt: Date.now() });
    } else {
      await db.settings.put({
        id: "default",
        recordAudio: next,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  async function exportData() {
    setStatus("Exporting...");
    try {
      const sessions = await db.sessions.toArray();
      const frames = await db.frames.toArray();
      const settings = await db.settings.toArray();

      // Strip audioBlob from sessions (too large for JSON)
      // eslint-disable-next-line no-unused-vars
      const sessionsClean = sessions.map(({ audioBlob, ...rest }) => rest);

      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
        sessions: sessionsClean,
        frames,
      };

      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `syrinx-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Export complete!");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`);
    }
  }

  async function importData(file) {
    setImporting(true);
    setStatus("Importing...");
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version || !data.sessions || !data.frames) {
        throw new Error("Invalid export file format");
      }

      // Import settings
      if (data.settings?.length) {
        for (const s of data.settings) {
          await db.settings.put(s);
        }
      }

      // Import sessions (strip auto-increment id, let Dexie assign new ones)
      const idMap = {};
      for (const session of data.sessions) {
        const { id: oldId, ...rest } = session;
        const newId = await db.sessions.add(rest);
        idMap[oldId] = newId;
      }

      // Import frames with remapped sessionIds
      // eslint-disable-next-line no-unused-vars
      const frameBatch = data.frames.map(({ id, sessionId, ...rest }) => ({
        ...rest,
        sessionId: idMap[sessionId] ?? sessionId,
      }));

      // Batch in chunks of 5000 to avoid memory issues
      for (let i = 0; i < frameBatch.length; i += 5000) {
        await db.frames.bulkAdd(frameBatch.slice(i, i + 5000));
      }

      setStatus(`Imported ${data.sessions.length} sessions!`);
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteAllData() {
    setStatus("Deleting...");
    await db.frames.clear();
    await db.sessions.clear();
    await db.settings.clear();
    await db.exerciseResults.clear();
    setStatus("All data deleted");
    setTimeout(() => setStatus(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 max-w-sm w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-light text-white">Settings & Data</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Audio recording toggle */}
        <div className="mb-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm text-neutral-300">
                Record audio with sessions
              </span>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Audio uses ~10MB per 30 minutes
              </p>
            </div>
            <button
              onClick={toggleRecordAudio}
              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                recordAudio ? "bg-purple-600" : "bg-neutral-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  recordAudio ? "translate-x-5" : ""
                }`}
              />
            </button>
          </label>
        </div>

        <hr className="border-neutral-800 mb-4" />

        {/* Data management */}
        <div className="space-y-2.5">
          <button
            onClick={exportData}
            className="w-full text-left px-3 py-2 rounded-lg bg-neutral-800/60 hover:bg-neutral-700/60 text-sm text-neutral-300 transition-colors cursor-pointer border border-neutral-700"
          >
            Export all data as JSON
          </button>

          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="w-full text-left px-3 py-2 rounded-lg bg-neutral-800/60 hover:bg-neutral-700/60 text-sm text-neutral-300 transition-colors cursor-pointer border border-neutral-700 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import data from JSON"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importData(file);
              }}
            />
          </div>

          <button
            onClick={() => {
              if (confirm("Delete ALL sessions, frames, and settings? This cannot be undone.")) {
                deleteAllData();
              }
            }}
            className="w-full text-left px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-sm text-red-400 transition-colors cursor-pointer border border-red-500/20"
          >
            Delete all data
          </button>
        </div>

        {status && (
          <p className="text-xs text-neutral-400 mt-3 text-center">{status}</p>
        )}
      </div>
    </div>
  );
}
