// VoicePreviewCard.jsx — the "Voice preview" card (experimental; the Resonance lab's
// third view). A lazy chunk: React loads it when the view is first opened, and loading it
// starts the voice-preview worker (which fetches exactly one .wasm). Record a 3–8 s
// phrase, then hear it with a different pitch or resonance: record -> analyse once in the
// worker -> re-render on slider release -> three-way playback (preview / unchanged
// rebuild / original) with loop. Record, then play only; never live.
// measurements/voice-preview-phase1-2026-10-19.md §6–§10, §13.
//
// State lives outside React, for the page visit (it survives view and tab switches, like
// the lab): the controller (worker lifecycle, recording, render queue), the playback
// (one AudioContext) and a small UI store (slider values, the target row, the live-region
// text). Page hide terminates the worker and closes the AudioContext; nothing is ever
// written to storage. Every user-facing string comes from strings.js.
//
// Accessibility (§10): one labelled section; the Record / Stop / Record again control is
// one button element (focus stays put when a recording ends); controls that cannot act
// stay focusable (aria-disabled) and give their reason in visible text linked with
// aria-describedby; native range inputs with aria-valuetext, committed on release
// (pointer) or 400 ms after the last key; one polite live region for state changes.
// The app's palette is dark only: the card sets color-scheme: dark so native controls
// draw dark whatever the OS theme is.

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createVoicePreviewController, RECORD_MAX_S } from "./controller.js";
import { onVoicePreviewCapture } from "./bridge.js";
import { createPlayback } from "./playback.js";
import { VP_GLUE_URL, VP_WASM_URLS } from "./wasm-files.js";
import { applyPreset, targetSetting, targetPrefillHz } from "./controls.js";
import { encodeWav } from "./wav.js";
import {
  S, readyIn, recordingFor, medianLine, pitchValueLabel, pitchValueText,
  resonanceValueLabel, resonanceValueText, targetResult, downloadName,
} from "./strings.js";
import { pitchTargetFor } from "../utils/trainingDirection.js";
import { DIAG_ENABLED } from "../diag/diag.js";

const RECORDABLE = new Set(["ready", "too-short", "no-voice", "cancelled"]);
const KEY_COMMIT_MS = 400;
const TARGET_MIN_HZ = 75;
const TARGET_MAX_HZ = 400;

// ---------------------------------------------------------------- session (outside React)

function createStore(init) {
  let v = init;
  const ls = new Set();
  return {
    get: () => v,
    set(patch) { v = { ...v, ...patch }; for (const f of ls) f(); },
    subscribe(f) { ls.add(f); return () => ls.delete(f); },
  };
}

const UI_INITIAL = { st: 0, pct: 0, targetOpen: false, targetHz: "", targetMsg: null, aboutOpen: false, say: "", saySeq: 0 };

