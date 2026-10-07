import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchTrace } from "./components/PitchTrace";
import { CombinedDashboard } from "./components/CombinedDashboard";
import { SessionHistory } from "./components/SessionHistory";
import { DataManagement } from "./components/DataManagement";
import { DirectionPrompt } from "./components/DirectionPrompt";
import { DIAG_ENABLED } from "./diag/diag";
import { repairInterruptedSessions } from "./utils/sessionRepair";
import {
  loadTrainingDirection,
  saveTrainingDirection,
  pitchTargetFor,
} from "./utils/trainingDirection";
import { loadHeardAsEnabled, saveHeardAsEnabled } from "./utils/heardAsSetting";
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
const LabView = lazy(() => import("./resonance-lab/LabView.jsx"));

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pitch", label: "Pitch" },
  { id: "history", label: "History" },
  { id: "lab", label: "Resonance lab" },
];

const WELCOME_KEY = "syrinx_welcomed";

// How long to wait for the saved training direction (IndexedDB) before
// asking without a preselection — a blocked/hung IndexedDB must not keep
// the question from appearing.
const DIRECTION_LOAD_TIMEOUT_MS = 1500;

// First visit only. A modal like the direction question (App makes the page
// behind it inert): focus starts on Get Started, Escape also continues,
// and the panel scrolls on short (landscape) viewports.
function WelcomeOverlay({ onDismiss }) {
  const buttonRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    buttonRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); dismissRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      data-dialog="welcome"
    >
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full text-center shadow-xl max-h-full overflow-y-auto">
        <h2 id="welcome-title" className="text-xl font-light text-white mb-3">Welcome to Syrinx</h2>
        <p className="text-sm text-neutral-300 leading-relaxed mb-5">
          Syrinx gives you real-time visual feedback on your voice pitch, resonance, and
          vocal weight — it needs microphone access to work.{" "}
          Next, choose what you&apos;re aiming for — that sets the targets highlighted on the pitch trace and the cue strip.
        </p>
        <button
          ref={buttonRef}
          onClick={onDismiss}
          className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  // Read localStorage in the lazy initializer instead of via a mount-time
  // useEffect: the effect path triggered an extra render (idle → welcome)
  // and React 19's compiler-hint rule flagged the useEffect-then-setState
  // pattern as a cascading-render risk. The initializer runs once before
  // first paint, so first-visit users see the welcome overlay
  // immediately rather than after a render-then-update flicker.
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
  // Experimental "Likely heard as" panel: OFF by default (missing / blocked
  // storage = off); the panel's switch and Settings' row share this state.
  const [heardAsEnabled, setHeardAsEnabledState] = useState(false);
  // Settings returns focus to the gear when it closes.
  const gearRef = useRef(null);
  const settingsOpenedRef = useRef(false);
  // Ref for session metadata (notes, elapsed, recording state) —
  // kept in sync by CombinedDashboard, readable by a future save/export feature.
  const sessionRef = useRef({ recording: false, elapsed: 0, notes: "" });
  const {
    status,
    error,
    voiced,
    holding,
    pitch,
    pitchLevel,
    steadiness,
    steadinessHeld,
    hnr,
    vocalWeight,
    modelStatus,
    modelProgress,
    resonanceStatus,
    start,
    stop,
    pitchTraceRef,
    genderStateRef,
    resonanceRef,
    heardAsRef,
    pitchOnlyRef,
    audioClockRef,
    setHeardAsEnabled,
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

  // The "Likely heard as" switch: same load / timeout pattern as the
  // direction (a hung IndexedDB leaves it off). A user toggle before the
  // load resolves wins.
  const heardAsTouchedRef = useRef(false);
  useEffect(() => {
    let done = false;
    loadHeardAsEnabled(db.settings).then((on) => {
      if (done || heardAsTouchedRef.current) return;
      done = true;
      setHeardAsEnabledState(on);
      setHeardAsEnabled(on);
    });
    const timer = setTimeout(() => { done = true; }, DIRECTION_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [setHeardAsEnabled]);

  function changeHeardAs(on) {
    heardAsTouchedRef.current = true;
    setHeardAsEnabledState(on);
    setHeardAsEnabled(on);
    saveHeardAsEnabled(db.settings, on);
  }

  // The load-time question. Continue confirms AND starts listening (one
  // tap per load, as Start Listening alone was before the question
  // existed); Escape only confirms.
  function confirmDirection(next, { start: startListening = true } = {}) {
    setDirection(next);
    setSavedDirection(next);
    setShowDirectionPrompt(false);
    saveTrainingDirection(db.settings, next);
    if (startListening && status === "idle") start();
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

  function dismissWelcome() {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Site data blocked — dismissal lasts for this page load only.
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

  // While the welcome, the direction question (also while the saved
  // answer is still loading) or Settings is open, everything behind it is
  // inert: no focus, no clicks — so the microphone can't be started and
  // Settings can't be opened behind the question.
  const blocked = showWelcome || showDirectionPrompt || showSettings;

  // h-dvh, not h-screen: on phones 100vh is the viewport with the URL bar
  // HIDDEN, so with it showing the bottom row (Stop Listening) sat below
  // the fold of a page that can't scroll. Every browser Tailwind 4
  // supports (Safari 16.4+, Chrome 111+, Firefox 128+) has dvh, so no
  // vh fallback is needed.
  return (
    <div className="h-dvh flex flex-col px-4 py-4 overflow-hidden">
      {/* Diagnostic overlay (only when ?diag=1) */}
      {DiagnosticOverlay && (
        <Suspense fallback={null}>
          <DiagnosticOverlay />
        </Suspense>
      )}

      {/* Welcome overlay (first visit only) */}
      {showWelcome && <WelcomeOverlay onDismiss={dismissWelcome} />}

      {/* Training-direction question (every load; after the welcome) */}
      {!showWelcome && showDirectionPrompt && directionLoaded && (
        <DirectionPrompt initial={savedDirection} onConfirm={confirmDirection} />
      )}

      {/* Settings overlay */}
      {showSettings && (
        <DataManagement
          onClose={() => setShowSettings(false)}
          direction={direction}
          onDirectionChange={changeDirection}
          heardAsEnabled={heardAsEnabled}
          onHeardAsChange={changeHeardAs}
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
            <nav className="flex-shrink-0 flex justify-center gap-1 mb-3">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={start}
                className="px-8 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-lg font-medium transition-colors cursor-pointer"
              >
                Start Listening
              </button>
            </div>
          </div>
        )}

        {status === "idle" && activeTab === "history" && (
          <div className="flex-1 flex flex-col w-full max-w-6xl min-h-0">
            <nav className="flex-shrink-0 flex justify-center gap-1 mb-3">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <SessionHistory />
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
                onClick={start}
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
            <nav className="flex-shrink-0 flex justify-center gap-1 mb-3">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Tab content. Scrolls below lg: on a phone the trace and the
                cue strip fit the first screen, the experimental panel and
                the session row may need a scroll (small phones, landscape).
                At lg the side-by-side layout fills the height. */}
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
                pitch={pitch}
                pitchLevel={pitchLevel}
                steadiness={steadiness}
                steadinessHeld={steadinessHeld}
                hnr={hnr}
                vocalWeight={vocalWeight}
                modelStatus={modelStatus}
                modelProgress={modelProgress}
                pitchTraceRef={pitchTraceRef}
                genderStateRef={genderStateRef}
                resonanceRef={resonanceRef}
                resonanceStatus={resonanceStatus}
                heardAsRef={heardAsRef}
                pitchOnlyRef={pitchOnlyRef}
                audioClockRef={audioClockRef}
                heardAsEnabled={heardAsEnabled}
                onHeardAsChange={changeHeardAs}
                direction={direction}
                sessionRef={sessionRef}
                frameCallbackRef={frameCallbackRef}
                streamRef={streamRef}
              />

              {activeTab === "pitch" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-[240px]">
                    <PitchTrace
                      pitchTraceRef={pitchTraceRef}
                      voiced={voiced}
                      holding={holding}
                      pitch={pitch}
                      pitchLevel={pitchLevel}
                      target={pitchTargetFor(direction)}
                      steadiness={steadiness}
                      steadinessHeld={steadinessHeld}
                    />
                  </div>
                </div>
              )}

              {activeTab === "history" && <SessionHistory />}

              {activeTab === "lab" && (
                <Suspense fallback={null}>
                  <LabView />
                </Suspense>
              )}
            </div>

            {/* Voice status + mic toggle (hidden on history tab) */}
            {activeTab !== "history" && (
              <div className="flex-shrink-0 mt-3 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      voiced
                        ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                        : holding
                          ? "bg-yellow-400/60"
                          : "bg-neutral-600"
                    }`}
                  />
                  <span className="text-[11px] text-neutral-500">
                    {voiced
                      ? "Voice detected"
                      : holding
                        ? "Listening..."
                        : "Waiting for voice..."}
                  </span>
                </div>

                <button
                  onClick={stop}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs transition-colors cursor-pointer"
                >
                  {/* Mic-off icon (inline SVG) */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M7.5 2a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 7.5 2z" opacity="0.5" />
                    <path fillRule="evenodd" d="M3.5 7.5a.5.5 0 0 1 .5.5 3.5 3.5 0 1 0 7 0 .5.5 0 0 1 1 0 4.5 4.5 0 0 1-4 4.473V14.5h2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1h2v-2.027A4.5 4.5 0 0 1 3 8a.5.5 0 0 1 .5-.5z" clipRule="evenodd" opacity="0.5" />
                    <path d="M1.646 1.646a.5.5 0 0 1 .708 0l12 12a.5.5 0 0 1-.708.708l-12-12a.5.5 0 0 1 0-.708z" />
                  </svg>
                  Stop Listening
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
