import { hzToNote } from "../utils/pitchUtils";

export function PitchDisplay({ voiced, pitch, intensity }) {
  const noteInfo = pitch ? hzToNote(pitch) : null;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Main pitch readout */}
      <div className="text-center">
        {voiced && pitch ? (
          <>
            <div className="text-7xl font-light tabular-nums tracking-tight text-white">
              {Math.round(pitch)}
              <span className="text-3xl text-neutral-400 ml-2">Hz</span>
            </div>
            {noteInfo && (
              <div className="mt-2 text-2xl text-purple-400 font-medium">
                {noteInfo.name}
                <span className="text-sm text-neutral-500 ml-2">
                  {noteInfo.cents >= 0 ? "+" : ""}
                  {noteInfo.cents}¢
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="text-5xl font-light text-neutral-600">
            — Hz
          </div>
        )}
      </div>

      {/* Voice status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-3 h-3 rounded-full ${
            voiced ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]" : "bg-neutral-600"
          }`}
        />
        <span className="text-sm text-neutral-400">
          {voiced ? "Voice detected" : "Listening..."}
        </span>
      </div>

      {/* Intensity meter */}
      {intensity !== null && intensity > -Infinity && (
        <div className="w-48">
          <div className="flex justify-between text-xs text-neutral-500 mb-1">
            <span>Level</span>
            <span>{Math.round(intensity)} dB</span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75 bg-purple-500"
              style={{
                // Map roughly -60dB..0dB to 0..100%
                width: `${Math.max(0, Math.min(100, ((intensity + 60) / 60) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
