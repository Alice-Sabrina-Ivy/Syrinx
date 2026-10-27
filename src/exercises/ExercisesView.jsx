// ExercisesView.jsx — the "Exercises" tab: the lesson list and the lesson player
// (docs/guided-exercises-design.md). App.jsx loads this module lazily when the tab is
// first opened, in both the idle and the listening branch (lessons can be read with the
// mic off; cards that need it offer "Turn on the mic"). The open lesson lives outside
// React (session.js), so a tab switch or the mic starting keeps the place.
//
// Every string comes from lessons.js (tests/exercises/lessons-test.js checks them).
// Live views reuse the app's own pieces: the pitch trace (components/PitchTrace.jsx, its
// compact form) with the training direction's band; recordings use Voice Shaper's capture
// handle (voice-preview/bridge.js) and, for "Hear it first", its controller (hearShaper.js,
// imported when that lesson opens).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import db from "../db.js";
import { PitchTrace } from "../components/PitchTrace.jsx";
import { SteadinessReadout } from "../components/SteadinessReadout.jsx";
import { pitchTargetFor, pitchStatus, formatTarget } from "../utils/trainingDirection.js";
import { statusTextClass } from "../utils/constants.js";
import { hzToNote } from "../utils/pitchUtils.js";
import { getVoicePreviewCapture, onVoicePreviewCapture } from "../voice-preview/bridge.js";
import { setExerciseFrameTap } from "./bridge.js";
import {
  LESSONS, GROUPS, PRACTICE, nextLessonAfter, UI, forDir, cardsFor, takesFor, hearShifts, lastDoneText,
} from "./lessons.js";
import { countResult } from "./results.js";
import { saveResult, updateResult, lastDoneByLesson, recentResults } from "./store.js";
import { createLessonSession } from "./session.js";
import { recordTake } from "./takes.js";
import { createTakeVoiceLog, takeNote, takePitchHz } from "./takeChecks.js";
import { newGuessRound, markPlayed, askedWord, revealLines } from "./guess.js";
import { Drawings } from "./Drawing.jsx";

// ---------------------------------------------------------------- the open lesson

const session = createLessonSession();
// Listening stopped: a take being recorded keeps what it has, and nothing plays on.
onVoicePreviewCapture((h) => {
  if (!h) { session.stopTake(); session.player.stop(); }
});

// Leaving the page: the takes, the player's AudioContext and "Hear it first"'s worker go
// (as Voice Shaper's card does on pagehide).
if (typeof window !== "undefined") window.addEventListener("pagehide", () => session.close());

let saving = null; // the lesson run (startedAt) whose result row is being written
let pendingFeel = null; // { startedAt, feel }: answered before that run's row had an id
let lastOpened = null; // the lesson the list gives the focus back to when it closes

function openLesson(id, direction) {
  lastOpened = id;
  session.open(id);
  if (id === "R4") {
    import("./hearShaper.js").then((m) => {
      const s = session.getState();
      if (s.lessonId === "R4" && !session.getHear()) {
        const hear = m.createShaperHear(hearShifts(direction));
        session.setHear(hear);
        trackHearVoice(hear);
      }
    }).catch((err) => console.error("Exercises: Voice Shaper could not load", err));
  }
}

/**
 * "Hear it first"'s recording: its voice is counted the way a take's is (its pitch shows
 * beside the try's on the "Your try" card). Owned here, not by a component, so a tab switch
 * while it records (the view unmounts, the recording goes on) keeps the whole count.
 */
function trackHearVoice(hear) {
  let log = null;
  hear.subscribe((st) => {
    if (st.phase === "recording" && !log) {
      const mine = createTakeVoiceLog();
      log = mine;
      setExerciseFrameTap((frame) => {
        // the lesson closed while it recorded (hear disposed): the tap removes itself
        if (session.getHear() !== hear) { setExerciseFrameTap(null); return; }
        mine.push(frame);
      });
    } else if (st.phase !== "recording" && log) {
      setExerciseFrameTap(null);
      session.setUi("hear:voice", log.stats());
      log = null;
    }
  });
}

// ---------------------------------------------------------------- shared bits

const BTN = "inline-flex items-center justify-center rounded-lg border border-transparent text-sm transition-colors cursor-pointer min-h-11 min-w-11 px-3 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";
const BTN_SOFT = `${BTN} bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:hover:bg-neutral-800`;
const BTN_PRIMARY = `${BTN} bg-purple-600 text-white hover:bg-purple-700 disabled:hover:bg-purple-600`;
const BTN_TOGGLE = `${BTN_SOFT} aria-pressed:bg-neutral-200 aria-pressed:text-neutral-900 aria-pressed:hover:bg-neutral-100 forced-colors:aria-pressed:bg-[Highlight] forced-colors:aria-pressed:text-[HighlightText]`;

const fmtS = (s) => (Math.round(s * 10) / 10).toFixed(1);

function Paragraphs({ items }) {
  return items.map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-neutral-200">{p}</p>);
}

function MicPrompt({ onStartListening, optional = false }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2" data-mic-prompt="">
      <p className="text-sm text-neutral-300">{optional ? UI.micOffOptional : UI.micOff}</p>
      <button type="button" className={BTN_PRIMARY} onClick={onStartListening}>{UI.turnOnMic}</button>
    </div>
  );
}

/** Polls the Dashboard's session recording (playback is off while one runs). */
function readSessionRec(fn) {
  try { return !!fn?.(); } catch { return false; /* no session info */ }
}
function useSessionRec(isSessionRecording) {
  const [rec, setRec] = useState(() => readSessionRec(isSessionRecording));
  const fnRef = useRef(isSessionRecording);
  useEffect(() => { fnRef.current = isSessionRecording; });
  useEffect(() => {
    const t = setInterval(() => {
      const on = readSessionRec(fnRef.current);
      if (on && session.player.getState().playing) session.player.stop();
      setRec(on);
    }, 500);
    return () => clearInterval(t);
  }, []);
  return rec;
}

