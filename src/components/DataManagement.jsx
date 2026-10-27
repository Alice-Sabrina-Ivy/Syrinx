// DataManagement.jsx — Settings: training direction ("Your goal"), the
// voice-gate switch ("Only show pitch while I'm speaking", was "Hide pitch
// when no voice is heard") with its detector's status, audio recording, the
// experimental "Likely heard as" and Resonance lab switches (App owns
// them), export, import, delete all (an in-sheet confirmation).
//
// Since 2026-10-25 (approved board "Settings as a side sheet"): a 440 px
// sheet on the right at lg+, over a light backdrop without blur so the
// dashboard behind it stays visible and shows a goal change at once; below
// lg a bottom sheet with a grab handle, a 44 px close button and a sticky
// Done. Still a modal dialog (App makes the page behind it inert): focus
// moves to the close button when it opens and back to the gear when it
// closes (App), Escape closes it (or first cancels the delete
// confirmation). It is where the training direction is changed mid-session.

import { useState, useRef, useEffect } from "react";
import db from "../db";
import {
  exportHeader,
  createFrameSerializer,
  EXPORT_FOOTER,
  stripSessionForExport,
  importExport,
  exerciseResultKey,
} from "../utils/exportFormat";
import { TRAINING_DIRECTIONS, pitchTargetFor, formatTarget } from "../utils/trainingDirection";
import { HeardAsSwitch } from "./HeardAsPanel";
import { HEARD_AS_DOWNLOAD_MB } from "../ml/heard-as-download";
import { FIRERED_MODEL, fireredModelSource, probeModel } from "../dsp/firered-vad";
import { voiceGateStatusText } from "../utils/voiceGateSetting";
import { HEARD_AS_DEFAULT } from "../utils/heardAsSetting";

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

