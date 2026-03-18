import { useState } from "react";
import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchTrace } from "./components/PitchTrace";
import { VowelSpacePlot } from "./components/VowelSpacePlot";
import { CombinedDashboard } from "./components/CombinedDashboard";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pitch", label: "Pitch" },
  { id: "resonance", label: "Resonance" },
];

function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const {
    status,
    error,
    voiced,
    holding,
    pitch,
    intensity,
    noteName,
    formants,
    spectralTilt,
    hnr,
    start,
    stop,
    pitchTraceRef,
    formantTrailRef,
  } = useAudioPipeline();

  return (
    <div className="h-screen flex flex-col px-4 py-4 overflow-hidden">
      {/* Header */}
      <header className="text-center mb-2 flex-shrink-0">
        <h1 className="text-2xl font-light text-white tracking-tight">
          Syrinx
        </h1>
        <p className="text-neutral-500 text-xs mt-0.5">
          Voice training toolkit
        </p>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center min-h-0">
        {status === "idle" && (
          <div className="flex-1 flex items-center">
            <button
              onClick={start}
              className="px-8 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-lg font-medium transition-colors cursor-pointer"
            >
              Start Listening
            </button>
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
                  intensity={intensity}
                  noteName={noteName}
                  formants={formants}
                  spectralTilt={spectralTilt}
                  hnr={hnr}
                  pitchTraceRef={pitchTraceRef}
                  formantTrailRef={formantTrailRef}
                  start={start}
                  stop={stop}
                  status={status}
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

              {activeTab === "resonance" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-[240px]">
                    <VowelSpacePlot
                      formantTrailRef={formantTrailRef}
                      voiced={voiced}
                      holding={holding}
                      formants={formants}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Voice status + stop button (shown on all tabs) */}
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
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs transition-colors cursor-pointer"
              >
                Stop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
