// HeardAsPanel.jsx — "Likely heard as · Experimental" (opt-in, OFF by
// default; the user chose to ship it as a clearly labelled experiment with
// its known weaknesses disclosed). Shows how listeners in published studies
// might hear the voice on ONE horizontal axis, "would say man" (left, the
// cue strip's orientation) <-> "would say woman" (right), ticks in tenths:
// the two-way estimate as a small hollow ring (single best guess) inside a
// shaded ~80 % range, the range in words ("about A–B in 10 would say man ·
// about C–D in 10 would say woman") and the unsure / neither share as one
// text line — never a single verdict, no percent signs, the same words and
// colours in every direction (user decision 2026-10-07; it replaced three
// bracket rows). When the range spans 8 tenths or more the band is dashed,
// the ring and the unsure line dropped and it says "Can't tell yet". An
// estimate older than 2 s says "Older reading" in its legend line (nothing is
// dimmed: dimming took text and the band outline below WCAG contrast).
// Layout numbers and words:
// heardAsAxisModel.js (unit-tested). Updates every 2 s from the last ~8 s of
// running speech (src/ml/heard-as.js); hides with a reason otherwise —
// within 250 ms when a held note starts.
// Constants, errors and the evidence for every caveat sentence:
// measurements/heard-as-calibration-2026-10-07.md.
//
// Notes, shown only while the estimate is, and AT MOST ONE at a time
// (review round 2): the pitch-only-change warning
// (src/ml/pitch-only-warning.js, updated here on the panel's cadence from
// `pitchOnlyRef`; [data-heard-as-note="pitch-only"], data-pitch-only="1")
// sits directly under the axis, so it stays on the first screen wherever the
// axis does; while it is on, the pitch–resonance conflict note and the
// `extraNote` prop (rendered as given otherwise, below the range lines) are
// left out. The warning compares with this session's start — same words in
// every direction. Screen readers hear it through a live region that stays
// mounted while the panel is on ([data-heard-as-live]; a region mounted
// together with its text is often not announced), kept through brief hides.
// measurements/heard-as-pitch-only-warning-2026-10-07.md,
// measurements/heard-as-panel-review-2-2026-10-07.md
//
// The gender worker runs only while this is on (useAudioPipeline
// setHeardAsEnabled); off, nothing runs and nothing downloads.

import { useEffect, useRef, useState } from "react";
import { heardAsShares, conflictNote } from "../ml/heard-as";
import { heardAsAxis, AXIS_ENDS } from "./heardAsAxisModel";
import { HEARD_AS_CALIBRATION } from "../ml/heardAsCalibration";
import { PITCH_ONLY_TEXT } from "../ml/pitch-only-warning";

const STALE_MS = 2000;
const HIDE_CHECK_MS = 250;
export const MODEL_DOWNLOAD_MB = 16;

export const HEARD_AS_CAVEAT =
  "Experimental guess at how listeners in published studies might hear you — not a verdict. " +
  "Fitted on trans and cis men's voices, women's voices and computer-altered voices; not tested on trans " +
  "women or nonbinary speakers. It follows pitch more than listeners do: change your pitch without changing " +
  "resonance and it shows a bigger change than listeners would hear — sometimes by more than half of " +
  "them — in either direction. Listener groups disagree a lot. Adults' speaking voice only.";

const REASONS = {
  loading: (p) => `Loading voice model… ${p} %`,
  error: () => "Unavailable — the voice model didn't load",
  listening: () => "Waiting for running speech",
  sustained: () => "Needs running speech — held vowels and notes don't count",
  short: () => "Keep talking — needs a few seconds of running speech",
  stale: () => "Waiting for running speech",
  outside: () => "Outside the range it was tested on — no guess shown",
};

const CONFLICT_TEXT = {
  opposite: "Pitch and resonance point different ways — listeners split most here, and this guess (which leans on pitch) is least reliable now.",
  apart: "Pitch and resonance read at quite different places — this guess leans on pitch more than listeners do.",
};

