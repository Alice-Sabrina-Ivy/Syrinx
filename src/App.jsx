import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchTrace } from "./components/PitchTrace";
import { VowelSpacePlot } from "./components/VowelSpacePlot";

function App() {
  const {
    status,
    error,
    voiced,
    holding,
    pitch,
    intensity,
    formants,
    start,
    stop,
    pitchTraceRef,
    formantTrailRef,
  } = useAudioPipeline();

  return (
    <div className="h-screen flex flex-col px-4 py-6 overflow-hidden">
      {/* Header */}
      <header className="text-center mb-4 flex-shrink-0">
        <h1 className="text-3xl font-light text-white tracking-tight">
          Syrinx
        </h1>
        <p className="text-neutral-500 text-xs mt-1">
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
            {/* Visualizations: side-by-side on desktop, stacked on mobile */}
            <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
              {/* Pitch trace */}
              <div className="flex-1 min-h-[240px] lg:min-h-0">
                <PitchTrace
                  pitchTraceRef={pitchTraceRef}
                  voiced={voiced}
                  holding={holding}
                  pitch={pitch}
                />
              </div>

              {/* Vowel space plot */}
              <div className="flex-1 min-h-[240px] lg:min-h-0">
                <VowelSpacePlot
                  formantTrailRef={formantTrailRef}
                  voiced={voiced}
                  holding={holding}
                  formants={formants}
                />
              </div>
            </div>

            {/* Voice status + controls */}
            <div className="flex-shrink-0 mt-4 flex flex-col items-center gap-3">
              {/* Status indicator */}
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    voiced
                      ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
                      : holding
                        ? "bg-yellow-400/60"
                        : "bg-neutral-600"
                  }`}
                />
                <span className="text-xs text-neutral-400">
                  {voiced
                    ? "Voice detected"
                    : holding
                      ? "Listening..."
                      : "Waiting for voice..."}
                </span>

                {/* Intensity meter (compact) */}
                {intensity !== null && intensity > -Infinity && (
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-neutral-500">
                      {Math.round(intensity)} dB
                    </span>
                    <div className="w-16 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-75 bg-purple-500/70"
                        style={{
                          width: `${Math.max(0, Math.min(100, ((intensity + 60) / 60) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={stop}
                className="px-6 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm transition-colors cursor-pointer"
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
