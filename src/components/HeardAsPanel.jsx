// HeardAsPanel.jsx — "Likely heard as · Experimental" (opt-in, OFF by
// default; the user chose to ship it as a clearly labelled experiment with
// its known weaknesses disclosed). Shows how listeners in published studies
// might hear the voice as three RANGES — would say man / might say neither
// or be unsure / would say woman, in "about A–B in 10" — never a single
// verdict, no percent signs, no colour per row. Each range is drawn as a
// bracket (end caps, a light band between them, a tick at the central
// estimate), never a bar filled from the left, and a row whose range spans
// 8 tenths or more is dimmed and says "can't tell" (2026-10-07 review: a
// full-width "0–10 in 10" bar read as "all listeners"). Updates every 2 s
// from the last ~8 s of running speech (src/ml/heard-as.js); hides with a
// reason otherwise — within 250 ms when a held note starts.
// Constants, errors and the evidence for every caveat sentence:
// measurements/heard-as-calibration-2026-10-07.md.
//
// The gender worker runs only while this is on (useAudioPipeline
// setHeardAsEnabled); off, nothing runs and nothing downloads.

import { useEffect, useRef, useState } from "react";
import { heardAsShares, formatShare, shareTenths, isWideShare, conflictNote } from "../ml/heard-as";
import { HEARD_AS_CALIBRATION } from "../ml/heardAsCalibration";

const STALE_DIM_MS = 2000;
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

// One row: a bracket from a/10 to b/10 on a 10-step track (end caps, a light
// band between them, a tick at the central estimate). Wide rows (≥ 8 tenths)
// are dimmed and worded "can't tell".
function ShareRow({ label, range, centre, kind }) {
  const [a, b] = shareTenths(range);
  const wide = isWideShare(range);
  const L = (a / 10) * 100, R = (b / 10) * 100;
  const c = Math.min(100, Math.max(0, centre * 100));
  return (
    <div className={`flex items-center gap-2 h-5 ${wide ? "opacity-60" : ""}`} data-share={kind} data-share-wide={wide ? "1" : "0"}>
      <span className="w-[6.4rem] shrink-0 text-[11px] text-neutral-400 whitespace-nowrap">{label}</span>
      <span className="relative flex-1 h-3" aria-hidden="true">
        <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-neutral-600" />
        {Array.from({ length: 11 }, (_, i) => (
          <span key={i} className="absolute top-1/2 w-px h-1.5 -translate-y-1/2 bg-neutral-700" style={{ left: `${i * 10}%` }} />
        ))}
        <span className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-neutral-400/25" style={{ left: `${L}%`, width: `${Math.max(0, R - L)}%` }} />
        <span className="absolute top-0 bottom-0 w-0.5 -ml-px bg-neutral-300" style={{ left: `${L}%` }} data-share-cap="lo" />
        <span className="absolute top-0 bottom-0 w-0.5 -ml-px bg-neutral-300" style={{ left: `${R}%` }} data-share-cap="hi" />
        <span className="absolute top-1/2 w-1.5 h-1.5 -ml-[3px] -translate-y-1/2 rounded-full bg-neutral-200" style={{ left: `${c}%` }} data-share-centre="" />
      </span>
      <span className="w-[6.6rem] shrink-0 text-right text-[11px] tabular-nums text-neutral-300 whitespace-nowrap" data-share-text="">
        {wide ? `can't tell (${a}–${b})` : formatShare(range)}
      </span>
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
  const shownRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const show = (v) => { shownRef.current = !v.hidden; setView(v); };
    const compute = () => {
      const st = statusRef.current;
      if (st === "error") { show({ hidden: "error" }); return; }
      if (st !== "ready") { show({ hidden: "loading" }); return; }
      const now = audioClockRef?.current;
      const voiceState = genderStateRef?.current?.state ?? null;
      const e = now == null ? { hidden: "listening" } : heardAsRef.current.estimate(now, voiceState);
      if (e.hidden) { show({ hidden: e.hidden }); return; }
      const shares = heardAsShares(e.meterLogit, e.lnF0);
      const r = resonanceRef?.current;
      const resonanceLive = r && r.u != null && (r.fill ?? 0) >= 1 && r.verdict !== "sustained";
      show({
        shares,
        ageMs: e.ageMs,
        conflict: resonanceLive ? conflictNote(e.lnF0, r.u) : null,
      });
    };
    compute();
    const id = setInterval(compute, HEARD_AS_CALIBRATION.updateMs);
    // Hide promptly (not on the 2 s cadence) when a held note starts, so the
    // panel never shows ranges while the strip already says "sustained".
    const fast = setInterval(() => {
      if (shownRef.current && genderStateRef?.current?.state === "sustained") compute();
    }, HIDE_CHECK_MS);
    return () => { clearInterval(id); clearInterval(fast); };
  }, [enabled, heardAsRef, audioClockRef, genderStateRef, resonanceRef]);

  // Loading progress is shown as it arrives (not on the 2 s cadence).
  const progress = modelProgress?.total ? Math.round((100 * modelProgress.loaded) / modelProgress.total) : 0;
  const reason = !enabled ? null
    : modelStatus === "error" ? "error"
      : modelStatus !== "ready" ? "loading"
        : view.hidden ?? null;

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

  const wideCount = view.shares ? ["man", "unsure", "woman"].filter((k) => isWideShare(view.shares[k])).length : 0;
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
        <div style={{ opacity: view.ageMs > STALE_DIM_MS ? 0.5 : 1 }} className="transition-opacity duration-300" data-heard-as-shares="">
          <ShareRow label="would say man" range={view.shares.man} centre={view.shares.centre.man} kind="man" />
          <ShareRow label="neither or unsure" range={view.shares.unsure} centre={view.shares.centre.unsure} kind="unsure" />
          <ShareRow label="would say woman" range={view.shares.woman} centre={view.shares.centre.woman} kind="woman" />
          {wideCount >= 2 && (
            <p className="mt-0.5 text-[11px] leading-snug text-neutral-400" data-heard-as-note="uncertain">
              Too uncertain to say much about this voice yet — the ranges cover most of the scale.
            </p>
          )}
          {view.conflict && (
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80" data-heard-as-note="conflict" data-conflict={view.conflict}>
              {CONFLICT_TEXT[view.conflict]} (Where resonance reads also depends on your microphone.)
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-neutral-400">From your last ~8 s of speech · updates every 2 s · bracket = range, dot = middle guess</p>
        </div>
      )}
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
          <li>Each range is where about 8 in 10 published listener groups fell for clearly feminine or clearly masculine voices; less is known for in-between voices. The middle row counts listeners who answered &ldquo;another gender&rdquo; as well as those who weren&apos;t sure, and depends on how listeners are asked.</li>
          <li>In background noise, low voices are recognised as speech less often, so it may stay hidden longer for them.</li>
          <li>Nothing is stored or sent anywhere; it is computed on this device and forgotten when you stop.</li>
        </ul>
      )}
    </section>
  );
}
