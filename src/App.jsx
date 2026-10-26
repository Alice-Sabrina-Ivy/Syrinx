import { Component, useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchTrace } from "./components/PitchTrace";
import { CombinedDashboard } from "./components/CombinedDashboard";
import { SessionHistory } from "./components/SessionHistory";
import { SavedToast } from "./components/PracticeDock";
import { DataManagement } from "./components/DataManagement";
import { DirectionPrompt } from "./components/DirectionPrompt";
import { DIAG_ENABLED } from "./diag/diag";
import { repairInterruptedSessions } from "./utils/sessionRepair";
import {
  loadTrainingDirection,
  saveTrainingDirection,
  pitchTargetFor,
} from "./utils/trainingDirection";
import { loadHeardAsEnabled, saveHeardAsEnabled, HEARD_AS_DEFAULT } from "./utils/heardAsSetting";
import { loadVoiceGateEnabled, saveVoiceGateEnabled, VOICE_GATE_DEFAULT } from "./utils/voiceGateSetting";
import { loadLabEnabled, saveLabEnabled } from "./utils/labSetting";
import { withdrawResonanceLab } from "./resonance-lab/labRequest";
import db from "./db";

// Diagnostic overlay is dynamically imported and only rendered when the
// ?diag=1 URL flag is present. Production users get zero bundle impact —
// Vite code-splits the lazy import into its own chunk that's never loaded
// without the flag.
const DiagnosticOverlay = DIAG_ENABLED
  ? lazy(() => import("./diag/DiagnosticOverlay.jsx"))
  : null;

// Experimental resonance lab view — a lazy chunk fetched only when the tab is
// opened; opening it is also what starts the lab (resonance-lab/labRequest.js).
// The tab is shown only when Settings' "Show the Resonance lab (experimental)"
// is on (off by default since 2026-10-21, utils/labSetting.js); turning it off
// leaves the tab (to the Dashboard) and stops the running lab.
const LabView = lazy(() => import("./resonance-lab/LabView.jsx"));

// Experimental Voice Shaper (record a phrase, hear it with another pitch or
// resonance; src/voice-preview/, measurements/voice-preview-phase1-2026-10-19.md):
// its own tab since 2026-10-20 (a Resonance lab view before). A lazy chunk fetched
// only when the tab is first opened; loading it starts its worker. Opening it does
// not start the lab.
const VoiceShaperView = lazy(() => import("./voice-preview/VoiceShaperView.jsx"));

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pitch", label: "Pitch" },
  { id: "history", label: "History" },
  { id: "shaper", label: "Voice Shaper" },
  { id: "lab", label: "Resonance lab" },
];
// Without the lab setting: the first four.
const TABS_NO_LAB = TABS.filter((t) => t.id !== "lab");

// The tab bar (the same in every state). Below Tailwind's sm breakpoint the tabs
// are narrower (px-2, gap-0.5) so the five fit on one row at 360 px, the two-word
// labels wrapping onto two lines there; from sm up, px-4 / gap-1 as before the
// Voice Shaper tab (2026-10-20). With larger text (125 % at 360 px) the row is
// wider than the screen: `justify-center-safe` starts it at its first tab and it
// scrolls sideways, instead of centring and cutting off "Dashboard" and
// "Resonance lab" where nothing could scroll to them (review 2026-10-20). Under
// 360 px the row reaches into the page's 16 px gutters (-mx-4), as the centred
// tabs already did at 320 px (5-315 px), so they still fit there without
// scrolling; px-1 / pt-1 / pb-1 keep the focus ring inside the scroll box, and
// -mx-1 / -mt-1 / mb-2 cancel them, so at the default text size nothing moves
// from 360 px up. Inactive labels
// neutral-400 (about 7:1; neutral-500 was about 4:1 at 12 px), aria-current on
// the active tab. Four tabs (the lab setting off, the default) use the same
// classes: they fit with room to spare.
function TabNav({ activeTab, setActiveTab, tabs = TABS }) {
  return (
    <nav className="flex-shrink-0 flex justify-center-safe gap-0.5 sm:gap-1 overflow-x-auto -mx-1 max-[360px]:-mx-4 px-1 -mt-1 pt-1 pb-1 mb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
          className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === tab.id
              ? "bg-neutral-700 text-white"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// A Voice Shaper chunk that fails to download (a deploy replaced the hashed chunks
// while the page stayed open, a flaky phone connection) must not take the app down:
// without a boundary React removes the whole root (tabs, the practice dock, a running
// session recording). The texts equal strings.js S.loading / S.loadError
// (tests/voice-preview/strings-test.js checks them).
class ShaperBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="text-sm text-neutral-300" data-vp-load-error="">Voice Shaper could not load. Reload the page to try again.</p>
      : this.props.children;
  }
}

