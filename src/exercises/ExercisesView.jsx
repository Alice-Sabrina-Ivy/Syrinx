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
import { pitchTargetFor, pitchStatus, formatTarget } from "../utils/trainingDirection.js";
import { statusTextClass } from "../utils/constants.js";
import { hzToNote } from "../utils/pitchUtils.js";
import { getVoicePreviewCapture, onVoicePreviewCapture } from "../voice-preview/bridge.js";
import { setExerciseFrameTap } from "./bridge.js";
import {
  LESSONS, GROUPS, LESSON_ORDER, UI, forDir, cardsFor, takesFor, hearShifts, lastDoneText,
} from "./lessons.js";
import { countResult } from "./results.js";
import { saveResult, updateResult, lastDoneByLesson, recentResults } from "./store.js";
import { createLessonSession } from "./session.js";
import { recordTake } from "./takes.js";

// ---------------------------------------------------------------- the open lesson

const session = createLessonSession();
// Listening stopped: a take being recorded keeps what it has, and nothing plays on.
onVoicePreviewCapture((h) => {
  if (!h) { session.stopTake(); session.player.stop(); }
});

let saving = null; // the lesson run (startedAt) whose result row is being written

function openLesson(id, direction) {
  session.open(id);
  if (id === "R4") {
    import("./hearShaper.js").then((m) => {
      const s = session.getState();
      if (s.lessonId === "R4" && !session.getHear()) session.setHear(m.createShaperHear(hearShifts(direction)));
    }).catch((err) => console.error("Exercises: Voice Shaper could not load", err));
  }
}

// ---------------------------------------------------------------- shared bits

const BTN = "inline-flex items-center justify-center rounded-lg border border-transparent text-sm transition-colors cursor-pointer min-h-11 px-3 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300";
const BTN_SOFT = `${BTN} bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:hover:bg-neutral-800`;
const BTN_PRIMARY = `${BTN} bg-purple-600 text-white hover:bg-purple-500 disabled:hover:bg-purple-600`;
const BTN_TOGGLE = `${BTN_SOFT} aria-pressed:bg-neutral-200 aria-pressed:text-neutral-900 aria-pressed:hover:bg-neutral-100 forced-colors:aria-pressed:bg-[Highlight] forced-colors:aria-pressed:text-[HighlightText]`;

const fmtS = (s) => (Math.round(s * 10) / 10).toFixed(1);

function Paragraphs({ items }) {
  return items.map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-neutral-200">{p}</p>);
}

