// HeardAsPanel.jsx — "Likely heard as · Experimental" (opt-in, OFF by
// default; the user chose to ship it as a clearly labelled experiment with
// its known weaknesses disclosed). Shows how listeners in published studies
// might hear the voice as three RANGES — would say man / might be unsure /
// would say woman, in "about A–B in 10" — never a single verdict, no
// percent signs, no colour per row. Updates every 2 s from the last ~8 s of
// running speech (src/ml/heard-as.js); hides with a reason otherwise.
// Constants, errors and the evidence for every caveat sentence:
// measurements/heard-as-calibration-2026-10-07.md.
//
// The gender worker runs only while this is on (useAudioPipeline
// setHeardAsEnabled); off, nothing runs and nothing downloads.

import { useEffect, useRef, useState } from "react";
import { heardAsShares, formatShare, shareTenths, conflictNote, outsideTestedRange } from "../ml/heard-as";
import { HEARD_AS_CALIBRATION } from "../ml/heardAsCalibration";

const STALE_DIM_MS = 2000;

export const HEARD_AS_CAVEAT =
  "Experimental guess at how listeners in published studies might hear you — not a verdict. " +
  "Tested mostly on masculine-presenting and computer-altered voices, not on trans or nonbinary speakers. " +
  "It follows pitch more than listeners do: change pitch without resonance and it shows more movement than " +
  "listeners would hear, in either direction. Listener groups disagree a lot. Adults' speaking voice only.";

const REASONS = {
  loading: (p) => `Loading voice model… ${p} %`,
  error: () => "Unavailable — the voice model didn't load",
  listening: () => "Waiting for running speech",
  sustained: () => "Needs running speech — held vowels and notes don't count",
  short: () => "Keep talking — needs a few seconds of running speech",
  stale: () => "Waiting for running speech",
};

export function HeardAsSwitch({ on, onChange, label = "Likely heard as · Experimental" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-5 shrink-0 rounded-full transition-colors cursor-pointer ${on ? "bg-purple-600" : "bg-neutral-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function ShareRow({ label, range, kind }) {
  const [a, b] = shareTenths(range);
  const left = (a / 10) * 100, width = Math.max(3, ((b - a) / 10) * 100);
  return (
    <div className="flex items-center gap-2 h-[18px]" data-share={kind}>
      <span className="w-[6.6rem] shrink-0 text-[11px] text-neutral-400 whitespace-nowrap">{label}</span>
      <span className="relative flex-1 h-2 rounded-full bg-neutral-800 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="absolute top-0 bottom-0 w-px bg-neutral-900/80" style={{ left: `${(i + 1) * 10}%` }} />
        ))}
        <span className="absolute top-0 bottom-0 rounded-full bg-neutral-300/60" style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }} />
      </span>
      <span className="w-[6.8rem] shrink-0 text-right text-[11px] tabular-nums text-neutral-300 whitespace-nowrap" data-share-text="">{formatShare(range)}</span>
    </div>
  );
}

