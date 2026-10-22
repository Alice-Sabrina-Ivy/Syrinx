// VoiceShaperView.jsx — the "Voice Shaper" tab (experimental; its own top-level tab since
// 2026-10-20, between History and Resonance lab — before that the Resonance lab's third
// view, "Voice preview"; the files keep that name). App.jsx loads this module lazily when
// the tab is first opened (with its error boundary and loading line), so nothing of Voice
// Shaper is fetched before then; it carries the card (VoicePreviewCard.jsx) in the same
// chunk, and the card's module starts the worker. Opening the tab does not start the
// Resonance lab. measurements/voice-preview-phase1-2026-10-19.md, "Renamed and moved
// 2026-10-20".
//
// The tab's own scroll area (the app's content area does not scroll at lg); on phones
// (the lab's phone query: below 40rem wide, or shorter than 30rem) the card uses its
// compact padding and does not focus a prefilled target field (no keyboard pop-up).

import { useSyncExternalStore } from "react";
import VoicePreviewCard from "./VoicePreviewCard.jsx";

const PHONE_QUERY = "(width < 40rem), (height < 30rem)";
const subscribePhone = (cb) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

export default function VoiceShaperView({ direction = null, isSessionRecording }) {
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  return (
    <div data-voice-shaper="" className="flex-1 min-h-0 overflow-y-auto w-full max-w-3xl mx-auto pb-2 sm:px-1 sm:pb-6">
      <VoicePreviewCard direction={direction} isSessionRecording={isSessionRecording} phone={phone} />
    </div>
  );
}