function makeSession() {
  const ui = createStore(UI_INITIAL);
  const say = (text) => ui.set({ say: text, saySeq: ui.get().saySeq + 1 });
  const playback = createPlayback();
  const ctl = createVoicePreviewController({
    createWorker: () => new Worker(new URL("./vp-worker.js", import.meta.url), { type: "module" }),
    glueUrl: VP_GLUE_URL,
    wasmUrls: VP_WASM_URLS,
  });

  // Controller -> playback sources, slider reset, announcements.
  let prev = ctl.getState();
  ctl.subscribe((s) => {
    const p = prev;
    prev = s;
    if (s.analysis !== p.analysis) ui.set({ st: 0, pct: 0, targetOpen: false, targetMsg: null });
    if (s.original !== p.original) {
      const rate = s.analysis && (s.analysis.captureRate > 96000 ? s.analysis.rate : s.analysis.captureRate);
      playback.setSource("original", s.original ? { pcm: s.original, rate } : null);
    }
    if (s.rebuild !== p.rebuild) playback.setSource("rebuild", s.rebuild ? { pcm: s.rebuild, rate: s.analysis.rate } : null);
    if (s.preview !== p.preview) playback.setSource("preview", s.preview ? { pcm: s.preview.pcm, rate: s.preview.rate } : null);
    if (s.phase !== p.phase) {
      const msg = {
        recording: S.announce.recording,
        analysing: S.announce.recordingStopped,
        preview: S.announce.previewReady,
        "too-short": S.tooShort,
        cancelled: S.cancelled,
        "no-voice": S.noVoice,
        error: S.error,
        memory: S.memory,
        "load-error": S.loadError,
      }[s.phase];
      if (msg) say(msg);
    } else if (s.phase === "preview") {
      if (s.rendering && !p.rendering) say(S.announce.updating);
      else if (s.preview !== p.preview && s.preview) say(S.announce.updated);
      else if (s.error && !p.error) say(S.error);
    }
  });

  // Playback -> announcements (user presses, a version ending, the loop).
  let pb = playback.getState();
  let quiet = false;
  playback.subscribe((st) => {
    const p = pb;
    pb = st;
    if (quiet) return;
    if (st.playing !== p.playing) {
      if (st.playing === "preview") say(S.announce.playingPreview);
      else if (st.playing === "rebuild") say(S.announce.playingRebuild);
      else if (st.playing === "original") say(S.announce.playingOriginal);
      else say(S.announce.stopped);
    } else if (st.loop !== p.loop) say(st.loop ? S.announce.loopOn : S.announce.loopOff);
  });
  const silently = (fn) => { quiet = true; try { fn(); } finally { quiet = false; } };

  // Listening stopped: nothing may keep playing behind a hidden card.
  const unsubCapture = onVoicePreviewCapture((h) => { if (!h) silently(() => playback.stop()); });

  return {
    ctl, playback, ui, say, silently,
    dispose() { unsubCapture(); playback.close(); ctl.dispose(); },
  };
}

let session = null;
const sessionListeners = new Set();
function openSession() {
  try { session = makeSession(); } catch (err) { console.error("voice preview", err); session = { failed: true }; }
}
openSession();
const notifySession = () => { for (const f of sessionListeners) f(); };
const subscribeSession = (f) => { sessionListeners.add(f); return () => sessionListeners.delete(f); };
const getSession = () => session;

// Page hide: the worker (and all of its memory) and the AudioContext go; the recording is
// gone. A page restored from the back/forward cache starts a fresh session.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (session && !session.failed) session.dispose();
    session = null;
    notifySession();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && !session) { openSession(); notifySession(); }
  });
}

// ---------------------------------------------------------------- small parts

const BTN = "inline-flex items-center justify-center rounded-lg text-sm transition-colors cursor-pointer aria-disabled:cursor-not-allowed aria-disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";
const BTN_SOFT = `${BTN} bg-neutral-800 text-neutral-100 hover:bg-neutral-700 aria-disabled:hover:bg-neutral-800`;

function Btn({ inactive = false, onClick, className = BTN_SOFT, children, ...rest }) {
  return (
    <button
      type="button"
      aria-disabled={inactive || undefined}
      onClick={(e) => { if (!inactive) onClick?.(e); }}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

function LevelBar({ level }) {
  const db = level && level.rms > 0 ? 20 * Math.log10(level.rms) : -90;
  const w = Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden" data-vp-level="">
      <div className="h-full rounded-full bg-neutral-300 transition-[width] duration-100" style={{ width: `${(w * 100).toFixed(1)}%` }} />
    </div>
  );
}

const sign = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 3, PageDown: -3 };

/**
 * A native range input. Labels follow the value live; the render is committed on release
 * (the native change event, which pointer and assistive-technology adjustments fire) or
 * KEY_COMMIT_MS after the last key (the keys are handled here: arrows ±1, Page Up/Down ±3,
 * Home/End the limits).
 */