export function HeardAsPanel({
  enabled,
  onToggle,
  modelStatus,
  modelProgress,
  heardAsRef,
  audioClockRef,
  genderStateRef,
  resonanceRef,
}) {
  const [view, setView] = useState({ hidden: "listening" });
  const [more, setMore] = useState(false);
  const statusRef = useRef(modelStatus);
  useEffect(() => { statusRef.current = modelStatus; });

  useEffect(() => {
    if (!enabled) return undefined;
    const compute = () => {
      const st = statusRef.current;
      if (st === "error") { setView({ hidden: "error" }); return; }
      if (st !== "ready") { setView({ hidden: "loading" }); return; }
      const now = audioClockRef?.current;
      const voiceState = genderStateRef?.current?.state ?? null;
      const e = now == null ? { hidden: "listening" } : heardAsRef.current.estimate(now, voiceState);
      if (e.hidden) { setView({ hidden: e.hidden }); return; }
      const shares = heardAsShares(e.meterLogit, e.lnF0);
      const r = resonanceRef?.current;
      const resonanceLive = r && r.u != null && (r.fill ?? 0) >= 1 && r.verdict !== "sustained";
      setView({
        shares,
        ageMs: e.ageMs,
        conflict: resonanceLive ? conflictNote(e.lnF0, r.u) : false,
        outside: outsideTestedRange(e.meterLogit, e.lnF0),
      });
    };
    compute();
    const id = setInterval(compute, HEARD_AS_CALIBRATION.updateMs);
    return () => clearInterval(id);
  }, [enabled, heardAsRef, audioClockRef, genderStateRef, resonanceRef]);

  // Loading progress is shown as it arrives (not on the 2 s cadence).
  const progress = modelProgress?.total ? Math.round((100 * modelProgress.loaded) / modelProgress.total) : 0;
  const reason = !enabled ? null
    : modelStatus === "error" ? "error"
      : modelStatus !== "ready" ? "loading"
        : view.hidden ?? null;

  if (!enabled) {
    return (
      <div className="w-full flex items-center justify-between gap-2 h-8 px-3 rounded-xl border border-neutral-800 bg-neutral-900/40"
        data-heard-as="off" data-model-worker="off">
        <span className="text-[11px] text-neutral-500 truncate">Likely heard as · Experimental — off</span>
        <button type="button" onClick={() => onToggle(true)}
          className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer transition-colors">
          Turn on
        </button>
      </div>
    );
  }

  return (
    <section
      className="w-full rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2"
      data-heard-as={reason ? "hidden" : "shown"}
      data-reason={reason ?? ""}
      data-model-worker={modelStatus === "idle" ? "starting" : modelStatus}
      aria-label="Likely heard as (experimental)"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-[11px] font-medium text-neutral-300">
          Likely heard as <span className="text-amber-300/80">· Experimental</span>
        </h3>
        <HeardAsSwitch on onChange={onToggle} />
      </div>
      {reason ? (
        <p className="text-[11px] text-neutral-500 h-[18px] leading-[18px]" data-heard-as-reason="">{REASONS[reason](progress)}</p>
      ) : (
        <div style={{ opacity: view.ageMs > STALE_DIM_MS ? 0.5 : 1 }} className="transition-opacity duration-300" data-heard-as-shares="">
          <ShareRow label="would say man" range={view.shares.man} kind="man" />
          <ShareRow label="might be unsure" range={view.shares.unsure} kind="unsure" />
          <ShareRow label="would say woman" range={view.shares.woman} kind="woman" />
          {view.conflict && (
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="conflict">
              Pitch and resonance point different ways — listeners split most here, and this guess is least reliable now.
            </p>
          )}
          {view.outside && (
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="range">Outside the range it was tested on.</p>
          )}
          <p className="mt-0.5 text-[11px] text-neutral-500">From your last ~8 s of speech · updates every 2 s</p>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-snug text-neutral-500" data-heard-as-caveat="">
        {HEARD_AS_CAVEAT}{" "}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200 cursor-pointer">
          {more ? "Less" : "More"}
        </button>
      </p>
      {more && (
        <ul className="mt-1 text-[11px] leading-snug text-neutral-500 list-disc pl-4 space-y-0.5" data-heard-as-more="">
          <li>Typical voices are shown further from the ends than listeners put them: clearly feminine and clearly masculine voices look less clear-cut here than they are.</li>
          <li>It uses only your pitch and a voice classifier; it ignores intonation, vocal weight and articulation.</li>
          <li>Singing, children&apos;s voices, held vowels and single words are not supported (singing and children are not detected — don&apos;t use it for them).</li>
          <li>Each range is where about 8 in 10 published listener groups fell; how many say &ldquo;unsure&rdquo; depends on how listeners are asked.</li>
          <li>Nothing is stored or sent anywhere; it is computed on this device and forgotten when you stop.</li>
        </ul>
      )}
    </section>
  );
}
