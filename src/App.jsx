import { useState, useEffect, useRef } from "react";
import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchTrace } from "./components/PitchTrace";
import { CombinedDashboard } from "./components/CombinedDashboard";
import { SessionHistory } from "./components/SessionHistory";
import { DataManagement } from "./components/DataManagement";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pitch", label: "Pitch" },
  { id: "history", label: "History" },
];

const WELCOME_KEY = "syrinx_welcomed";

function WelcomeOverlay({ onDismiss }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full text-center shadow-xl">
        <h2 className="text-xl font-light text-white mb-3">Welcome to Syrinx</h2>
        <p className="text-sm text-neutral-300 leading-relaxed mb-5">
          Syrinx gives you real-time visual feedback on your voice pitch, resonance, and
          vocal weight — it needs microphone access to work.{" "}
          The green target zones show the ranges you're aiming for.
        </p>
        <button
          onClick={onDismiss}
          className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors cursor-pointer"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showWelcome, setShowWelcome] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Ref for session metadata (notes, elapsed, recording state) —
  // kept in sync by CombinedDashboard, readable by a future save/export feature.
  const sessionRef = useRef({ recording: false, elapsed: 0, notes: "" });
  const {
    status,
    error,
    voiced,
    holding,
    pitch,
    formants,
    spectralTilt,
    hnr,
    start,
    stop,
    pitchTraceRef,
    formantTrailRef,
    frameCallbackRef,
    streamRef,
  } = useAudioPipeline();

  // Check first visit
  useEffect(() => {
    if (!localStorage.getItem(WELCOME_KEY)) {
      setShowWelcome(true);
    }
  }, []);

  function dismissWelcome() {
    localStorage.setItem(WELCOME_KEY, "1");
    setShowWelcome(false);
    start();
  }

  return (
    <div className="h-screen flex flex-col px-4 py-4 overflow-hidden">
      {/* Welcome overlay (first visit only) */}
      {showWelcome && <WelcomeOverlay onDismiss={dismissWelcome} />}

      {/* Settings overlay */}
      {showSettings && <DataManagement onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <header className="text-center mb-2 flex-shrink-0 relative">
        <h1 className="text-2xl font-light text-white tracking-tight">
          Syrinx
        </h1>
        <p className="text-neutral-500 text-xs mt-0.5">
          Voice training toolkit
        </p>
        {/* Gear icon */}
        <button
          onClick={() => setShowSettings(true)}
          className="absolute right-0 top-1 text-neutral-600 hover:text-neutral-400 transition-colors cursor-pointer"
          title="Settings & Data"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.08l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.524ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center min-h-0">
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

            {/* Tab content */}
            <div className="flex-1 flex flex-col min-h-0">
              {activeTab === "dashboard" && (
                <CombinedDashboard
                  voiced={voiced}
                  holding={holding}
                  pitch={pitch}
                  formants={formants}
                  spectralTilt={spectralTilt}
                  hnr={hnr}
                  pitchTraceRef={pitchTraceRef}
                  formantTrailRef={formantTrailRef}
                  sessionRef={sessionRef}
                  frameCallbackRef={frameCallbackRef}
                  streamRef={streamRef}
                />
              )}

              {activeTab === "pitch" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-[240px]">
                    <PitchTrace
                      pitchTraceRef={pitchTraceRef}
                      voiced={voiced}
                      holding={holding}
                      pitch={pitch}
                    />
                  </div>
                </div>
              )}

              {activeTab === "history" && <SessionHistory />}
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