function Slider({ id, label, lowWord, highWord, min, max, value, valueLabel, valueText, describedBy, note, onLive, onCommit, data }) {
  const ref = useRef(null);
  const timer = useRef(null);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; });
  useEffect(() => {
    const el = ref.current;
    const onChange = () => { clearTimeout(timer.current); commitRef.current(Number(el.value)); };
    el.addEventListener("change", onChange);
    return () => { el.removeEventListener("change", onChange); clearTimeout(timer.current); };
  }, []);
  const onKeyDown = (e) => {
    let v;
    if (e.key in sign) v = value + sign[e.key];
    else if (e.key === "Home") v = min;
    else if (e.key === "End") v = max;
    else return;
    e.preventDefault();
    v = Math.min(max, Math.max(min, v));
    onLive(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commitRef.current(v), KEY_COMMIT_MS);
  };
  return (
    <div data-vp-slider={data}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-neutral-100">{label}</label>
        <span className="text-sm text-neutral-200 tabular-nums text-right" data-vp-value="">{valueLabel}</span>
      </div>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={valueText}
        aria-describedby={describedBy}
        onChange={(e) => onLive(Number(e.target.value))}
        onKeyDown={onKeyDown}
        className="block w-full h-11 accent-purple-400 cursor-pointer"
      />
      <div aria-hidden="true" className="-mt-1 flex justify-between text-[11px] leading-4 text-neutral-400">
        <span>{lowWord}</span>
        <span>{highWord}</span>
      </div>
      {note}
    </div>
  );
}

// ---------------------------------------------------------------- the card

export default function VoicePreviewCard(props) {
  const sess = useSyncExternalStore(subscribeSession, getSession);
  if (!sess) return null;
  if (sess.failed) {
    return (
      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-3 text-sm text-neutral-300" style={{ colorScheme: "dark" }} data-voice-preview="" data-vp-phase="load-error">
        {S.loadError}
      </section>
    );
  }
  return <Card sess={sess} {...props} />;
}