export function HeardAsSwitch({ on, onChange, label = "Likely heard as · Experimental" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-5 shrink-0 rounded-full transition-colors cursor-pointer before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] ${on ? "bg-purple-600" : "bg-neutral-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

// The man <-> woman axis: a line with ticks in tenths (the middle one
// taller), the shaded range (rounded outward to tenths, outlined; dashed when
// it is "can't tell yet"), the best-guess ring (small and hollow, so the
// range reads first), end words below the ends. Purely visual (role img with
// the full sentence as its label); the visible text lines follow it.
function HeardAsAxis({ axis }) {
  const L = axis.lo * 100, R = axis.hi * 100, D = axis.dot * 100;
  return (
    <div data-heard-as-axis="" data-axis-wide={axis.wide ? "1" : "0"} data-axis-dot={axis.dot.toFixed(3)}
      data-axis-lo={axis.lo.toFixed(1)} data-axis-hi={axis.hi.toFixed(1)}>
      <div className="relative h-5 mx-1.5" role="img" aria-label={axis.srText}>
        <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-neutral-500" />
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className={`absolute top-1/2 w-px -translate-y-1/2 bg-neutral-500 ${i === 5 ? "h-3.5" : "h-2"}`}
            style={{ left: `${i * 10}%` }} />
        ))}
        <span
          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border border-neutral-400 transition-[left,width] duration-300 ${axis.wide ? "border-dashed bg-neutral-400/15" : "bg-neutral-400/30"}`}
          style={{ left: `${L}%`, width: `${Math.max(0, R - L)}%` }}
          data-axis-range=""
        />
        {!axis.wide && (
          <span
            className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -translate-y-1/2 rounded-full border-2 border-neutral-200 transition-[left] duration-300"
            style={{ left: `${D}%` }}
            data-axis-dot-mark=""
          />
        )}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-neutral-400 leading-4" aria-hidden="true" data-axis-ends="">
        <span className="whitespace-nowrap">{AXIS_ENDS.left}</span>
        <span className="whitespace-nowrap text-right">{AXIS_ENDS.right}</span>
      </div>
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
  pitchOnlyRef = null,
  extraNote = null,
}) {
  const [view, setView] = useState({ hidden: "listening" });
  const [more, setMore] = useState(false);
  const statusRef = useRef(modelStatus);
  useEffect(() => { statusRef.current = modelStatus; });
  const shownRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const show = (v) => { shownRef.current = !v.hidden; setView(v); };
    // Every update — hidden ones too — goes to the pitch-only warning: a
    // hidden-panel update (lnF0 null) shows nothing but keeps its run through
    // a brief hide (src/ml/pitch-only-warning.js). (The hook's warning object
    // lives for the whole page; captured for the cleanup.)
    const warning = pitchOnlyRef?.current ?? null;
    const warn = (lnF0) => warning?.update({ lnF0, resonance: resonanceRef?.current ?? null }) === true;
    const hide = (why) => { warn(null); show({ hidden: why, live: warning?.held() === true }); };
    const compute = () => {
      const st = statusRef.current;
      if (st === "error") { hide("error"); return; }
      if (st !== "ready") { hide("loading"); return; }
      const now = audioClockRef?.current;
      const voiceState = genderStateRef?.current?.state ?? null;
      const e = now == null ? { hidden: "listening" } : heardAsRef.current.estimate(now, voiceState);
      if (e.hidden) { hide(e.hidden); return; }
      const shares = heardAsShares(e.meterLogit, e.lnF0);
      const r = resonanceRef?.current;
      const resonanceLive = r && r.u != null && (r.fill ?? 0) >= 1 && r.verdict !== "sustained";
      const pitchOnly = warn(e.lnF0);
      show({
        axis: heardAsAxis(shares),
        ageMs: e.ageMs,
        conflict: resonanceLive ? conflictNote(e.lnF0, r.u) : null,
        pitchOnly,
        live: pitchOnly,
      });
    };
    compute();
    const id = setInterval(compute, HEARD_AS_CALIBRATION.updateMs);
    // Hide promptly (not on the 2 s cadence) when a held note starts, so the
    // panel never shows ranges while the strip already says "sustained".
    const fast = setInterval(() => {
      if (shownRef.current && genderStateRef?.current?.state === "sustained") compute();
    }, HIDE_CHECK_MS);
    return () => {
      clearInterval(id); clearInterval(fast);
      // Switched off (or remounted): a later switch-on starts a fresh run.
      warning?.resetRun();
    };
  }, [enabled, heardAsRef, audioClockRef, genderStateRef, resonanceRef, pitchOnlyRef]);

  // Loading progress is shown as it arrives (not on the 2 s cadence).
  const progress = modelProgress?.total ? Math.round((100 * modelProgress.loaded) / modelProgress.total) : 0;
  const reason = !enabled ? null
    : modelStatus === "error" ? "error"
      : modelStatus !== "ready" ? "loading"
        : view.hidden ?? null;
  const stale = !reason && view.ageMs > STALE_MS;
  // The live region keeps the warning through a brief hide (the module holds
  // its run), so screen readers are not re-told after every "Keep talking".
  const liveOn = view.live === true;

  if (!enabled) {
    return (
      <div className="w-full flex items-center justify-between gap-2 min-h-8 px-3 rounded-xl border border-neutral-800 bg-neutral-900/40"
        data-heard-as="off" data-model-worker="off">
        <span className="text-[11px] text-neutral-400 truncate">Likely heard as · Experimental — off</span>
        <button type="button" onClick={() => onToggle(true)}
          aria-label={`Turn on — downloads a ${MODEL_DOWNLOAD_MB} MB voice model the first time`}
          className="shrink-0 text-[11px] min-h-6 px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer transition-colors">
          Turn on · {MODEL_DOWNLOAD_MB} MB
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
        <p className="text-[11px] text-neutral-400 min-h-[18px] leading-[18px]" data-heard-as-reason="">{REASONS[reason](progress)}</p>
      ) : (
        <div data-heard-as-shares="" data-stale={stale ? "1" : "0"}>
          <HeardAsAxis axis={view.axis} />
          {view.pitchOnly && (
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="pitch-only" data-pitch-only="1">
              {PITCH_ONLY_TEXT}
            </p>
          )}
          <p className={`mt-1 text-[11px] leading-snug tabular-nums ${view.axis.wide ? "text-neutral-400 italic" : "text-neutral-300"}`}
            data-heard-as-range="" data-wide={view.axis.wide ? "1" : "0"}>
            {view.axis.rangeText}
          </p>
          {view.axis.unsureText && (
            <p className="text-[11px] leading-snug tabular-nums text-neutral-400" data-heard-as-unsure="">{view.axis.unsureText}</p>
          )}
          {!view.pitchOnly && view.conflict && (
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="conflict" data-conflict={view.conflict}>
              {CONFLICT_TEXT[view.conflict]} (Where resonance reads also depends on your microphone.)
            </p>
          )}
          {!view.pitchOnly && extraNote != null && extraNote !== false && (
            <div className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="extra">{extraNote}</div>
          )}
          <p className="mt-0.5 text-[11px] text-neutral-400" data-heard-as-legend="">
            {stale ? "Older reading — waiting for more speech · " : ""}From your last ~8 s of speech · updates every 2 s · shaded = likely range{view.axis.wide ? "" : ", ring = single best guess"}
          </p>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-heard-as-live="">
        {liveOn ? PITCH_ONLY_TEXT : ""}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-400" data-heard-as-caveat="">
        {HEARD_AS_CAVEAT}{" "}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className="relative text-neutral-300 underline underline-offset-2 hover:text-neutral-100 cursor-pointer before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-['']">
          {more ? "Less" : "More"}
        </button>
      </p>
      {more && (
        <ul className="mt-1 text-[11px] leading-snug text-neutral-400 list-disc pl-4 space-y-0.5" data-heard-as-more="">
          <li>Typical voices are shown further from the ends than listeners put them: clearly feminine and clearly masculine voices look less clear-cut here than they are.</li>
          <li>Within clearly feminine or clearly masculine voices it does not track small changes — use the cue strip for those.</li>
          <li>It uses only your pitch and a voice classifier; it ignores intonation, vocal weight and articulation.</li>
          <li>Singing, children&apos;s voices, held vowels and single words are not supported. Held notes and very high or low voices hide it; singing and children are not detected — don&apos;t use it for them.</li>
          <li>The shaded range is where about 8 in 10 published listener groups fell for clearly feminine or clearly masculine voices; less is known for in-between voices. The scale is listeners choosing between man and woman: those who might be unsure or say neither are counted half on each side. The &ldquo;unsure or neither&rdquo; line counts listeners who answered &ldquo;another gender&rdquo; as well as those who weren&apos;t sure, and depends on how listeners are asked.</li>
          <li>In background noise, low voices are recognised as speech less often, so it may stay hidden longer for them.</li>
          <li>Nothing is stored or sent anywhere; it is computed on this device and forgotten when you stop.</li>
        </ul>
      )}
    </section>
  );
}
