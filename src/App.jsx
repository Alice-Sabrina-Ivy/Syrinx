import { useAudioPipeline } from "./audio/useAudioPipeline";
import { PitchDisplay } from "./components/PitchDisplay";

function App() {
  const { status, error, voiced, pitch, intensity, start, stop } =
    useAudioPipeline();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Header */}
      <h1 className="text-4xl font-light text-white mb-2 tracking-tight">
        Syrinx
      </h1>
      <p className="text-neutral-500 text-sm mb-10">
        Voice training toolkit
      </p>

      {/* Main content area */}
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        {status === "idle" && (
          <button
            onClick={start}
            className="px-8 py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-lg font-medium transition-colors cursor-pointer"
          >
            Start Listening
          </button>
        )}

        {status === "requesting" && (
          <p className="text-neutral-400 animate-pulse">
            Requesting microphone access...
          </p>
        )}

        {status === "error" && (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={start}
              className="px-6 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {status === "running" && (
          <>
            <PitchDisplay
              voiced={voiced}
              pitch={pitch}
              intensity={intensity}
            />
            <button
              onClick={stop}
              className="mt-4 px-6 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm transition-colors cursor-pointer"
            >
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