function Card({ sess, direction = null, isSessionRecording, phone = false }) {
  const { ctl, playback, ui, say, silently } = sess;
  const s = useSyncExternalStore(ctl.subscribe, ctl.getState);
  const pb = useSyncExternalStore(playback.subscribe, playback.getState);
  const u = useSyncExternalStore(ui.subscribe, ui.get);
  const ids = useId();
  const id = (k) => `vp${ids}${k}`;

  // Listening time (the 6 s wait) and the Dashboard session guard: polled, outside render.
  const tick = useSyncExternalStore(subscribeTick, getTick);
  const isRecRef = useRef(isSessionRecording);
  useEffect(() => { isRecRef.current = isSessionRecording; });
  useEffect(() => startTicker(ctl, playback, isRecRef, silently), [ctl, playback, silently]);
  // Leaving the view or the tab stops playback (the card is not there to stop it).
  useEffect(() => () => silently(() => playback.stop()), [playback, silently]);

  const recordRef = useRef(null);
  const targetBtnRef = useRef(null);
  const targetInputRef = useRef(null);
  const aboutBtnRef = useRef(null);
  useEffect(() => { if (u.targetOpen) targetInputRef.current?.focus(); }, [u.targetOpen]);

  const phase = s.phase;
  const a = s.analysis;
  const lim = a?.limits;
  const listening = tick.readyMs !== null;
  const waiting = tick.readyMs === null || tick.readyMs > 0;
  const sessionRec = tick.sessionRec;

  // ---- the one Record / Stop / Record again button
  let recLabel = S.record;
  let recAction = () => ctl.record();
  let recInactive = !RECORDABLE.has(phase) || waiting;
  if (phase === "recording") { recLabel = S.stop; recAction = () => ctl.stop(); recInactive = false; }
  else if (phase === "preview" || phase === "error" || phase === "memory") {
    recLabel = S.recordAgain;
    recAction = () => { silently(() => playback.clear()); ctl.recordAgain(); };
    recInactive = false;
  }
  const recPrimary = phase !== "recording" && phase !== "preview";

  // ---- the status line beside it
  const phaseText = {
    loading: S.loading,
    unsupported: S.unsupported,
    "load-error": S.loadError,
    recording: recordingFor(s.level?.seconds ?? 0, RECORD_MAX_S),
    analysing: S.analysing,
    "too-short": S.tooShort,
    cancelled: S.cancelled,
    "no-voice": S.noVoice,
    error: S.error,
    memory: S.memory,
    preview: S.recordAgainHint,
    ready: waiting ? readyIn(tick.readyMs ?? 6000) : S.readyToRecord,
  }[phase];
  const waitLine = phase !== "ready" && RECORDABLE.has(phase) && waiting ? readyIn(tick.readyMs ?? 6000) : null;

  // ---- sliders
  const commit = (st, pct) => { ctl.render(st, pct); };
  const median = a?.pitch?.medianHz ?? 0;
  const lowLimited = lim && lim.stMin > -12;

  const onPreset = (name) => {
    const v = applyPreset(name, { st: u.st, pct: u.pct }, lim);
    ui.set({ ...v, targetMsg: null });
    commit(v.st, v.pct);
  };
  const openTarget = () => {
    if (u.targetOpen) { ui.set({ targetOpen: false }); return; }
    const pre = u.targetHz === "" ? targetPrefillHz(pitchTargetFor(direction)) : null;
    ui.set({ targetOpen: true, ...(pre ? { targetHz: String(pre) } : {}) });
  };
  const applyTarget = () => {
    const hz = Number(u.targetHz);
    if (u.targetHz === "" || !Number.isFinite(hz)) return;
    const clampedHz = Math.min(TARGET_MAX_HZ, Math.max(TARGET_MIN_HZ, Math.round(hz)));
    const r = targetSetting(clampedHz, median, lim);
    const msg = targetResult(r);
    ui.set({ st: r.st, targetHz: String(clampedHz), targetMsg: msg });
    say(msg);
    commit(r.st, u.pct);
  };
  const closeTargetOnEscape = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    ui.set({ targetOpen: false });
    targetBtnRef.current?.focus();
  };

  // ---- playback
  const onPlay = (which) => {
    if (isRecRef.current?.()) return;
    playback.play(which);
  };
  const discard = () => {
    silently(() => playback.clear());
    ctl.discard();
    say(S.announce.discarded);
    recordRef.current?.focus();
  };
  const download = () => {
    const src = s.preview ?? (s.rebuild ? { st: 0, pct: 0, pcm: s.rebuild, rate: a.rate } : null);
    if (!src) return;
    const url = URL.createObjectURL(new Blob([encodeWav(src.pcm, src.rate)], { type: "audio/wav" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(src.st, src.pct);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const aboutKey = (e) => {
    if (e.key !== "Escape" || !u.aboutOpen) return;
    e.preventDefault();
    ui.set({ aboutOpen: false });
    aboutBtnRef.current?.focus();
  };

  const showPreview = phase === "preview" && a;
  const check = a?.check;
  const playReason = sessionRec ? id("guard") : null;
  const previewReason = !s.preview ? id("first") : null;
  const describe = (...xs) => xs.filter(Boolean).join(" ") || undefined;
  const PLAY_BTN = `${BTN_SOFT} min-h-11 px-3 aria-pressed:bg-neutral-200 aria-pressed:text-neutral-900 aria-pressed:hover:bg-neutral-100`;
  const pad = phone ? "px-2.5 py-2" : "px-3 py-3";

  return (
    <section
      aria-labelledby={id("h")}
      style={{ colorScheme: "dark" }}
      className={`rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-300 ${pad}`}
      data-voice-preview=""
      data-vp-phase={phase}
      data-vp-build={s.build ?? ""}
      data-vp-rate={a?.rate ?? ""}
      data-vp-capture-rate={a?.captureRate ?? ""}
      data-vp-seconds={a?.seconds ?? ""}
      data-vp-hum={check ? String(check.hum) : ""}
      data-vp-noise={check ? String(check.noise) : ""}
      data-vp-margin={check ? check.marginDb.toFixed(1) : ""}
      data-vp-analysis-ms={a?.ms?.total != null ? a.ms.total.toFixed(1) : ""}
      data-vp-render-ms={s.preview?.ms?.render != null ? s.preview.ms.render.toFixed(1) : ""}
      data-vp-rendered={s.preview ? `${s.preview.st},${s.preview.pct}` : ""}
      data-vp-rendering={s.rendering ? "1" : "0"}
      data-vp-playing={pb.playing ?? ""}
      data-vp-audio={pb.audio ?? ""}
    >
      {/* heading + about toggle */}
      <div className="flex items-center gap-2">
        <h3 id={id("h")} className="text-sm font-medium text-neutral-100">
          {S.heading} <span className="ml-1 text-xs font-normal text-neutral-400">{S.tag}</span>
        </h3>
        <button
          ref={aboutBtnRef}
          type="button"
          onClick={() => ui.set({ aboutOpen: !u.aboutOpen })}
          onKeyDown={aboutKey}
          aria-expanded={u.aboutOpen}
          aria-controls={id("about")}
          aria-label={S.aboutLabel}
          className="relative inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full border border-neutral-500 text-[11px] leading-none text-neutral-300 hover:text-neutral-100 hover:border-neutral-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
          data-vp-about-toggle=""
        >
          i
        </button>
      </div>
      <p className="mt-0.5 text-xs leading-snug text-neutral-400">{S.intro}</p>
      {u.aboutOpen && (
        <div
          id={id("about")}
          role="note"
          tabIndex={-1}
          onKeyDown={aboutKey}
          className="mt-2 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs leading-relaxed text-neutral-300 space-y-1.5"
          data-vp-about=""
        >
          {S.about.map((t) => <p key={t}>{t}</p>)}
        </div>
      )}

      {/* Record / Stop / Record again + status */}
      <div className="mt-2.5 flex items-center gap-3">
        <button
          ref={recordRef}
          type="button"
          aria-disabled={recInactive || undefined}
          aria-describedby={id("status")}
          onClick={() => { if (!recInactive) recAction(); }}
          className={`${BTN} shrink-0 min-h-11 min-w-24 px-5 font-medium ${recPrimary ? "bg-purple-600 text-white hover:bg-purple-500 aria-disabled:hover:bg-purple-600" : "bg-neutral-700 text-neutral-100 hover:bg-neutral-600"}`}
          data-vp-record=""
        >
          {recLabel}
        </button>
        <div className="min-w-0 flex-1">
          <p id={id("status")} className="text-sm leading-snug text-neutral-200" data-vp-status="">
            {phaseText}
            {waitLine && <span className="block text-neutral-400">{waitLine}</span>}
          </p>
          {phase === "recording" && <div className="mt-1.5"><LevelBar level={s.level} /></div>}
        </div>
      </div>

      {showPreview && (
        <div className="mt-3 space-y-3">
          {/* recording check */}
          {(check.hum || check.noise) && (
            <div className="rounded-lg border border-neutral-600 bg-neutral-800/70 px-3 py-2 text-xs leading-snug text-neutral-200 space-y-1" data-vp-notices="">
              {check.hum && <p data-vp-notice="hum">{S.humNotice}</p>}
              {check.noise && <p data-vp-notice="noise">{S.noiseNotice}</p>}
              <p className="text-neutral-300">{S.quieterSpot}</p>
            </div>
          )}
          {s.error && (
            <p className="rounded-lg border border-neutral-600 bg-neutral-800/70 px-3 py-2 text-xs text-neutral-200" data-vp-render-error="">{S.error}</p>
          )}
          <p className="text-xs text-neutral-300" data-vp-median="">{medianLine(median)}</p>

          <Slider
            id={id("pitch")}
            data="pitch"
            label={S.pitch}
            lowWord={S.pitchLow}
            highWord={S.pitchHigh}
            min={lim.stMin}
            max={lim.stMax}
            value={u.st}
            valueLabel={pitchValueLabel(u.st, median)}
            valueText={pitchValueText(u.st, median)}
            describedBy={lowLimited ? id("limit") : undefined}
            note={lowLimited ? <p id={id("limit")} className="mt-1 text-[11px] leading-snug text-neutral-400" data-vp-limit="">{S.lowLimitNote}</p> : null}
            onLive={(v) => ui.set({ st: v, targetMsg: null })}
            onCommit={(v) => { ui.set({ st: v }); commit(v, ui.get().pct); }}
          />
          <Slider
            id={id("res")}
            data="resonance"
            label={S.resonance}
            lowWord={S.resonanceLow}
            highWord={S.resonanceHigh}
            min={lim.pctMin}
            max={lim.pctMax}
            value={u.pct}
            valueLabel={resonanceValueLabel(u.pct)}
            valueText={resonanceValueText(u.pct)}
            onLive={(v) => ui.set({ pct: v })}
            onCommit={(v) => { ui.set({ pct: v }); commit(ui.get().st, v); }}
          />

          {/* quick settings */}
          <div role="group" aria-labelledby={id("qs")} data-vp-presets="">
            <p id={id("qs")} className="text-xs text-neutral-300 mb-1">{S.quickSettings}</p>
            <div className="flex flex-wrap gap-1.5">
              {["higherBrighter", "lowerDarker", "pitchOnly", "resonanceOnly"].map((k) => (
                <Btn key={k} className={`${BTN_SOFT} min-h-9 px-2.5 text-xs`} onClick={() => onPreset(k)} data-vp-preset={k}>{S.presets[k]}</Btn>
              ))}
              <Btn
                ref={targetBtnRef}
                className={`${BTN_SOFT} min-h-9 px-2.5 text-xs`}
                onClick={openTarget}
                aria-expanded={u.targetOpen}
                aria-controls={id("target")}
                data-vp-preset="target"
              >
                {S.presets.target}
              </Btn>
              <Btn className={`${BTN_SOFT} min-h-9 px-2.5 text-xs`} onClick={() => onPreset("unchanged")} data-vp-preset="unchanged">{S.presets.unchanged}</Btn>
            </div>
            {u.targetOpen && (
              <div id={id("target")} className="mt-2 flex flex-wrap items-center gap-2" onKeyDown={closeTargetOnEscape} data-vp-target="">
                <label htmlFor={id("thz")} className="text-xs text-neutral-200">{S.targetField}</label>
                <input
                  ref={targetInputRef}
                  id={id("thz")}
                  type="number"
                  inputMode="numeric"
                  min={TARGET_MIN_HZ}
                  max={TARGET_MAX_HZ}
                  step={1}
                  value={u.targetHz}
                  onChange={(e) => ui.set({ targetHz: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyTarget(); } }}
                  className="w-20 min-h-9 rounded-lg border border-neutral-600 bg-neutral-950 px-2 text-sm text-neutral-100 tabular-nums focus-visible:outline-2 focus-visible:outline-purple-300"
                />
                <Btn className={`${BTN_SOFT} min-h-9 px-3 text-xs`} inactive={u.targetHz === ""} onClick={applyTarget} data-vp-apply="">{S.apply}</Btn>
              </div>
            )}
            {u.targetMsg && <p className="mt-1 text-xs text-neutral-300" data-vp-target-result="">{u.targetMsg}</p>}
          </div>

          {/* playback */}
          <div role="group" aria-labelledby={id("play")} data-vp-play="">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p id={id("play")} className="text-xs text-neutral-300">{S.play}</p>
              <p className="text-xs text-neutral-200 text-right" data-vp-updating="">{s.rendering ? S.updating : ""}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Btn className={PLAY_BTN} inactive={sessionRec} aria-pressed={pb.playing === "rebuild"} aria-describedby={describe(playReason)} onClick={() => onPlay("rebuild")} data-vp-play-version="rebuild">{S.playRebuild}</Btn>
              <Btn className={PLAY_BTN} inactive={sessionRec || !s.preview} aria-pressed={pb.playing === "preview"} aria-describedby={describe(playReason, previewReason)} onClick={() => onPlay("preview")} data-vp-play-version="preview">{S.playPreview}</Btn>
              <Btn className={PLAY_BTN} inactive={sessionRec} aria-pressed={pb.playing === "original"} aria-describedby={describe(playReason)} onClick={() => onPlay("original")} data-vp-play-version="original">{S.playOriginal}</Btn>
              <Btn className={PLAY_BTN} aria-pressed={pb.loop} onClick={() => playback.setLoop(!pb.loop)} data-vp-loop="">{S.loop}</Btn>
              <Btn className={`${BTN_SOFT} min-h-11 px-3`} onClick={() => playback.stop()} data-vp-stop="">{S.stopPlayback}</Btn>
            </div>
            <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-neutral-400">
              {!s.preview && <p id={id("first")} data-vp-first-hint="">{S.firstPreviewHint}</p>}
              {sessionRec && <p id={id("guard")} className="text-neutral-200" data-vp-guard="">{S.sessionGuard}</p>}
              {listening && <p data-vp-listening-note="">{S.listeningNote}</p>}
            </div>
          </div>

          <p className="text-xs leading-snug text-neutral-300" data-vp-caveat="">{S.caveat}</p>

          <div className="flex flex-wrap gap-2">
            <Btn className={`${BTN_SOFT} min-h-11 px-4`} onClick={discard} data-vp-discard="">{S.discard}</Btn>
            <Btn className={`${BTN_SOFT} min-h-11 px-4`} onClick={download} data-vp-download="">{S.download}</Btn>
          </div>
        </div>
      )}

      {(phase === "error" || phase === "memory") && (
        <div className="mt-2">
          <Btn className={`${BTN_SOFT} min-h-11 px-4`} onClick={discard} data-vp-discard="">{S.discard}</Btn>
        </div>
      )}

      {DIAG_ENABLED && (
        <p className="mt-2 text-[10px] leading-snug text-neutral-400 font-mono break-words" data-vp-diag="">
          {diagLine(s)}
        </p>
      )}

      <p role="status" className="sr-only" data-vp-live="">{u.say}{u.saySeq % 2 ? " " : ""}</p>
    </section>
  );
}

function diagLine(s) {
  const parts = [`build ${s.build ?? "—"}`];
  if (s.loadMs != null) parts.push(`load ${s.loadMs.toFixed(0)} ms`);
  if (s.memBytes != null) parts.push(`wasm ${(s.memBytes / 1048576).toFixed(1)} MB`);
  const a = s.analysis;
  if (a) {
    parts.push(`engine ${a.rate} Hz (capture ${a.captureRate} Hz)`, `${a.seconds.toFixed(2)} s`);
    const m = a.ms || {};
    const stages = ["check", "resample", "frontEnd", "stonemask", "cheaptrick", "d4c", "synth", "finish"]
      .filter((k) => m[k] != null).map((k) => `${k} ${m[k].toFixed(0)}`).join(", ");
    parts.push(`analysis + rebuild ${m.total?.toFixed(0) ?? "?"} ms${stages ? ` (${stages})` : ""}`);
    parts.push(`margin ${a.check.marginDb.toFixed(1)} dB`, `voiced ${a.check.voicedS.toFixed(2)} s`);
    if (a.hops) parts.push(`hops ${a.hops.received}/${a.hops.recorded}`);
    if (a.memBytes != null) parts.push(`wasm after ${(a.memBytes / 1048576).toFixed(1)} MB`);
  }
  if (s.preview?.ms?.render != null) parts.push(`render ${s.preview.ms.render.toFixed(0)} ms`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- the ticker (outside render)
// Milliseconds until Record is allowed (null = not listening) and whether a Dashboard
// session recording runs; a session recording that starts stops any playback.

let tickState = { readyMs: null, sessionRec: false };
const tickListeners = new Set();
const subscribeTick = (f) => { tickListeners.add(f); return () => tickListeners.delete(f); };
const getTick = () => tickState;

function startTicker(ctl, playback, isRecRef, silently) {
  let t = null;
  const run = () => {
    const readyMs = ctl.readyInMs();
    let sessionRec = false;
    try { sessionRec = !!isRecRef.current?.(); } catch { /* no session info */ }
    if (sessionRec && playback.getState().playing) silently(() => playback.stop());
    const bucket = (ms) => (ms === null ? null : Math.ceil(ms / 1000));
    if (bucket(readyMs) !== bucket(tickState.readyMs) || sessionRec !== tickState.sessionRec) {
      tickState = { readyMs, sessionRec };
      for (const f of tickListeners) f();
    }
    t = setTimeout(run, readyMs !== null && readyMs > 0 ? 250 : 1000);
  };
  run();
  return () => clearTimeout(t);
}