export function DataManagement({
  onClose, direction = null, onDirectionChange, heardAsEnabled = HEARD_AS_DEFAULT, onHeardAsChange,
  voiceGateEnabled = true, onVoiceGateChange, voiceGateStatus = "idle",
  labEnabled = false, onLabChange,
}) {
  const [recordAudio, setRecordAudio] = useState(false);
  // Before the first listening session: are the model files there?
  const [voiceGateProbe, setVoiceGateProbe] = useState(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);
  // In-sheet "Delete all data?" confirmation (replaced window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sessionCount, setSessionCount] = useState(null);
  const fileInputRef = useRef(null);
  const closeRef = useRef(null);
  const deleteButtonRef = useRef(null);
  const cancelDeleteRef = useRef(null);
  const confirmDeleteRef = useRef(false);
  useEffect(() => {
    confirmDeleteRef.current = confirmDelete;
    if (confirmDelete) cancelDeleteRef.current?.focus();
  }, [confirmDelete]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    db.settings.get("default").then((s) => {
      if (s?.recordAudio) setRecordAudio(true);
    });
  }, []);

  const hasVoiceGate = !!onVoiceGateChange;
  useEffect(() => {
    if (!hasVoiceGate || voiceGateStatus !== "idle") return undefined;
    const source = fireredModelSource({
      appBaseUrl: new URL(`${import.meta.env.BASE_URL}${FIRERED_MODEL.dir}`, window.location.href).href,
    });
    // The mirror is fetched (and cached) when listening starts; probing it
    // here would download from it on every Settings visit.
    if (source.kind === "mirror") { setVoiceGateProbe("mirror"); return undefined; }
    let alive = true;
    probeModel(source.base)
      .then(() => alive && setVoiceGateProbe("ok"))
      .catch(() => alive && setVoiceGateProbe("unavailable"));
    return () => { alive = false; };
  }, [hasVoiceGate, voiceGateStatus]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Escape first cancels an open delete confirmation, then closes.
      if (confirmDeleteRef.current) {
        setConfirmDelete(false);
        setTimeout(() => deleteButtonRef.current?.focus(), 0);
      } else onCloseRef.current();
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
      const exerciseResults = await db.exerciseResults.toArray();

      // Same version-1 schema as before, laid out one frame record per
      // line (see utils/exportFormat.js) and assembled from parts. Frames
      // are streamed per session off an IndexedDB cursor, so neither the
      // frame rows nor their JSON are ever materialized all at once.
      // audioBlob is stripped from sessions (JSON can't carry it).
      let parts = [exportHeader({
        exportedAt: new Date().toISOString(),
        settings,
        sessions: sessions.map(stripSessionForExport),
        exerciseResults,
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
      const counts = await db.transaction("rw", db.settings, db.sessions, db.frames, db.exerciseResults, () =>
        importExport(bytes, {
          getSettings: (id) => db.settings.get(id),
          putSettings: (row) => db.settings.put(row),
          sessionStartTimes: () => db.sessions.orderBy("startedAt").keys(),
          addSession: (row) => db.sessions.add(row),
          addFrames: (rows) => db.frames.bulkAdd(rows),
          exerciseResultKeys: async () => (await db.exerciseResults.toArray()).map(exerciseResultKey),
          addExerciseResult: (row) => db.exerciseResults.add(row),
        }),
      );

      announceDataChanged();
      setStatus(
        `Imported ${counts.accepted} session${counts.accepted === 1 ? "" : "s"} · ` +
        `skipped ${counts.skipped} already present · ` +
        `rejected ${counts.rejected} without a start time` +
        (counts.exercises.accepted
          ? ` · ${counts.exercises.accepted} exercise result${counts.exercises.accepted === 1 ? "" : "s"}`
          : ""),
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
    // default in the toggle instead of a stale "on". Same for the
    // experimental "Likely heard as" panel (default on since 2026-10-25).
    setRecordAudio(false);
    if (heardAsEnabled !== HEARD_AS_DEFAULT) onHeardAsChange?.(HEARD_AS_DEFAULT);
    if (!voiceGateEnabled) onVoiceGateChange?.(true); // the default (on)
    if (labEnabled) onLabChange?.(false); // the default (off)
    setStatus("All data deleted");
    setTimeout(() => setStatus(null), 2000);
  }

  async function openDeleteConfirm() {
    setConfirmDelete(true);
    try {
      setSessionCount(await db.sessions.count());
    } catch {
      setSessionCount(null);
    }
  }

  function closeDeleteConfirm() {
    setConfirmDelete(false);
    // Back to the button that opened it (it is rendered again now).
    setTimeout(() => deleteButtonRef.current?.focus(), 0);
  }

  const sessionsText = sessionCount == null
    ? "all your sessions"
    : `${sessionCount} session${sessionCount === 1 ? "" : "s"}`;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      data-dialog="settings"
    >
      {/* Light backdrop, no blur: the dashboard stays visible behind the
          sheet and shows a goal change at once. The page behind is inert
          (App), so this is the only thing a click outside the sheet hits. */}
      <div className="absolute inset-0 bg-black/60 lg:bg-black/35" aria-hidden="true" onClick={onClose} />

      {/* Phones / tablets: a bottom sheet from 48 px below the top. lg+: a
          440 px sheet on the right, full height. */}
      <div
        className="absolute inset-x-0 bottom-0 top-12 sm:mx-auto sm:max-w-lg flex flex-col bg-neutral-900 border border-neutral-700 border-b-0 rounded-t-2xl shadow-xl lg:inset-y-0 lg:left-auto lg:right-0 lg:mx-0 lg:w-[440px] lg:max-w-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l-neutral-800 lg:shadow-[-16px_0_40px_rgba(0,0,0,0.5)]"
        data-settings-sheet=""
      >
        {/* Sticky header */}
        <div className="shrink-0 border-b border-neutral-800 px-4 lg:px-6">
          <div className="lg:hidden flex justify-center pt-2" aria-hidden="true">
            <span className="block w-10 h-1 rounded-full bg-neutral-600" />
          </div>
          <div className="flex items-center justify-between py-2 lg:py-3">
            <h2 id="settings-title" className="text-lg font-semibold text-neutral-100">Settings</h2>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close settings"
              className={`${ICON_BUTTON} w-11 h-11 text-xl`}
            >
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 lg:px-6 pb-4">
          {/* Training direction — applies immediately, also mid-session;
              the dashboard behind the sheet shows it. */}
          {onDirectionChange && (
            <Section title="Your goal">
              <p className="text-xs text-neutral-400 mb-2">Sets your pitch target. Changes apply right away.</p>
              <GoalTiles value={direction} onChange={onDirectionChange} />
            </Section>
          )}

          {/* Voice gate (FireRedVAD; on by default) */}
          {onVoiceGateChange && (
            <Section title="Practice display">
              <div data-settings-voice-gate="" data-voice-gate-status={voiceGateStatus}>
                <SwitchRow
                  title="Only show pitch while I'm speaking"
                  description="Hides the pitch line during fans or hum."
                  control={(
                    <Switch
                      on={voiceGateEnabled}
                      onChange={onVoiceGateChange}
                      label="Only show pitch while I'm speaking"
                      data-voice-gate-switch=""
                    />
                  )}
                />
                <p className="text-xs text-neutral-400" data-voice-gate-status-text="">
                  {voiceGateStatusText(voiceGateStatus, voiceGateProbe)}
                </p>
                <More id="settings-more-voice-gate">
                  A voice detector hides the pitch line, Hz / note, steadiness and HNR while it hears no voice, such as a fan or hum alone, and keeps most of that noise out of the resonance reading. It can blank parts of long held notes and vowels, more in loud noise, and noise can still show for about 2 s after you stop speaking.
                </More>
              </div>
            </Section>
          )}

          <Section title="Recording">
            <SwitchRow
              title="Keep audio of my sessions"
              description="Stays on this device. About 10 MB per 30 minutes."
              control={<Switch on={recordAudio} onChange={toggleRecordAudio} label="Keep audio of my sessions" />}
            />
          </Section>

          {(onHeardAsChange || onLabChange) && (
            <Section title="Experimental">
              {/* "Likely heard as" (on by default since 2026-10-25; this
                  switch is the only way to turn it off) */}
              {onHeardAsChange && (
                <div data-settings-heard-as="">
                  <SwitchRow
                    title={<>Likely heard as <span className="ml-1.5 align-middle inline-block rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-300 bg-amber-400/10 border border-amber-400/30">Experimental</span></>}
                    description={`A rough range, never a verdict. First use downloads up to ${HEARD_AS_DOWNLOAD_MB} MB.`}
                    control={<HeardAsSwitch on={heardAsEnabled} onChange={onHeardAsChange} label="Likely heard as (experimental)" />}
                  />
                  <More id="settings-more-heard-as">
                    A rough, research-based guess at how listeners might hear your voice, shown as a range, not a verdict. On by default: the first time it runs it downloads a voice model, a speech detector and their engine (up to {HEARD_AS_DOWNLOAD_MB} MB), then keeps them on this device.
                  </More>
                </div>
              )}

              {/* Resonance lab tab (off by default, 2026-10-21) */}
              {onLabChange && (
                <div data-settings-lab="" className={onHeardAsChange ? "mt-2 pt-2 border-t border-neutral-800" : ""}>
                  <SwitchRow
                    title="Resonance lab tab"
                    description="Adds a tab of research readouts of resonance."
                    control={(
                      <Switch
                        on={labEnabled}
                        onChange={onLabChange}
                        label="Show the Resonance lab (experimental)"
                        data-settings-lab-switch=""
                      />
                    )}
                  />
                  <More id="settings-more-lab">
                    Opening the tab loads extra analysis and uses more of your device while you listen.
                  </More>
                </div>
              )}
            </Section>
          )}

          {/* Data management */}
          <Section title="Your data">
            {confirmDelete ? (
              <div
                className="rounded-xl border border-red-500/40 bg-red-500/10 p-3"
                role="group"
                aria-labelledby="settings-delete-title"
                aria-describedby="settings-delete-text"
                data-settings-delete-confirm=""
              >
                <h4 id="settings-delete-title" className="text-sm font-medium text-red-200">Delete all data on this device?</h4>
                <p id="settings-delete-text" className="text-xs text-neutral-300 mt-1">
                  This removes {sessionsText}, their recordings and your settings. It can&rsquo;t be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={exportData} className={`${DATA_BUTTON} flex-1 justify-center whitespace-nowrap`}>
                    Export first
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(false); deleteAllData(); setTimeout(() => deleteButtonRef.current?.focus(), 0); }}
                    className="flex-1 min-h-11 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
                    data-settings-delete-everything=""
                  >
                    Delete everything
                  </button>
                  <button
                    type="button"
                    ref={cancelDeleteRef}
                    onClick={closeDeleteConfirm}
                    className={`${DATA_BUTTON} flex-1 justify-center whitespace-nowrap`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button type="button" onClick={exportData} className={DATA_BUTTON}>
                  <span>Export all data <span className="text-neutral-500">(JSON)</span></span>
                  <Chevron />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className={DATA_BUTTON}
                >
                  <span>{importing ? "Importing..." : <>Import data <span className="text-neutral-500">(JSON)</span></>}</span>
                  <Chevron />
                </button>
                <button
                  type="button"
                  ref={deleteButtonRef}
                  onClick={openDeleteConfirm}
                  className="w-full min-h-12 flex items-center justify-between px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-sm text-red-400 transition-colors cursor-pointer border border-red-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
                  data-settings-delete=""
                >
                  <span>Delete all data&hellip;</span>
                  <Chevron />
                </button>
              </div>
            )}
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
            <p className="text-xs text-neutral-400 mt-3 text-center min-h-4" role="status" data-settings-status="">
              {status}
            </p>
          </Section>

          {/* Licence notices of the bundled third-party code (ONNX Runtime,
              React, Dexie, Transformers.js) ship with the site:
              scripts/third-party-notices.mjs. */}
          <p className="text-xs text-neutral-400 mt-6" data-licence-notices="">
            Syrinx is open source (MIT License).{" "}
            <a
              href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100"
            >
              Licences and third-party notices
            </a>
          </p>
        </div>

        {/* Phones / tablets: Done in thumb reach */}
        <div className="lg:hidden shrink-0 border-t border-neutral-800 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-12 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[15px] font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
            data-settings-done=""
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const ICON_BUTTON =
  "flex items-center justify-center rounded-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-neutral-100 transition-colors cursor-pointer leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";
const DATA_BUTTON =
  "w-full min-h-12 flex items-center justify-between gap-2 px-3 rounded-lg bg-neutral-800/60 hover:bg-neutral-700/60 text-sm text-neutral-300 transition-colors cursor-pointer border border-neutral-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";

function Section({ title, children }) {
  return (
    <section className="pt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Chevron() {
  return <span aria-hidden="true" className="text-neutral-500 text-lg leading-none">&rsaquo;</span>;
}

// A full-row switch: the row is a <label> around the switch button, so a
// tap anywhere on it toggles (a <button> is labelable; a tap on the button
// itself is not dispatched twice). The switch keeps its own aria-label.
function SwitchRow({ title, description, control }) {
  return (
    <label className="flex items-center justify-between gap-3 min-h-14 lg:min-h-11 py-1.5 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm text-neutral-200">{title}</span>
        {description && <span className="block text-xs text-neutral-400 mt-0.5">{description}</span>}
      </span>
      {control}
    </label>
  );
}

function Switch({ on, onChange, label, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`hc-switch relative w-10 h-5 shrink-0 rounded-full transition-colors cursor-pointer ${
        on ? "bg-purple-600" : "bg-neutral-700"
      }`}
      {...rest}
    >
      <span
        className={`hc-switch-thumb absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

// Today's long explanation behind a disclosure.
function More({ id, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 -my-2 text-xs text-neutral-300 underline underline-offset-2 hover:text-neutral-100 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
      >
        {open ? "Less" : "More"}
      </button>
      {open && <p id={id} className="text-xs text-neutral-400 mb-1">{children}</p>}
    </div>
  );
}

function goalHint(id) {
  const pitch = formatTarget(pitchTargetFor(id));
  return pitch ? `Pitch ${pitch}` : "No targets";
}

// The four directions as a 2x2 grid of tiles (min 72 px; selected = filled
// + check). Same radios as the direction question (input[data-direction]),
// so a choice applies at once, as before.
function GoalTiles({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="What are you trying to sound like?" className="grid grid-cols-2 gap-2">
      {TRAINING_DIRECTIONS.map((d) => {
        const selected = value === d.id;
        return (
          <label
            key={d.id}
            className={`relative flex flex-col justify-center min-h-[72px] rounded-xl border px-3 py-2 pr-7 cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-purple-300 ${
              selected
                ? "border-purple-500 bg-purple-500/20"
                : "border-neutral-700 bg-neutral-800/40 hover:border-neutral-500"
            }`}
          >
            <input
              type="radio"
              name="training-direction-settings"
              value={d.id}
              checked={selected}
              onChange={() => onChange(d.id)}
              className="sr-only"
              data-direction={d.id}
            />
            <span className="block text-sm leading-tight text-neutral-100">{d.label}</span>
            <span className="block text-xs text-neutral-400 mt-1">{goalHint(d.id)}</span>
            {selected && (
              <span aria-hidden="true" className="absolute top-2 right-2 flex items-center justify-center w-4 h-4 rounded-full bg-purple-500 text-[10px] text-white">
                &#10003;
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
