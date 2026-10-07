// DataManagement.jsx — Settings/data panel: training direction, audio
// recording toggle, export, import, delete all.
//
// A modal dialog (App makes the page behind it inert): focus moves to the
// panel when it opens and back to the gear when it closes (App), Escape
// closes it. It is where the training direction is changed mid-session.

import { useState, useRef, useEffect } from "react";
import db from "../db";
import {
  exportHeader,
  createFrameSerializer,
  EXPORT_FOOTER,
  stripSessionForExport,
  importExport,
} from "../utils/exportFormat";
import { DirectionOptions } from "./DirectionPrompt";

// Export assembly: frame lines are concatenated into ~1 MB strings, and
// every ~32 MB of those are folded into a Blob (the browser's blob store,
// off the JS heap). Never one giant string — the old JSON.stringify of
// every frame hit V8's max string length (RangeError at ~2.58 M frames,
// ~18 h recorded).
const EXPORT_CHUNK_CHARS = 1 << 20;
const EXPORT_COLLAPSE_CHARS = 32 << 20;

// Tells views that cache DB contents (SessionHistory, mounted under this
// overlay) to reload after a bulk change — delete-all or import.
function announceDataChanged() {
  window.dispatchEvent(new CustomEvent("syrinx:data-changed"));
}

export function DataManagement({ onClose, direction = null, onDirectionChange }) {
  const [recordAudio, setRecordAudio] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    db.settings.get("default").then((s) => {
      if (s?.recordAudio) setRecordAudio(true);
    });
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      const settings = await db.settings.toArray();

      // Same version-1 schema as before, laid out one frame record per
      // line (see utils/exportFormat.js) and assembled from parts. Frames
      // are streamed per session off an IndexedDB cursor, so neither the
      // frame rows nor their JSON are ever materialized all at once.
      // audioBlob is stripped from sessions (JSON can't carry it).
      let parts = [exportHeader({
        exportedAt: new Date().toISOString(),
        settings,
        sessions: sessions.map(stripSessionForExport),
      })];
      let pendingChars = 0;
      let chunk = "";
      const frameLine = createFrameSerializer();
      const pushChunk = () => {
        if (!chunk) return;
        parts.push(chunk);
        pendingChars += chunk.length;
        chunk = "";
        if (pendingChars >= EXPORT_COLLAPSE_CHARS) {
          parts = [new Blob(parts)];
          pendingChars = 0;
        }
      };
      for (const session of sessions) {
        await db.frames.where("sessionId").equals(session.id).each((frame) => {
          chunk += frameLine(frame);
          if (chunk.length >= EXPORT_CHUNK_CHARS) pushChunk();
        });
      }
      pushChunk();
      parts.push(EXPORT_FOOTER);

      const blob = new Blob(parts, { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `syrinx-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the browser has time to start the download. Some
      // browsers cancel the in-flight save if the URL goes away too fast.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      // Raw bytes up front (compact, off the JS string heap), then parsed
      // record by record — synchronously — inside the transaction. An
      // IndexedDB transaction auto-commits at the first await on anything
      // that isn't an IndexedDB request, so the file can't be streamed
      // from disk mid-transaction; reading it first keeps the import
      // atomic while still never building one giant string (file.text()
      // hit the same max-string-length wall as the old export) or one
      // giant frames array. Older single-line exports fall back to a
      // whole-document JSON.parse inside iterateExportRecords.
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Single rw transaction: a failure mid-import (quota, malformed
      // row, tab close) rolls everything back instead of committing a
      // partial import that a retry would then duplicate. Merge policy
      // (dedupe sessions by startedAt, reject ones without it, settings
      // merged field-wise without overwriting local values or importing
      // recordAudio) lives in importExport — utils/exportFormat.js.
      const counts = await db.transaction("rw", db.settings, db.sessions, db.frames, () =>
        importExport(bytes, {
          getSettings: (id) => db.settings.get(id),
          putSettings: (row) => db.settings.put(row),
          sessionStartTimes: () => db.sessions.orderBy("startedAt").keys(),
          addSession: (row) => db.sessions.add(row),
          addFrames: (rows) => db.frames.bulkAdd(rows),
        }),
      );

      announceDataChanged();
      setStatus(
        `Imported ${counts.accepted} session${counts.accepted === 1 ? "" : "s"} · ` +
        `skipped ${counts.skipped} already present · ` +
        `rejected ${counts.rejected} without a start time`,
      );
      setTimeout(() => setStatus(null), 6000);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteAllData() {
    setStatus("Deleting...");
    // Abort any in-progress recording BEFORE wiping: the dashboard stays
    // mounted under this overlay and would otherwise keep flushing
    // frames against a deleted session id every second (orphan rows,
    // invisible in History, undeletable except by another wipe) and
    // later no-op-finalize the vanished session.
    window.dispatchEvent(new CustomEvent("syrinx:abort-recording"));
    try {
      await db.frames.clear();
      await db.sessions.clear();
      await db.settings.clear();
      await db.exerciseResults.clear();
    } catch (err) {
      setStatus(`Delete failed: ${err.message}`);
      return;
    } finally {
      // Even a partial wipe changed what History shows.
      announceDataChanged();
    }
    // The settings row (and its recordAudio flag) is gone — reflect the
    // default in the toggle instead of a stale "on".
    setRecordAudio(false);
    setStatus("All data deleted");
    setTimeout(() => setStatus(null), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      data-dialog="settings"
    >
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 max-w-sm w-full shadow-xl max-h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-title" className="text-lg font-light text-white">Settings & Data</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close settings"
            className="text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer text-xl leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 rounded"
          >
            &times;
          </button>
        </div>

        {/* Training direction — applies immediately, also mid-session */}
        {onDirectionChange && (
          <>
            <div className="mb-4">
              <h3 className="text-sm text-neutral-300 mb-0.5">What are you trying to sound like?</h3>
              <p className="text-[11px] text-neutral-500 mb-2">Sets your targets. Changes apply right away — close this panel to see them.</p>
              <DirectionOptions value={direction} onChange={onDirectionChange} compact name="training-direction-settings" />
            </div>
            <hr className="border-neutral-800 mb-4" />
          </>
        )}

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
            {/* A toggle switch to assistive tech: role + on/off state +
                accessible name (it was a bare, unlabeled <button>). */}
            <button
              type="button"
              role="switch"
              aria-checked={recordAudio}
              aria-label="Record audio with sessions"
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