function MicPrompt({ onStartListening }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2" data-mic-prompt="">
      <p className="text-sm text-neutral-300">{UI.micOff}</p>
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

/** `short`: the visible text is just "Play" (the take's name is beside it); the accessible name keeps it. */
function PlayButton({ name, label, take, blocked, short = false }) {
  const pb = useSyncExternalStore(session.player.subscribe, session.player.getState);
  const playing = pb.playing === name;
  return (
    <button
      type="button"
      className={`${BTN_TOGGLE} gap-1.5`}
      aria-pressed={playing}
      aria-label={UI.play(label)}
      disabled={!take || blocked}
      onClick={() => session.player.play(name, take)}
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
    lastDoneByLesson(db.exerciseResults).then((d) => { if (live) setDone(d); });
    return () => { live = false; };
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

function LevelLine({ pipeline, target }) {
  const shows = (pipeline.pitchVoiced || pipeline.pitchHolding) && pipeline.pitchLevel != null;
  if (!shows) return <p className="text-sm tabular-nums text-neutral-400" data-level-line="">{UI.levelNone}</p>;
  // judged on the number shown, so "165 Hz" never reads "below the band" (165–255)
  const hz = Math.round(pipeline.pitchLevel);
  const status = pitchStatus(hz, target);
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
  if (!listening) return <MicPrompt onStartListening={onStartListening} />;
  const target = pitchTargetFor(direction);
  return (
    <div className="space-y-1" data-live-view="">
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
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <LevelLine pipeline={pipeline} target={target} />
        {card.live?.measure && <MeasureLine cardIndex={cardIndex} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- recordings

function TakeRow({ take, listening, sessionRec, s }) {
  const rec = s.recording?.takeId === take.id ? s.recording : null;
  const other = s.recording && !rec;
  const has = s.takes[take.id];
  const start = () => session.startTake(take.id, (onProgress, onDone) =>
    recordTake(getVoicePreviewCapture(), { onProgress, onDone }));
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5" data-take={take.id} data-take-recorded={has ? "1" : "0"}>
      <div className="flex-1">
        <p className="text-sm text-neutral-100">{take.label}</p>
        <p className="text-xs tabular-nums text-neutral-400" aria-live="polite">
          {rec ? UI.recording(Math.floor(rec.seconds)) : has ? UI.recorded(fmtS(has.seconds)) : UI.notRecorded}
        </p>
      </div>
      {listening && (rec
        ? <button type="button" className={BTN_PRIMARY} onClick={() => session.stopTake()} data-take-stop="">{UI.stop}</button>
        : <button type="button" className={BTN_SOFT} disabled={!!other} onClick={start} data-take-record="">{has ? UI.recordAgain : UI.record}</button>)}
      <PlayButton name={take.id} label={take.label} take={has} blocked={sessionRec || !!rec} short />
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
        {card.takes.map((t) => <TakeRow key={t.id} take={t} listening={listening} sessionRec={sessionRec} s={s} />)}
      </div>
      {card.compareWithHear && <HearVersions direction={direction} sessionRec={sessionRec} withTitle />}
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

function HearVersions({ direction, sessionRec, withTitle = false }) {
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
        <PlayButton name="hear-original" label={UI.yourRecording} take={h.original} blocked={sessionRec} />
        {shifts.map((pct) => (
          <PlayButton key={pct} name={`hear-${pct}`} label={pct > 0 ? UI.brighter : UI.darker} take={h.versions[pct]} blocked={sessionRec} />
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
      disabled={readyMs > 0}
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
  let body;
  if (h.phase === "recording") {
    body = (
      <>
        <p className="text-sm tabular-nums text-neutral-200" aria-live="polite">{UI.recording(Math.floor(h.seconds ?? 0))}</p>
        <button type="button" className={BTN_PRIMARY} onClick={() => hear.stop()} data-hear-stop="">{UI.stop}</button>
      </>
    );
  } else if (h.phase === "analysing") {
    const text = (h.stage === "model" ? vs.analysingModel : h.stage === "denoise" ? vs.analysingDenoise : null) ?? UI.preparing;
    body = <p className="text-sm text-neutral-200" aria-live="polite">{text}</p>;
  } else if (h.phase === "preview") {
    body = (
      <>
        <p className="text-sm text-neutral-200" data-hear-recorded="">{UI.recorded(fmtS(h.original ? h.original.pcm.length / h.original.rate : 0))}</p>
        {recordBtn(true)}
        {wait}
      </>
    );
  } else {
    body = (
      <>
        {message && <p className="w-full text-sm text-neutral-200" aria-live="polite">{message}</p>}
        {recordBtn(h.phase === "error" || h.phase === "memory")}
        {wait}
      </>
    );
  }
  return <div className="flex flex-wrap items-center gap-2" data-hear-phase={h.phase}>{body}</div>;
}

// ---------------------------------------------------------------- result card

/** The answer to "How did that feel?" (the saved row follows; one that is still being written gets it then). */
function chooseFeel(feel) {
  session.setSaved({ feel });
  const { rowId } = session.getState();
  if (rowId != null) updateResult(db.exerciseResults, rowId, { feel, endedAt: Date.now() });
}

function ResultCard({ lesson, direction, sessionId, s, onOpen }) {
  const [last, setLast] = useState(null);
  const byFeel = lesson.result?.byFeel;

  // Save the run once, when the result card is first reached (the feel answer updates it).
  useEffect(() => {
    if (s.rowId != null || saving === s.startedAt) return;
    saving = s.startedAt;
    const result = lesson.measures ? countResult(session.allFrames(), direction) : null;
    session.setSaved({ result });
    const results = result ? { levelHz: result.levelHz, inBandPct: result.inBandPct, voicedS: result.voicedS } : {};
    saveResult(db.exerciseResults, {
      exerciseId: lesson.id, startedAt: s.startedAt, endedAt: Date.now(), direction,
      sessionId, feel: session.getState().feel, results,
    }).then((rowId) => {
      const now = session.getState();
      if (now.startedAt !== s.startedAt) return;
      session.setSaved({ rowId });
      // answered while the row was being written
      if (rowId != null && now.feel != null) updateResult(db.exerciseResults, rowId, { feel: now.feel });
    });
  }, [s.rowId, s.startedAt, lesson, direction, sessionId]);

  useEffect(() => {
    if (!lesson.measures || s.rowId == null) return undefined;
    let live = true;
    recentResults(db.exerciseResults, lesson.id, 1, s.rowId).then(([row]) => { if (live) setLast(row ?? null); });
    return () => { live = false; };
  }, [lesson, s.rowId]);

  const nextId = LESSON_ORDER[LESSON_ORDER.indexOf(lesson.id) + 1];
  const showCoolDown = s.feel === "strained" && lesson.id !== "W2" && lesson.id !== "S1";
  const showNext = nextId && s.feel !== "strained" && (s.feel != null || !byFeel);

  let lines;
  if (lesson.measures) {
    const r = s.result;
    if (r == null) lines = [UI.countTooLittle];
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
          {showCoolDown && <button type="button" className={BTN_PRIMARY} onClick={() => onOpen("W2")} data-cool-down="">{UI.coolDownNow}</button>}
          {showNext && (
            <button type="button" className={BTN_SOFT} onClick={() => onOpen(nextId)} data-next-lesson={nextId}>
              {UI.nextLesson(forDir(LESSONS[nextId].title, direction))}
            </button>
          )}
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
      <Paragraphs items={body} />
      {list && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-200">
          {list.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
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

const TOOL_KINDS = new Set(["live", "record", "compare", "hear"]);

/**
 * A card's tool (the live trace, the recorder, the play buttons): drawn in its own area
 * between the card's text and Back / Next, so it stays on screen while the text scrolls
 * (the design's phone rule, 360 x 690 and 448 x 890).
 */
function CardTool({ card, cardIndex, lesson, direction, listening, onStartListening, pipeline, isSessionRecording, s, vs }) {
  if (card.kind === "live") {
    return <LiveView card={card} cardIndex={cardIndex} listening={listening} onStartListening={onStartListening} pipeline={pipeline} direction={direction} />;
  }
  if (card.kind === "record") {
    return <RecordCard card={card} direction={direction} listening={listening} onStartListening={onStartListening} isSessionRecording={isSessionRecording} s={s} />;
  }
  if (card.kind === "compare") return <CompareCard lesson={lesson} direction={direction} isSessionRecording={isSessionRecording} s={s} />;
  if (card.kind === "hear" && card.stage === "record") return <HearRecord listening={listening} onStartListening={onStartListening} vs={vs} />;
  if (card.kind === "hear" && card.stage === "listen") return <HearListen direction={direction} isSessionRecording={isSessionRecording} />;
  return null;
}

function HearListen({ direction, isSessionRecording }) {
  const sessionRec = useSessionRec(isSessionRecording);
  return (
    <>
      <HearVersions direction={direction} sessionRec={sessionRec} />
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
            ← {UI.backToList}
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
      {!isResult && TOOL_KINDS.has(card.kind) && (
        <div className="flex-shrink-0 pt-2 shortland:w-[46%] shortland:overflow-y-auto shortland:pt-0" data-card-tool="">
          <CardTool
            key={index}
            card={card} cardIndex={index} lesson={lesson} direction={direction} listening={listening}
            onStartListening={onStartListening} pipeline={pipeline} isSessionRecording={isSessionRecording} s={s} vs={vs ?? {}}
          />
        </div>
      )}
      </div>
      <nav className="flex gap-2 pt-2" aria-label={lessonTitle}>
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