/**
 * `short`: the visible text is just "Play" (the take's name is beside it); the accessible name keeps it.
 * `onPlay`: called when this press starts playback (the guess card notes what was heard).
 */
function PlayButton({ name, label, take, blocked, short = false, onPlay }) {
  const pb = useSyncExternalStore(session.player.subscribe, session.player.getState);
  const playing = pb.playing === name;
  return (
    <button
      type="button"
      className={`${BTN_TOGGLE} gap-1.5`}
      aria-pressed={playing}
      aria-label={UI.play(label)}
      disabled={!take || blocked}
      onClick={() => { if (session.player.play(name, take)) onPlay?.(); }}
      data-play={name}
    >
      <span aria-hidden="true" className="text-xs">{playing ? "■" : "▶"}</span>
      {short ? UI.playShort : label}
    </button>
  );
}

// ---------------------------------------------------------------- the list

function LessonList({ direction }) {
  const [done, setDone] = useState({});
  useEffect(() => {
    let live = true;
    const load = () => lastDoneByLesson(db.exerciseResults).then((d) => { if (live) setDone(d); });
    load();
    // an import or "Delete all data" in Settings (open over this tab)
    window.addEventListener("syrinx:data-changed", load);
    return () => { live = false; window.removeEventListener("syrinx:data-changed", load); };
  }, []);
  // back from a lesson: the focus goes to that lesson's row, not to the page
  useEffect(() => {
    if (!lastOpened) return;
    document.querySelector(`[data-lesson="${lastOpened}"]`)?.focus();
    lastOpened = null; // once: a later tab switch back to the list leaves the focus alone
  }, []);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-2xl mx-auto pb-4" data-exercises-list="">
      <h2 className="text-lg font-light text-white">{UI.heading}</h2>
      <p className="mt-1 text-sm text-neutral-300">{UI.intro}</p>
      {direction == null && <p className="mt-2 text-xs text-neutral-300" data-exercises-no-goal="">{UI.noGoal}</p>}
      {GROUPS.map((g) => (
        <section key={g.id} className="mt-4" aria-labelledby={`ex-group-${g.id}`}>
          <h3 id={`ex-group-${g.id}`} className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">{g.title}</h3>
          <ul className="space-y-1.5">
            {g.lessons.map((id) => {
              const L = LESSONS[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => openLesson(id, direction)}
                    className="w-full cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
                    data-lesson={id}
                  >
                    <span className="block text-sm text-neutral-100">{forDir(L.title, direction)}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-neutral-300">{forDir(L.purpose, direction)}</span>
                    <span className="mt-1 block text-xs text-neutral-400" data-last-done="">{lastDoneText(done[id])}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="mt-4 text-xs leading-snug text-neutral-400">{UI.later}</p>
    </div>
  );
}

// ---------------------------------------------------------------- live pitch view

/** `target` null = neutral: the number only, no colour and no in / out-of-band words. */
function LevelLine({ pipeline, target }) {
  const shows = (pipeline.pitchVoiced || pipeline.pitchHolding) && pipeline.pitchLevel != null;
  if (!shows) return <p className="text-sm tabular-nums text-neutral-400" data-level-line="">{UI.levelNone}</p>;
  // judged on the number shown, so "165 Hz" never reads "below the band" (165–255)
  const hz = Math.round(pipeline.pitchLevel);
  const status = target ? pitchStatus(hz, target) : null;
  const where = status == null ? null : status === "in" ? UI.inBand : hz < target.low ? UI.belowBand : UI.aboveBand;
  return (
    <p className={`text-sm tabular-nums ${statusTextClass(status)}`} data-level-line="" data-level-status={status ?? "none"}>
      {UI.level(hz)}{where ? ` · ${where}` : ""}
    </p>
  );
}

function MeasureLine({ cardIndex }) {
  const [voicedS, setVoicedS] = useState(() => session.frameLog(cardIndex).voicedSeconds());
  useEffect(() => {
    const log = session.frameLog(cardIndex);
    setExerciseFrameTap((frame) => log.push(frame, performance.now()));
    const t = setInterval(() => setVoicedS(log.voicedSeconds()), 500);
    return () => { clearInterval(t); setExerciseFrameTap(null); };
  }, [cardIndex]);
  return (
    <div className="flex items-center gap-x-2">
      <p className="text-xs tabular-nums text-neutral-300" data-voice-so-far={voicedS.toFixed(1)}>{UI.voiceSoFar(Math.floor(voicedS))}</p>
      <button
        type="button"
        className="min-h-11 cursor-pointer px-1 text-xs text-neutral-300 underline underline-offset-2 hover:text-white"
        onClick={() => { session.frameLog(cardIndex).clear(); setVoicedS(0); }}
        data-start-over=""
      >
        {UI.startOver}
      </button>
    </div>
  );
}

function LiveView({ card, cardIndex, listening, onStartListening, pipeline, direction }) {
  if (!listening) return <MicPrompt onStartListening={onStartListening} optional={!!card.live?.optional} />;
  // a neutral card (the cool-down) draws no band and judges nothing; a glide card
  // (judge: false) draws the band but judges nothing
  const target = card.live?.neutral ? null : pitchTargetFor(direction);
  const judge = card.live?.judge !== false;
  return (
    <div className="space-y-1" data-live-view="" data-live-neutral={card.live?.neutral ? "1" : undefined} data-live-judge={judge ? undefined : "0"}>
      <div className="h-[clamp(110px,22dvh,240px)] shortland:h-20">
        <PitchTrace
          compact
          pitchTraceRef={pipeline.pitchTraceRef}
          subscribeTrace={pipeline.subscribeTrace}
          voiced={pipeline.pitchVoiced}
          holding={pipeline.pitchHolding}
          pitch={pipeline.pitch}
          pitchLevel={pipeline.pitchLevel}
          target={target}
          judge={judge}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <LevelLine pipeline={pipeline} target={judge ? target : null} />
        {card.live?.steadiness && (
          <p className="text-sm text-neutral-300" data-steadiness="">
            <SteadinessReadout value={pipeline.steadiness ?? null} held={!!pipeline.steadinessHeld} variant="inline" />
          </p>
        )}
        {card.live?.measure && <MeasureLine cardIndex={cardIndex} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- counters, timer, phrases

/** A tap counter for a card's repetitions ("Slide 2 of 3"); no mic, nothing judged. */
function RepCounter({ spec, cardIndex, direction, s }) {
  const n = forDir(spec.count, direction);
  const label = forDir(spec.label, direction);
  const key = `${cardIndex}:reps`;
  const done = Math.min(s.ui[key] ?? 0, n);
  const all = done >= n;
  return (
    <div className="flex items-center justify-between gap-3" data-reps={done} data-reps-of={n}>
      <p className="text-sm tabular-nums text-neutral-200" role="status">{all ? UI.repAll(n) : UI.rep(label, done + 1, n)}</p>
      {all
        ? <button type="button" className={BTN_SOFT} onClick={() => session.setUi(key, 0)} data-reps-again="">{UI.repAgain}</button>
        : (
          <button type="button" className={BTN_SOFT} aria-label={UI.repDoneName(label, done + 1)} onClick={() => session.setUi(key, done + 1)} data-reps-done="">
            {UI.repDone}
          </button>
        )}
    </div>
  );
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** A tap-to-start hold timer per repetition ("Hum 2 of 5", up to `seconds`); no mic, nothing judged. */
function HoldTimer({ spec, cardIndex, s }) {
  const { reps: n, seconds: max, label } = spec;
  const key = `${cardIndex}:reps`;
  const done = Math.min(s.ui[key] ?? 0, n);
  const [startAt, setStartAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const count = () => session.setUi(key, Math.min(n, (session.getState().ui[key] ?? 0) + 1));
  useEffect(() => {
    if (startAt == null) return undefined;
    let ended = false; // a tick after the end (before this effect is cleaned up) must not count again
    const t = setInterval(() => {
      if (ended) return;
      const e = (performance.now() - startAt) / 1000;
      if (e >= max) { ended = true; clearInterval(t); setStartAt(null); setElapsed(0); count(); } else setElapsed(e);
    }, 100);
    return () => clearInterval(t);
    // count() reads the session's current value; the interval only depends on the start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt, max]);
  const running = startAt != null;
  const all = done >= n && !running;
  const progress = running ? Math.min(1, elapsed / max) : 0;
  return (
    <div className="flex items-center gap-3" data-timer={running ? "running" : "idle"} data-reps={done} data-reps-of={n}>
      {/* currentColor: in forced colours the ring takes the system text colour, the track stays fainter */}
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="flex-shrink-0 text-purple-300 forced-colors:text-[CanvasText]">
        <circle cx="20" cy="20" r={RING_R} fill="none" strokeWidth="4" stroke="currentColor" strokeOpacity="0.25" />
        <circle
          cx="20" cy="20" r={RING_R} fill="none" strokeWidth="4" strokeLinecap="round" stroke="currentColor"
          strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)} transform="rotate(-90 20 20)"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm tabular-nums text-neutral-200" role="status">{all ? UI.repAll(n) : UI.rep(label, Math.min(done + 1, n), n)}</p>
        <p className="text-xs tabular-nums text-neutral-400" aria-hidden="true">
          {running ? UI.timerSeconds(Math.floor(elapsed)) : done > 0 && !all ? UI.timerRest : ""}
        </p>
      </div>
      {all
        ? <button type="button" className={BTN_SOFT} onClick={() => session.setUi(key, 0)} data-reps-again="">{UI.repAgain}</button>
        : running
          ? <button type="button" className={BTN_PRIMARY} onClick={() => { setStartAt(null); setElapsed(0); count(); }} data-timer-stop="">{UI.timerStop}</button>
          : (
            <button type="button" className={BTN_SOFT} onClick={() => { setElapsed(0); setStartAt(performance.now()); }} data-timer-start="">
              {UI.timerStart(label, done + 1)}
            </button>
          )}
    </div>
  );
}

/** One phrase at a time, with "Next phrase" (P6). */
function PhraseStepper({ card, cardIndex, direction, s }) {
  const list = forDir(card.phrases, direction);
  const key = `${cardIndex}:phrase`;
  const i = Math.min(s.ui[key] ?? 0, list.length - 1);
  const last = i === list.length - 1;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1" data-phrase={i}>
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-xs tabular-nums text-neutral-400">{UI.phrase(i + 1, list.length)}</p>
        <p className="text-sm leading-snug text-white" data-phrase-text="">“{list[i]}”</p>
      </div>
      <button type="button" className={BTN_SOFT} onClick={() => session.setUi(key, last ? 0 : i + 1)} data-next-phrase="">
        {last ? UI.firstPhrase : UI.nextPhrase}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- recordings

/**
 * Record a take while the frames the hook hands the exercise frame tap are counted
 * (takeChecks.js: its pitch). The tap is this take's only while it records.
 */
function startCountedTake(takeId) {
  return session.startTake(takeId, (onProgress, onDone) => {
    const log = createTakeVoiceLog();
    setExerciseFrameTap((frame) => log.push(frame));
    const r = recordTake(getVoicePreviewCapture(), {
      onProgress,
      onDone: (t) => { setExerciseFrameTap(null); onDone(t ? { ...t, voice: log.stats() } : t); },
    });
    if (!r) setExerciseFrameTap(null);
    return r;
  });
}

function takeNoteText(take, spec) {
  const note = takeNote(take, spec);
  return note === "short" ? UI.takeShort(fmtS(take.seconds)) : null;
}

function TakeRow({ take, listening, sessionRec, s, many }) {
  const rec = s.recording?.takeId === take.id ? s.recording : null;
  const other = s.recording && !rec;
  const has = s.takes[take.id];
  const note = has && !rec ? takeNoteText(has, take) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5" data-take={take.id} data-take-recorded={has ? "1" : "0"} data-take-note={note ? takeNote(has, take) : undefined}>
      <div className="flex-1">
        <p className="text-sm text-neutral-100">{take.label}</p>
        <p className="text-xs tabular-nums text-neutral-400">
          {rec ? UI.recording(Math.floor(rec.seconds)) : has ? UI.recorded(fmtS(has.seconds)) : UI.notRecorded}
        </p>
        <p className="sr-only" role="status">{rec ? UI.srRecording : has ? `${UI.srRecorded(fmtS(has.seconds))}${note ? `. ${note}` : ""}` : ""}</p>
      </div>
      {listening && (rec
        ? <button type="button" className={BTN_PRIMARY} aria-label={many ? UI.stopTake(take.label) : undefined} onClick={() => session.stopTake()} data-take-stop="">{UI.stop}</button>
        : (
          <button
            type="button" className={BTN_SOFT} disabled={!!other} onClick={() => startCountedTake(take.id)} data-take-record=""
            aria-label={many ? (has ? UI.recordAgainTake(take.label) : UI.recordTake(take.label)) : undefined}
          >
            {has ? UI.recordAgain : UI.record}
          </button>
        ))}
      {/* nothing plays while any take records (no echo cancellation: the mic would record it) */}
      <PlayButton name={take.id} label={take.label} take={has} blocked={sessionRec || !!s.recording} short />
      {/* said before anything else about the take (design §2 rule 3) */}
      {note && <p className="w-full text-xs leading-snug text-amber-200" aria-hidden="true" data-take-note-text="">{note}</p>}
    </div>
  );
}

/** The pitch of a take beside the pitch of the recording it is compared with (R4's try); numbers only. */
function TakePitch({ take, s }) {
  const [, h] = useHearState();
  const has = s.takes[take.id];
  if (!has || s.recording || takeNote(has, take)) return null;
  // the recording's line only while that recording is the one kept (Voice Shaper accepted it)
  const rec = h?.original ? s.ui["hear:voice"] : null;
  const lines = [
    rec ? (takePitchHz({ voice: rec }) != null ? UI.pitchOf(UI.yourRecording, takePitchHz({ voice: rec })) : UI.pitchNone(UI.yourRecording)) : null,
    takePitchHz(has) != null ? UI.pitchOf(take.label, takePitchHz(has)) : UI.pitchNone(take.label),
  ].filter(Boolean);
  return (
    <div className="mt-1" data-take-pitch="" data-take-pitch-hz={takePitchHz(has) ?? ""} data-recording-pitch-hz={rec ? takePitchHz({ voice: rec }) ?? "" : ""}>
      <p className="text-xs text-neutral-400">{UI.pitchTitle}</p>
      {lines.map((l, i) => <p key={i} className="text-sm tabular-nums text-neutral-200">{l}</p>)}
    </div>
  );
}

function SessionGuard({ sessionRec }) {
  if (!sessionRec) return null;
  return <p className="mt-2 text-xs text-neutral-200" data-session-guard="">{UI.sessionGuard}</p>;
}

function RecordCard({ card, direction, listening, onStartListening, isSessionRecording, s }) {
  const sessionRec = useSessionRec(isSessionRecording);
  return (
    <div data-record-card="">
      {!listening && <MicPrompt onStartListening={onStartListening} />}
      <div>
        {card.takes.map((t) => <TakeRow key={t.id} take={t} listening={listening} sessionRec={sessionRec} s={s} many={card.takes.length > 1} />)}
      </div>
      {card.takes.filter((t) => t.pitch).map((t) => <TakePitch key={t.id} take={t} s={s} />)}
      {card.compareWithHear && <HearVersions direction={direction} sessionRec={sessionRec} recording={!!s.recording} withTitle />}
      <SessionGuard sessionRec={sessionRec} />
    </div>
  );
}

function CompareCard({ lesson, direction, isSessionRecording, s }) {
  const sessionRec = useSessionRec(isSessionRecording);
  const takes = takesFor(lesson, direction).filter((t) => s.takes[t.id]);
  if (!takes.length) return <p className="text-sm text-neutral-300">{UI.nothingToCompare}</p>;
  return (
    <div className="flex flex-wrap gap-2" data-compare="">
      {takes.map((t) => <PlayButton key={t.id} name={t.id} label={t.label} take={s.takes[t.id]} blocked={sessionRec} />)}
      <SessionGuard sessionRec={sessionRec} />
    </div>
  );
}

// ---------------------------------------------------------------- hear it first (R4)

const noSubscribe = () => () => {};
const noState = () => null;
/** "Hear it first"'s wrapper (null until hearShaper.js has loaded) and its state. */
function useHearState() {
  useSyncExternalStore(session.subscribe, () => session.getState().hearReady);
  const hear = session.getHear();
  const h = useSyncExternalStore(hear ? hear.subscribe : noSubscribe, hear ? hear.getState : noState);
  return [hear, h];
}

/**
 * `recording`: a take is being recorded — nothing plays meanwhile (the mic would record it; no echo cancellation).
 * `rebuilt` (the Listen card): the unchanged version is the recording rebuilt by the same
 * vocoder as the changed ones, so only the resonance differs; on the try card the raw
 * recording plays beside the raw try instead.
 */
function HearVersions({ direction, sessionRec, recording = false, withTitle = false, rebuilt = false }) {
  const [hear, h] = useHearState();
  useEffect(() => { hear?.setShifts(hearShifts(direction)); }, [hear, direction]);
  if (!hear || !h || !h.original) {
    if (withTitle) return null;
    return <p className="text-sm text-neutral-300">{h?.phase === "analysing" ? UI.preparing : UI.hearRecordFirst}</p>;
  }
  const shifts = hearShifts(direction);
  const missing = shifts.some((pct) => !h.versions[pct]);
  return (
    <div className={withTitle ? "mt-2" : ""} data-hear-versions="">
      <div className="flex flex-wrap gap-2">
        {rebuilt
          ? <PlayButton name="hear-rebuild" label={UI.unchanged} take={h.rebuild} blocked={sessionRec || recording} />
          : <PlayButton name="hear-original" label={UI.yourRecording} take={h.original} blocked={sessionRec || recording} />}
        {shifts.map((pct) => (
          <PlayButton key={pct} name={`hear-${pct}`} label={pct > 0 ? UI.brighter : UI.darker} take={h.versions[pct]} blocked={sessionRec || recording} />
        ))}
      </div>
      {missing && <p className="mt-2 text-xs text-neutral-300" aria-live="polite">{UI.preparing}</p>}
    </div>
  );
}

function HearRecord({ listening, onStartListening, vs }) {
  const [hear, h] = useHearState();
  const [readyMs, setReadyMs] = useState(0);
  useEffect(() => {
    if (!hear) return undefined;
    const t = setInterval(() => setReadyMs(hear.readyInMs() ?? 0), 250);
    return () => clearInterval(t);
  }, [hear]);
  if (!listening) return <MicPrompt onStartListening={onStartListening} />;
  if (!hear || !h || h.phase === "loading") return <p className="text-sm text-neutral-300">{UI.hearLoading}</p>;
  if (h.phase === "unsupported") return <p className="text-sm text-neutral-300">{UI.hearUnsupported}</p>;
  if (h.phase === "load-error") return <p className="text-sm text-neutral-300">{vs.loadError ?? UI.hearError}</p>;
  const recordBtn = (again) => (
    <button
      type="button"
      className={BTN_PRIMARY}
      disabled={readyMs > 0 || h.rearming || h.phase === "analysing"}
      onClick={() => (again ? hear.recordAgain() : hear.record())}
      data-hear-record=""
    >
      {again ? UI.recordAgain : UI.record}
    </button>
  );
  const wait = readyMs > 0 ? <p className="text-xs tabular-nums text-neutral-300">{UI.readyIn(Math.ceil(readyMs / 1000))}</p> : null;
  const message = {
    "too-short": UI.hearTooShort, "no-voice": UI.hearNoVoice, cancelled: UI.hearCancelled, error: UI.hearError, memory: UI.hearError,
  }[h.phase];
  const recordedS = fmtS(h.original ? h.original.pcm.length / h.original.rate : 0);
  const analysingText = (h.stage === "model" ? vs.analysingModel : h.stage === "denoise" ? vs.analysingDenoise : null) ?? UI.preparing;
  let body;
  if (h.phase === "recording") {
    body = (
      <>
        <p className="text-sm tabular-nums text-neutral-200">{UI.recording(Math.floor(h.seconds ?? 0))}</p>
        <button type="button" className={BTN_PRIMARY} onClick={() => hear.stop()} data-hear-stop="">{UI.stop}</button>
      </>
    );
  } else if (h.phase === "analysing") {
    // a (disabled) button stays where Stop was, so the focus isn't dropped
    body = (
      <>
        <p className="text-sm text-neutral-200">{analysingText}</p>
        {recordBtn(true)}
      </>
    );
  } else if (h.phase === "preview") {
    body = (
      <>
        <p className="text-sm text-neutral-200" data-hear-recorded="">{UI.recorded(recordedS)}</p>
        {recordBtn(true)}
        {wait}
      </>
    );
  } else {
    body = (
      <>
        {message && <p className="w-full text-sm text-neutral-200">{message}</p>}
        {recordBtn(h.phase === "error" || h.phase === "memory")}
        {wait}
      </>
    );
  }
  // one status for screen readers, mounted with the recorder and changed once per phase
  const status = h.phase === "recording" ? UI.srRecording : h.phase === "analysing" ? analysingText
    : h.phase === "preview" ? UI.srRecorded(recordedS) : message ?? "";
  return (
    <div className="flex flex-wrap items-center gap-2" data-hear-phase={h.phase}>
      {body}
      <p className="sr-only" role="status">{status}</p>
    </div>
  );
}

// ---------------------------------------------------------------- test your ear

/**
 * The two recordings of a guess card: R3's two takes, or R4's unchanged rebuild and a
 * changed version (`shift`, picked per round when the direction has two). null until ready.
 */
function guessItems(card, s, h, shift) {
  if (card.guess.takes) {
    const [x, y] = card.guess.takes;
    if (!s.takes[x] || !s.takes[y]) return null;
    return { [x]: { take: s.takes[x] }, [y]: { take: s.takes[y] } };
  }
  if (!h?.rebuild || shift == null || !h.versions[shift]) return null;
  return { unchanged: { take: h.rebuild }, [`shift${shift}`]: { take: h.versions[shift], shift } };
}

function GuessCard({ card, lesson, direction, cardIndex, isSessionRecording, s }) {
  const sessionRec = useSessionRec(isSessionRecording);
  const [hear, h] = useHearState();
  const key = `${cardIndex}:guess`;
  const g = s.ui[key] ?? null;
  const fromTakes = !!card.guess.takes;
  // A round: which recording is A and which is B (random), and for R4 which change it uses.
  // Made outside render (Math.random), once both recordings exist.
  const shifts = hearShifts(direction);
  const shiftsKey = shifts.join();
  const shift = g?.shift ?? null;
  const items = guessItems(card, s, h, fromTakes ? null : shift ?? shifts[0]);
  const ready = !!items;
  // the recordings a round was made from: re-recording a take (R3) or the recording (R4,
  // a new rebuild) makes a new round, so the answers wait until the new ones are heard
  const src = fromTakes ? card.guess.takes.map((t) => s.takes[t] ?? null) : [h?.rebuild ?? null];
  // the changed versions this card needs (the goal can change while it is open)
  useEffect(() => { if (!fromTakes) hear?.setShifts(hearShifts(direction)); }, [hear, fromTakes, direction]);
  const focusRef = useRef(null); // "again" after a pick, "play" after a new round
  const againRef = useRef(null);
  const firstPlayRef = useRef(null);
  useEffect(() => {
    const now = hearShifts(direction);
    const stale = g && (g.src?.some((x, i) => x !== src[i]) || (!fromTakes && !now.includes(g.shift)));
    // the goal changed mid-lesson to one without this round's change, or a recording changed: a new round
    if (stale) { session.player.stop(); session.setUi(key, null); return; }
    if (g || !ready) return;
    session.setUi(key, { ...newGuessRound(card, now), src });
    // src's items are compared one by one above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, ready, key, card, fromTakes, direction, shiftsKey, ...src]);
  // Keyboard focus: the picked answer (and Mix them up again) become disabled / go away
  // under it, so it moves to Mix them up again after a pick (the reveal above it is announced
  // as a status) and to Play A after a new round.
  useEffect(() => {
    const where = focusRef.current;
    focusRef.current = null;
    if (where === "again") againRef.current?.focus();
    else if (where === "play") firstPlayRef.current?.querySelector("button")?.focus();
  }, [g?.pick, g?.order]);
  if (!ready || !g) {
    if (fromTakes) return <p className="text-sm text-neutral-300">{UI.guessNeedTakes}</p>;
    return <p className="text-sm text-neutral-300">{h?.phase === "analysing" || (h?.original && !items) ? UI.preparing : UI.hearRecordFirst}</p>;
  }
  const ids = g.order;
  const itemOf = (x) => (fromTakes ? s.takes[x] : x === "unchanged" ? h.rebuild : h.versions[g.shift]);
  const blocked = sessionRec || !!s.recording;
  const bothPlayed = g.played[0] && g.played[1];
  const [nameA, nameB] = UI.guessNames;
  const names = [nameA, nameB];
  const play = (i) => () => { const next = markPlayed(g, i); if (next !== g) session.setUi(key, next); };
  const desc = fromTakes
    ? (id) => takesFor(lesson, direction).find((t) => t.id === id)?.label ?? id
    : (id) => (id === "unchanged" ? UI.guessUnchanged : UI.guessShifted(g.shift));
  const reveal = g.pick != null ? revealLines(g, names, desc, UI) : null;
  return (
    <div data-guess="" data-guess-order={ids.join(",")} data-guess-pick={g.pick ?? ""}>
      <div className="flex flex-wrap gap-2" ref={firstPlayRef}>
        {ids.map((id, i) => (
          <PlayButton key={id} name={`guess-${i}`} label={names[i]} take={itemOf(id)} blocked={blocked} onPlay={play(i)} />
        ))}
      </div>
      <fieldset className="mt-2" disabled={g.pick != null} aria-describedby={bothPlayed ? undefined : `${key}-first`}>
        <legend className="text-sm text-neutral-200">{UI.guessQuestion(askedWord(g))}</legend>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {names.map((n, i) => (
            <button
              key={n} type="button" className={BTN_TOGGLE} aria-pressed={g.pick === i} disabled={!bothPlayed}
              onClick={() => { focusRef.current = "again"; session.setUi(key, { ...g, pick: i }); }} data-guess-answer={i}
            >
              {n}
            </button>
          ))}
          {!bothPlayed && <p className="text-xs text-neutral-300" id={`${key}-first`}>{UI.guessPlayFirst}</p>}
        </div>
      </fieldset>
      <div className="mt-2" role="status" data-guess-reveal="">
        {reveal?.map((l, i) => <p key={i} className="text-sm leading-snug text-neutral-100">{l}</p>)}
      </div>
      {reveal && (
        <button type="button" ref={againRef} className={`${BTN_SOFT} mt-2`} onClick={() => { session.player.stop(); focusRef.current = "play"; session.setUi(key, { ...newGuessRound(card, shifts), src }); }} data-guess-again="">
          {UI.guessAgain}
        </button>
      )}
      <SessionGuard sessionRec={sessionRec} />
    </div>
  );
}

// ---------------------------------------------------------------- result card

/** The answer to "How did that feel?" (the saved row follows; one that is still being written gets it then). */
function chooseFeel(feel) {
  session.setSaved({ feel });
  const { rowId, startedAt } = session.getState();
  if (rowId != null) updateResult(db.exerciseResults, rowId, { feel, endedAt: Date.now() });
  else pendingFeel = { startedAt, feel };
}

function ResultCard({ lesson, direction, sessionId, s, onOpen }) {
  const [last, setLast] = useState(null);
  const byFeel = lesson.result?.byFeel;

  // Save the run once, when the result card is first reached (the feel answer updates it).
  useEffect(() => {
    if (s.rowId != null || saving === s.startedAt) return;
    saving = s.startedAt;
    const frames = lesson.measures ? session.allFrames() : [];
    const result = lesson.measures ? countResult(frames, direction) : null;
    session.setSaved({ result, measuredFrames: frames.length });
    const results = result ? { levelHz: result.levelHz, inBandPct: result.inBandPct, voicedS: result.voicedS } : {};
    saveResult(db.exerciseResults, {
      exerciseId: lesson.id, startedAt: s.startedAt, endedAt: Date.now(), direction,
      sessionId, feel: session.getState().feel, results,
    }).then((rowId) => {
      // answered while the row was being written (the lesson may have closed since)
      const pf = pendingFeel?.startedAt === s.startedAt ? pendingFeel.feel : null;
      if (pendingFeel?.startedAt === s.startedAt) pendingFeel = null;
      if (rowId != null && pf != null) updateResult(db.exerciseResults, rowId, { feel: pf, endedAt: Date.now() });
      if (session.getState().startedAt !== s.startedAt) return;
      session.setSaved({ rowId });
    });
  }, [s.rowId, s.startedAt, lesson, direction, sessionId]);

  // Back to the steps and here again (more speech, or "Start this step over"): the
  // measured result is computed again and the saved row follows it.
  useEffect(() => {
    const { rowId, measuredFrames } = session.getState();
    if (!lesson.measures || rowId == null) return;
    const frames = session.allFrames();
    if (frames.length === measuredFrames) return;
    const result = countResult(frames, direction);
    session.setSaved({ result, measuredFrames: frames.length });
    const results = result ? { levelHz: result.levelHz, inBandPct: result.inBandPct, voicedS: result.voicedS } : {};
    updateResult(db.exerciseResults, rowId, { results, endedAt: Date.now() });
  }, [lesson, direction]);

  useEffect(() => {
    if (!lesson.measures || s.rowId == null) return undefined;
    let live = true;
    recentResults(db.exerciseResults, lesson.id, 1, s.rowId).then(([row]) => { if (live) setLast(row ?? null); });
    return () => { live = false; };
  }, [lesson, s.rowId]);

  // Next follows S1 -> warm-up -> practice lessons (nextLessonAfter); every practice lesson also
  // offers the cool-down ("finish with the cool-down", S1), first and alone after "Strained".
  const nextId = nextLessonAfter(lesson.id);
  const answered = s.feel != null || !byFeel;
  const strained = s.feel === "strained";
  const showCoolDown = (strained && lesson.id !== "W2" && lesson.id !== "S1") || (answered && PRACTICE.includes(lesson.id));
  const showNext = nextId && answered && !strained;

  let lines;
  if (lesson.measures) {
    const r = s.result;
    if (r == null) lines = [s.measuredFrames === 0 ? UI.countMicOff : UI.countTooLittle];
    else {
      const note = r.levelHz != null ? hzToNote(r.levelHz)?.name : null;
      lines = [
        r.levelHz != null ? UI.countLevel(Math.round(r.levelHz), note) : null,
        r.inBandPct != null ? UI.countInBand(r.inBandPct) : null,
        UI.countVoice(Math.round(r.voicedS)),
        last?.results?.levelHz != null
          ? UI.countLast(Math.round(last.results.levelHz), last.direction === direction && pitchTargetFor(direction) ? last.results.inBandPct : null)
          : null,
      ].filter(Boolean);
    }
  } else lines = [lesson.result?.done].filter(Boolean);

  return (
    <div data-result-card="" data-feel={s.feel ?? ""}>
      <div data-result-lines="">
        {lines.map((l, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-neutral-100">{l}</p>)}
      </div>
      {byFeel && (
        <fieldset className="mt-4">
          <legend className="text-sm text-neutral-200">{UI.feelQuestion}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {["easy", "effort", "strained"].map((f) => (
              <button key={f} type="button" className={BTN_TOGGLE} aria-pressed={s.feel === f} onClick={() => chooseFeel(f)} data-feel-answer={f}>
                {UI.feel[f]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="mt-3 text-sm text-neutral-200" role="status" data-feel-reply="">{s.feel ? UI.feelReply[s.feel] : ""}</p>
      {(showCoolDown || showNext) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {showCoolDown && strained && <button type="button" className={BTN_PRIMARY} onClick={() => onOpen("W2")} data-cool-down="">{UI.coolDownNow}</button>}
          {showNext && (
            <button type="button" className={BTN_SOFT} onClick={() => onOpen(nextId)} data-next-lesson={nextId}>
              {UI.nextLesson(forDir(LESSONS[nextId].title, direction))}
            </button>
          )}
          {showCoolDown && !strained && <button type="button" className={BTN_SOFT} onClick={() => onOpen("W2")} data-cool-down="">{UI.coolDownNow}</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the player

function CardBody({ card, lesson, direction }) {
  const target = pitchTargetFor(direction);
  const band = target ? formatTarget(target) : "";
  const fill = (t) => (typeof t === "string" ? t.replace("{band}", band) : t);
  const body = forDir(card.body ?? [], direction).map(fill);
  const list = card.list ? forDir(card.list, direction) : null;
  const after = card.after ? forDir(card.after, direction) : [];
  const feel = card.feel ? forDir(card.feel, direction) : [];
  const safety = card.safety ? forDir(card.safety, direction) : null;
  const troubleshooting = card.troubleshooting ? forDir(card.troubleshooting, direction) : [];
  // The safety box uses the app's existing amber classes (the "Experimental" tag), so the
  // main stylesheet (Tailwind's classes are global) barely grows.
  return (
    <>
      {card.kind === "intro" && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-neutral-100">{forDir(lesson.purpose, direction)}</p>
          {!card.title && <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{UI.whyItWorks}</h3>}
        </>
      )}
      {/* the position the steps ask for, before the steps */}
      <Drawings items={card.drawings} />
      <Paragraphs items={body} />
      {list && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-200">
          {list.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
      <Paragraphs items={after} />
      {feel.length > 0 && (
        <div data-feel-before="">
          <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{UI.feelTitle}</h3>
          <Paragraphs items={feel} />
        </div>
      )}
      {troubleshooting.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{UI.ifNot}</h3>
          <Paragraphs items={troubleshooting} />
        </>
      )}
      {safety && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2" data-safety="">
          <p className="text-xs font-medium text-amber-300">{UI.safetyTitle}</p>
          {safety.map((x, i) => <p key={i} className="mt-1 text-xs leading-snug text-neutral-100">{x}</p>)}
        </div>
      )}
    </>
  );
}

const TOOL_KINDS = new Set(["live", "record", "compare", "hear", "guess"]);
const hasTool = (card) => TOOL_KINDS.has(card.kind) || !!card.reps || !!card.timer || !!card.phrases;

/**
 * A card's tool (the live trace, the recorder, the play buttons, a counter or timer, the
 * phrase to say): drawn in its own area between the card's text and Back / Next, so it
 * stays on screen while the text scrolls (the design's phone rule, 360 x 690 and 448 x 890).
 */
function CardTool(props) {
  const { card, cardIndex, direction, s } = props;
  const main = cardMainTool(props);
  return (
    <div className="space-y-2">
      {card.timer && <HoldTimer spec={card.timer} cardIndex={cardIndex} s={s} />}
      {card.reps && <RepCounter spec={card.reps} cardIndex={cardIndex} direction={direction} s={s} />}
      {card.phrases && <PhraseStepper card={card} cardIndex={cardIndex} direction={direction} s={s} />}
      {main}
    </div>
  );
}

function cardMainTool({ card, cardIndex, lesson, direction, listening, onStartListening, pipeline, isSessionRecording, s, vs }) {
  if (card.kind === "live") {
    return <LiveView card={card} cardIndex={cardIndex} listening={listening} onStartListening={onStartListening} pipeline={pipeline} direction={direction} />;
  }
  if (card.kind === "record") {
    return <RecordCard card={card} direction={direction} listening={listening} onStartListening={onStartListening} isSessionRecording={isSessionRecording} s={s} />;
  }
  if (card.kind === "compare") return <CompareCard lesson={lesson} direction={direction} isSessionRecording={isSessionRecording} s={s} />;
  if (card.kind === "hear" && card.stage === "record") return <HearRecord listening={listening} onStartListening={onStartListening} vs={vs} />;
  if (card.kind === "hear" && card.stage === "listen") return <HearListen direction={direction} isSessionRecording={isSessionRecording} />;
  if (card.kind === "guess") {
    return <GuessCard card={card} lesson={lesson} direction={direction} cardIndex={cardIndex} isSessionRecording={isSessionRecording} s={s} />;
  }
  return null;
}

function HearListen({ direction, isSessionRecording }) {
  const sessionRec = useSessionRec(isSessionRecording);
  return (
    <>
      <HearVersions direction={direction} sessionRec={sessionRec} rebuilt />
      <SessionGuard sessionRec={sessionRec} />
    </>
  );
}

function LessonPlayer({ s, direction, listening, onStartListening, pipeline, sessionId, isSessionRecording }) {
  const lesson = LESSONS[s.lessonId];
  const cards = cardsFor(lesson, direction);
  const total = cards.length + 1;
  const index = Math.min(s.card, total - 1);
  const isResult = index === cards.length;
  const card = isResult ? null : cards[index];
  const headingRef = useRef(null);
  const scrollRef = useRef(null);
  const [vs, setVs] = useState(null);

  // The goal changed mid-lesson (Settings): stay on the same card, though a card that only
  // one goal has (R3's "In between") moves the ones after it.
  const cardsRef = useRef(cards);
  useEffect(() => {
    const prev = cardsRef.current;
    cardsRef.current = cards;
    if (prev === cards || prev.length === cards.length) return;
    const was = Math.min(s.card, prev.length);
    const now = was === prev.length ? cards.length : cards.indexOf(prev[was]);
    if (now >= 0 && now !== s.card) session.setCard(now);
  }, [cards, s.card]);

  // Voice Shaper's own state texts ("Hear it first" only; its strings module is tiny).
  useEffect(() => {
    if (lesson.id !== "R4") return undefined;
    let live = true;
    import("../voice-preview/strings.js").then((m) => { if (live) setVs(m.S); });
    return () => { live = false; };
  }, [lesson.id]);

  // A new card: back to its top, and the focus on its heading (screen readers read it).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [index, s.lessonId]);

  // Leaving the tab stops playback (nothing on screen could stop it).
  useEffect(() => () => session.player.stop(), []);

  const lessonTitle = forDir(lesson.title, direction);
  const heading = isResult
    ? UI.resultTitle
    : card.title ? forDir(card.title, direction)
      : card.kind === "aim" ? UI.aimTitle
        : lessonTitle;
  const go = (i) => session.setCard(Math.max(0, Math.min(total - 1, i)));

  return (
    <div className="flex min-h-0 w-full max-w-2xl flex-1 flex-col mx-auto" data-lesson-player={lesson.id} data-card={index} data-card-kind={isResult ? "result" : card.kind}>
      {/* short landscape (index.css shortland): the text and the tool side by side */}
      <div className="flex min-h-0 flex-1 flex-col shortland:flex-row shortland:gap-3">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-card-scroll="">
        <div className="flex items-center gap-2 pb-1">
          <button type="button" className="min-h-11 cursor-pointer px-1 text-sm text-neutral-300 hover:text-white" onClick={() => session.close()} data-lesson-close="">
            <span aria-hidden="true">←</span> {UI.backToList}
          </button>
          <span className="ml-auto text-xs tabular-nums text-neutral-400" data-card-of="">{UI.cardOf(index + 1, total)}</span>
        </div>
        <article className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3 sm:px-4" aria-labelledby="ex-card-heading">
          {(isResult || card.kind !== "intro" || card.title) && <p className="text-xs text-neutral-400">{lessonTitle}</p>}
          <h2 id="ex-card-heading" ref={headingRef} tabIndex={-1} className="mt-0.5 text-base font-medium text-white outline-none" data-card-heading="">
            {heading}
          </h2>
          {isResult
            ? <ResultCard lesson={lesson} direction={direction} sessionId={sessionId} s={s} onOpen={(id) => openLesson(id, direction)} />
            : (
              <CardBody key={index} card={card} lesson={lesson} direction={direction} />
            )}
        </article>
      </div>
      {!isResult && hasTool(card) && (
        <div className="flex-shrink-0 pt-2 shortland:w-[46%] shortland:overflow-y-auto shortland:pt-0" data-card-tool="">
          <CardTool
            key={index}
            card={card} cardIndex={index} lesson={lesson} direction={direction} listening={listening}
            onStartListening={onStartListening} pipeline={pipeline} isSessionRecording={isSessionRecording} s={s} vs={vs ?? {}}
          />
        </div>
      )}
      </div>
      <nav className="flex gap-2 pt-2" aria-label={UI.cardNav}>
        <button type="button" className={`${BTN_SOFT} flex-1`} onClick={() => (index === 0 ? session.close() : go(index - 1))} data-card-back="">
          {index === 0 ? UI.backToList : UI.back}
        </button>
        <button
          type="button"
          className={`${BTN_PRIMARY} flex-1`}
          onClick={() => (isResult ? session.close() : go(index + 1))}
          data-card-next=""
        >
          {isResult ? UI.backToList : index === cards.length - 1 ? UI.finish : UI.next}
        </button>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- the tab

export default function ExercisesView({
  listening = false, direction = null, onStartListening, pipeline = null, sessionId = null, isSessionRecording,
}) {
  const s = useSyncExternalStore(session.subscribe, session.getState);
  if (!s.lessonId || !LESSONS[s.lessonId]) return <LessonList direction={direction} />;
  return (
    <LessonPlayer
      s={s} direction={direction} listening={listening && !!pipeline} onStartListening={onStartListening}
      pipeline={pipeline} sessionId={sessionId} isSessionRecording={isSessionRecording}
    />
  );
}