const WELCOME_KEY = "syrinx_welcomed";

// How long to wait for the saved training direction (IndexedDB) before
// asking without a preselection — a blocked/hung IndexedDB must not keep
// the question from appearing.
const DIRECTION_LOAD_TIMEOUT_MS = 1500;

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  // Read localStorage in the lazy initializer instead of via a mount-time
  // useEffect: the effect path triggered an extra render (idle → welcome)
  // and React 19's compiler-hint rule flagged the useEffect-then-setState
  // pattern as a cascading-render risk. The initializer runs once before
  // first paint, so first-visit users see the welcome sheet (the goal
  // question's "first" variant) immediately rather than after a
  // render-then-update flicker.
  // localStorage access THROWS (SecurityError) when site data is blocked
  // — uncaught here it white-screened the app (no error boundary). Then
  // there is nowhere to remember the dismissal: show the welcome once per
  // page load.
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !localStorage.getItem(WELCOME_KEY);
    } catch {
      return true;
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  // Training direction: asked on EVERY load (never assumed). `direction`
  // stays null — no targets, neutral readouts — until it's answered.
  // The last answer (Dexie settings) is preselected in the prompt.
  const [direction, setDirection] = useState(null);
  const [savedDirection, setSavedDirection] = useState(null);
  const [directionLoaded, setDirectionLoaded] = useState(false);
  const [showDirectionPrompt, setShowDirectionPrompt] = useState(true);
  // Experimental "Likely heard as" panel: ON by default since 2026-10-25
  // (missing / blocked storage = on; user decision: no turn-on button, it
  // downloads by itself); Settings' switch is the only way to turn it off.
  const [heardAsEnabled, setHeardAsEnabledState] = useState(HEARD_AS_DEFAULT);
  // "Hide pitch when no voice is heard (experimental)" — the voice gate: ON
  // by default (utils/voiceGateSetting.js).
  const [voiceGateEnabled, setVoiceGateEnabledState] = useState(VOICE_GATE_DEFAULT);
  // "Show the Resonance lab (experimental)": OFF by default (missing /
  // blocked storage = off); the tab is shown only while it is on.
  const [labEnabled, setLabEnabledState] = useState(false);
  // Settings returns focus to the gear when it closes.
  const gearRef = useRef(null);
  const settingsOpenedRef = useRef(false);
  // Ref for session metadata (notes, elapsed, recording state) —
  // kept in sync by CombinedDashboard, readable by a future save/export feature.
  const sessionRef = useRef({ recording: false, elapsed: 0, notes: "" });
  // The practice dock's slot (CombinedDashboard portals the dock into it
  // on every tab), the recording in progress (History's "Recording now"
  // card), the saved toast and the session History should open.
  const [dockSlot, setDockSlot] = useState(null);
  const [liveRecording, setLiveRecording] = useState(null);
  const [savedToast, setSavedToast] = useState(null);
  const [openSessionId, setOpenSessionId] = useState(null);
  const closeSavedToast = useCallback(() => setSavedToast(null), []);
  // A tab change by the user ends the toast's "Show session" request, so
  // History doesn't reopen that card on every later visit.
  const selectTab = useCallback((t) => {
    setOpenSessionId(null);
    setActiveTab(t);
  }, []);
  const showSavedSession = useCallback(() => {
    if (savedToast) setOpenSessionId(savedToast.sessionId);
    setSavedToast(null);
    setActiveTab("history");
  }, [savedToast]);
  const {
    status,
    error,
    voiced,
    holding,
    pitchVoiced,
    pitchHolding,
    pitch,
    pitchLevel,
    steadiness,
    steadinessHeld,
    hnr,
    voiceGateStatus,
    modelStatus,
    modelProgress,
    resonanceStatus,
    start,
    stop,
    pitchTraceRef,
    subscribeTrace,
    genderStateRef,
    resonanceRef,
    heardAsRef,
    pitchOnlyRef,
    audioClockRef,
    setHeardAsEnabled,
    setVoiceGateEnabled,
    frameCallbackRef,
    streamRef,
  } = useAudioPipeline();

  useEffect(() => {
    let done = false;
    const finish = (dir) => {
      if (done) return;
      done = true;
      setSavedDirection(dir);
      setDirectionLoaded(true);
    };
    loadTrainingDirection(db.settings).then(finish);
    const timer = setTimeout(() => finish(null), DIRECTION_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // The "Likely heard as" switch. No timeout (unlike the direction): the
  // default, on, is in place from the first render, so a slow IndexedDB only
  // delays applying a saved "off" — however late it arrives, it still wins
  // (worst case the gender worker has started, and setHeardAsEnabled(false)
  // terminates it). A user toggle before the load resolves wins.
  const heardAsTouchedRef = useRef(false);
  useEffect(() => {
    let live = true;
    loadHeardAsEnabled(db.settings).then((on) => {
      if (!live || heardAsTouchedRef.current) return;
      setHeardAsEnabledState(on);
      setHeardAsEnabled(on);
    });
    return () => { live = false; };
  }, [setHeardAsEnabled]);

  function changeHeardAs(on) {
    heardAsTouchedRef.current = true;
    setHeardAsEnabledState(on);
    setHeardAsEnabled(on);
    saveHeardAsEnabled(db.settings, on);
  }

  // The voice gate switch: same load pattern (a hung IndexedDB keeps
  // the default, on); a toggle before the load resolves wins.
  const voiceGateTouchedRef = useRef(false);
  useEffect(() => {
    let done = false;
    loadVoiceGateEnabled(db.settings).then((on) => {
      if (done || voiceGateTouchedRef.current) return;
      done = true;
      setVoiceGateEnabledState(on);
      setVoiceGateEnabled(on);
    });
    const timer = setTimeout(() => { done = true; }, DIRECTION_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [setVoiceGateEnabled]);

  function changeVoiceGate(on) {
    voiceGateTouchedRef.current = true;
    setVoiceGateEnabledState(on);
    setVoiceGateEnabled(on);
    saveVoiceGateEnabled(db.settings, on);
  }

  // The lab switch: same load pattern (a hung IndexedDB keeps it off); a
  // toggle before the load resolves wins.
  const labTouchedRef = useRef(false);
  useEffect(() => {
    let done = false;
    loadLabEnabled(db.settings).then((on) => {
      if (done || labTouchedRef.current) return;
      done = true;
      setLabEnabledState(on);
    });
    const timer = setTimeout(() => { done = true; }, DIRECTION_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Turning it off while the lab tab is open goes to the Dashboard, and the
  // running lab (its worker and capture consumer) stops; it starts again only
  // when the tab is opened again (resonance-lab/labRequest.js).
  function changeLab(on) {
    labTouchedRef.current = true;
    setLabEnabledState(on);
    saveLabEnabled(db.settings, on);
    if (!on) {
      setActiveTab((t) => (t === "lab" ? "dashboard" : t));
      withdrawResonanceLab();
    }
  }
  const tabs = labEnabled ? TABS : TABS_NO_LAB;

  // The load-time question. Its primary button confirms AND starts
  // listening (one tap per load, as Start Listening alone was before the
  // question existed); "Not now" / Escape only confirm a chosen goal.
  function confirmDirection(next, { start: startListening = true } = {}) {
    setDirection(next);
    setSavedDirection(next);
    setShowDirectionPrompt(false);
    markWelcomed();
    saveTrainingDirection(db.settings, next);
    if (startListening && status === "idle") start();
  }

  // "Not now" with no goal chosen: close, the goal stays unset.
  function dismissDirection() {
    setShowDirectionPrompt(false);
    markWelcomed();
  }

  // Start Listening / Try Again: a goal is never assumed — with none set
  // (the first visit's "Not now") the question comes back first and its
  // primary button starts the microphone.
  function requestStart() {
    if (direction == null) setShowDirectionPrompt(true);
    else start();
  }

  // Settings panel, any time (also mid-session): applies at once.
  function changeDirection(next) {
    setDirection(next);
    setSavedDirection(next);
    saveTrainingDirection(db.settings, next);
  }

  // One-shot repair of sessions a previous visit never finalized (tab
  // close / crash / mobile discard) — see utils/sessionRepair.js. A
  // History list that already loaded re-queries via the same event a
  // normal finalize dispatches.
  useEffect(() => {
    repairInterruptedSessions().then((n) => {
      if (n > 0) window.dispatchEvent(new CustomEvent("syrinx:session-finalized"));
    });
  }, []);

  // The first-visit sheet has been answered or put off: later loads get
  // the return-visit sheet (when a goal is saved).
  function markWelcomed() {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Site data blocked — lasts for this page load only.
    }
    setShowWelcome(false);
  }

  useEffect(() => {
    if (showSettings) settingsOpenedRef.current = true;
    else if (settingsOpenedRef.current) {
      settingsOpenedRef.current = false;
      gearRef.current?.focus();
    }
  }, [showSettings]);

  // While the goal question (also while the saved answer is still
  // loading) or Settings is open, everything behind it is inert: no focus,
  // no clicks — so the microphone can't be started and Settings can't be
  // opened behind the question.
  const blocked = showDirectionPrompt || showSettings;

  // h-dvh, not h-screen: on phones 100vh is the viewport with the URL bar
  // HIDDEN, so with it showing the bottom row (the practice dock) sat below
  // the fold of a page that can't scroll. Every browser Tailwind 4
  // supports (Safari 16.4+, Chrome 111+, Firefox 128+) has dvh, so no
  // vh fallback is needed. Short landscape phones (shortland) get a smaller
  // bottom padding: the practice dock's 44 px buttons cost the content ~16 px
  // over the old Stop Listening bar.
  return (
    <div className="h-dvh flex flex-col px-4 py-4 shortland:pb-2 overflow-hidden">
      {/* Diagnostic overlay (only when ?diag=1) */}
      {DiagnosticOverlay && (
        <Suspense fallback={null}>
          <DiagnosticOverlay />
        </Suspense>
      )}

      {/* Training-direction question (every load): the welcome sheet on a
          first visit (or with no saved goal), else the return-visit sheet */}
      {showDirectionPrompt && directionLoaded && (
        <DirectionPrompt
          initial={savedDirection}
          variant={!showWelcome && savedDirection != null ? "return" : "first"}
          onConfirm={confirmDirection}
          onDismiss={dismissDirection}
        />
      )}

      {/* Settings overlay */}
      {showSettings && (
        <DataManagement
          onClose={() => setShowSettings(false)}
          direction={direction}
          onDirectionChange={changeDirection}
          heardAsEnabled={heardAsEnabled}
          onHeardAsChange={changeHeardAs}
          voiceGateEnabled={voiceGateEnabled}
          onVoiceGateChange={changeVoiceGate}
          voiceGateStatus={voiceGateStatus}
          labEnabled={labEnabled}
          onLabChange={changeLab}
        />
      )}

      {/* Header */}
      <header className="text-center mb-2 flex-shrink-0 relative" inert={blocked}>
        <h1 className="text-2xl font-light text-white tracking-tight">
          Syrinx
        </h1>
        <p className="text-neutral-500 text-xs mt-0.5">
          Voice training toolkit
        </p>
        {/* Gear icon */}
        <button
          ref={gearRef}
          onClick={() => setShowSettings(true)}
          className="absolute right-0 top-1 text-neutral-600 hover:text-neutral-400 transition-colors cursor-pointer"
          title="Settings & Data"
          aria-label="Settings & Data"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.08l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.524ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center min-h-0" inert={blocked}>
        {status === "idle" && activeTab !== "history" && (
          <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
            {/* Tab navigation even when idle */}
            <TabNav activeTab={activeTab} setActiveTab={selectTab} tabs={tabs} />
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={requestStart}
                className="px-8 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-lg font-medium transition-colors cursor-pointer"
              >
                Start Listening
              </button>
            </div>
          </div>
        )}

        {status === "idle" && activeTab === "history" && (
          <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
            <TabNav activeTab={activeTab} setActiveTab={selectTab} tabs={tabs} />
            <SessionHistory openSessionId={openSessionId} />
          </div>
        )}

        {status === "requesting" && (
          <div className="flex-1 flex items-center">
            <p className="text-neutral-400 animate-pulse">
              Requesting microphone access...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex-1 flex items-center">
            <div className="text-center">
              <p className="text-red-400 mb-4">{error}</p>
              <button
                onClick={requestStart}
                className="px-6 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white transition-colors cursor-pointer"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {status === "running" && (
          <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
            {/* Tab navigation */}
            <TabNav activeTab={activeTab} setActiveTab={selectTab} tabs={tabs} />

            {/* Tab content. Scrolls below lg: on a phone the trace and the
                cue strip fit the first screen above the practice dock, the
                experimental panel may need a scroll (small phones,
                landscape). At lg the side-by-side layout fills the height. */}
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto lg:overflow-y-visible">
              {/* Always mounted while the pipeline runs: it owns the
                  session recording, and unmounting it finalizes the
                  recording — switching to Pitch/History used to end the
                  session silently. Inactive, it renders nothing (its
                  canvases unmount, so no hidden rAF loops) and keeps its
                  recording state + intervals running. */}
              <CombinedDashboard
                active={activeTab === "dashboard"}
                voiced={voiced}
                holding={holding}
                pitchVoiced={pitchVoiced}
                pitchHolding={pitchHolding}
                pitch={pitch}
                pitchLevel={pitchLevel}
                steadiness={steadiness}
                steadinessHeld={steadinessHeld}
                hnr={hnr}
                modelStatus={modelStatus}
                modelProgress={modelProgress}
                pitchTraceRef={pitchTraceRef}
                subscribeTrace={subscribeTrace}
                genderStateRef={genderStateRef}
                resonanceRef={resonanceRef}
                resonanceStatus={resonanceStatus}
                heardAsRef={heardAsRef}
                pitchOnlyRef={pitchOnlyRef}
                audioClockRef={audioClockRef}
                heardAsEnabled={heardAsEnabled}
                direction={direction}
                sessionRef={sessionRef}
                frameCallbackRef={frameCallbackRef}
                streamRef={streamRef}
                dockSlot={dockSlot}
                onMicOff={stop}
                onRecordingChange={setLiveRecording}
                onSessionSaved={setSavedToast}
              />

              {activeTab === "pitch" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-[240px]">
                    <PitchTrace
                      pitchTraceRef={pitchTraceRef}
                      subscribeTrace={subscribeTrace}
                      voiced={pitchVoiced}
                      holding={pitchHolding}
                      pitch={pitch}
                      pitchLevel={pitchLevel}
                      target={pitchTargetFor(direction)}
                      steadiness={steadiness}
                      steadinessHeld={steadinessHeld}
                    />
                  </div>
                </div>
              )}

              {activeTab === "history" && <SessionHistory liveRecording={liveRecording} openSessionId={openSessionId} />}

              {activeTab === "shaper" && (
                <ShaperBoundary>
                  <Suspense fallback={<p className="text-sm text-neutral-400">Loading Voice Shaper…</p>}>
                    {/* the target prefill and the playback guard during a
                        Dashboard session recording */}
                    <VoiceShaperView direction={direction} isSessionRecording={() => sessionRef.current.recording} />
                  </Suspense>
                </ShaperBoundary>
              )}

              {activeTab === "lab" && labEnabled && (
                <Suspense fallback={null}>
                  <LabView />
                </Suspense>
              )}
            </div>

            {/* The practice dock on every tab (record / note / Mic off;
                PracticeDock.jsx, rendered by CombinedDashboard) */}
            <div ref={setDockSlot} className="flex-shrink-0" data-dock-slot="" />
          </div>
        )}
      </div>
      {/* Inert with the page while a sheet (goal question, Settings) is
          open: it sits under the sheet's backdrop and must not take focus. */}
      {savedToast && (
        <div inert={blocked}>
          <SavedToast
            key={savedToast.sessionId}
            durationSeconds={savedToast.durationSeconds}
            onShow={showSavedSession}
            onClose={closeSavedToast}
          />
        </div>
      )}
    </div>
  );
}

export default App;
