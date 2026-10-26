// WeightClarityView.jsx — experimental "weight × clarity" view of the resonance lab
// (lab tab only; never on the Dashboard, the cue strip, coaching or stats).
//
// A 2-D dot against the user's OWN voice map: x = lighter ↔ heavier than your
// usual at this pitch and loudness, y = breathier ↔ clearer than your usual
// there, in units of your own 1-s variation. Neutral colours, no zones, no
// targets — the same view for every training direction. Opening the view is
// what starts its analysis (labPipeline.enableWeight). Spec, sceptic numbers
// and licences: measurements/weight-lab-prototype-2026-10-08.md (§8: the
// 2026-10-11 review fixes — measured caveats, the ±2 noise box, the loudness
// check, the short-landscape layout).

import { useEffect, useSyncExternalStore } from "react";
import { enableWeight, weightCommand } from "./labPipeline.js";
import { NOISE_BOX, LOUDNESS_MIN_DB } from "./weight-map.js";

const RANGE = 4; // units shown either side of "your usual"

// Phones held sideways (and other short, wide screens): plot beside the text.
const SHORT_LANDSCAPE = "(height < 30rem) and (width >= 40rem)";
const subscribeShort = (cb) => {
  const mq = window.matchMedia(SHORT_LANDSCAPE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isShort = () => window.matchMedia(SHORT_LANDSCAPE).matches;
// Phones: the plot gives up height (never text size) so that it and its bottom
// axis word end above the practice dock on short screens (360x690: 220 -> 194 px).
const subscribeHeight = (cb) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewHeight = () => window.innerHeight;
const phonePlotSize = (h) => Math.max(160, Math.min(220, h - 496));

// Every number here is measured (AVID test speakers, Hillenbrand vowels, the
// clarity study) — measurements/weight-lab-prototype-2026-10-08.md §2 and §8.
const CAVEATS = [
  ["Loudness", "It compares you only with your own map at the same loudness (4 dB bands). Loudness is still the biggest influence on this reading: louder reads heavier."],
  ["Pitch", "Higher pitch reads lighter (in tests, an octave moved it about 1.3–1.5 times a light/heavy demonstration step), which is why it compares only within 2-semitone bands."],
  ["Vowels", "Vowels move the reading a lot (about 8 units between vowels in tests). Compare with the same sentences you mapped with; held vowels are not read."],
  ["One microphone, one visit", "A different microphone, or automatic gain control, breaks the comparison. The map lasts until you close the page."],
  ["Gain control", "The browser can only report its own gain control; your system or headset may still compress loudness. If your softer and louder mapping came out less than " + LOUDNESS_MIN_DB + " dB apart, readings stay off."],
  ["Resonance", "Brighter resonance can read heavier, so the reading pauses while your resonance reading has moved."],
  ["Agreement", "On voice teachers' demonstration recordings, at matched loudness, it matched the intended light/heavy change about as often as chance."],
  ["Women and men", "In tests it did not follow vocal-fold contact any better than a plain loudness meter (women +0.13 vs +0.11; men −0.04)."],
  ["Phone and laptop mics", "Microphones that cut low frequencies shift the weight reading with pitch, more for lower voices."],
  ["Clarity axis", "Louder reads clearer (in tests, at fixed vocal-fold contact: partial r +0.33 women, +0.32 men). Every similar clarity measure we tested also moved with the vowel by about as much as a clear → breathy change (men 2–4×), so what you say moves this axis. The clarity reading has not passed the clarity study's bar."],
  ["Noise", `The dashed box (±${NOISE_BOX}) is typical chance spread: in tests about 1 reading in 30 landed outside it with no real change (±1 would be left 1 time in 3). A real room and other text are noisier.`],
];

const fmt = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`);
const clamp = (v) => Math.max(-RANGE, Math.min(RANGE, v));

function DotPlot({ snap, size }) {
  const S = 100;
  const px = (u) => ((clamp(u) + RANGE) / (2 * RANGE)) * S;
  const py = (u) => S - ((clamp(u) + RANGE) / (2 * RANGE)) * S;
  const r = snap?.reading;
  const trail = snap?.trail ?? [];
  const band = [px(-NOISE_BOX), py(NOISE_BOX), px(NOISE_BOX) - px(-NOISE_BOX), py(-NOISE_BOX) - py(NOISE_BOX)];
  return (
    <svg viewBox={`-2 -2 ${S + 4} ${S + 4}`} width={size} height={size} className="block shrink-0" data-weight-plot="" role="img"
      aria-label={r ? `Light to heavy sound ${fmt(r.rw)}, breathy to clear ${fmt(r.rc)}, in units of your own variation from your usual` : "No reading"}>
      <rect x="0" y="0" width={S} height={S} className="fill-neutral-900 stroke-neutral-700" strokeWidth="0.4" />
      {[-3, -1, 1, 3].map((g) => (
        <g key={g}>
          <line x1={px(g)} x2={px(g)} y1="0" y2={S} className="stroke-neutral-800" strokeWidth="0.3" />
          <line x1="0" x2={S} y1={py(g)} y2={py(g)} className="stroke-neutral-800" strokeWidth="0.3" />
        </g>
      ))}
      <rect x={band[0]} y={band[1]} width={band[2]} height={band[3]} className="fill-neutral-500/15 stroke-neutral-500/60" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
      <line x1={px(0)} x2={px(0)} y1="0" y2={S} className="stroke-neutral-600" strokeWidth="0.4" />
      <line x1="0" x2={S} y1={py(0)} y2={py(0)} className="stroke-neutral-600" strokeWidth="0.4" />
      {trail.filter((p) => p.age > 0 && p.age < 10).map((p, i) => (
        <circle key={i} cx={px(p.rw)} cy={py(p.rc)} r="1.6" className="fill-neutral-400" opacity={0.6 * (1 - p.age / 10)} />
      ))}
      {r && <circle cx={px(r.rw)} cy={py(r.rc)} r="3.2" className="fill-neutral-100 stroke-neutral-900" strokeWidth="0.6" />}
    </svg>
  );
}

function CellGrid({ snap }) {
  const cells = snap?.cells ?? [];
  const cur = snap?.current;
  const all = cur ? [...cells, { pi: cur.pi, li: cur.li }] : cells;
  if (!all.length) return null;
  const p0 = Math.min(...all.map((c) => c.pi)) - 1, p1 = Math.max(...all.map((c) => c.pi)) + 1;
  const l0 = Math.min(...all.map((c) => c.li)) - 1, l1 = Math.max(...all.map((c) => c.li)) + 1;
  const nx = Math.min(14, p1 - p0 + 1), ny = Math.min(8, l1 - l0 + 1);
  const W = 9;
  const hz = (pi) => Math.round(2 ** (((pi + 0.5) * 2) / 12));
  return (
    <div className="text-[10px] text-neutral-500" data-weight-cells="">
      <svg width={nx * W + 1} height={ny * W + 1} className="block">
        {Array.from({ length: ny }, (_, yy) => Array.from({ length: nx }, (_, xx) => {
          const pi = p0 + xx, li = l1 - yy;
          const c = cells.find((q) => q.pi === pi && q.li === li);
          const isCur = cur && cur.pi === pi && cur.li === li;
          return (
            <rect key={`${xx},${yy}`} x={xx * W + 0.5} y={yy * W + 0.5} width={W - 1} height={W - 1} rx="1"
              className={`${c?.ready ? "fill-neutral-400" : c ? "fill-neutral-600" : "fill-neutral-800"} ${isCur ? "stroke-neutral-100" : "stroke-transparent"}`}
              strokeWidth="1" />
          );
        }))}
      </svg>
      <div>pitch {hz(p0)}–{hz(p0 + nx - 1)} Hz → · louder ↑ · light squares = mapped</div>
    </div>
  );
}

function LoudnessCheck({ l }) {
  if (!l) return null;
  if (!l.done) return <span className="text-neutral-500" data-weight-loudness="not-done">Loudness check: not done (the softer / louder steps had too few seconds)</span>;
  const d = `${l.diffDb.toFixed(1)} dB`;
  return l.compressed
    ? <span className="text-neutral-300" data-weight-loudness="compressed">Loudness check: softer → louder only {d} — compression suspected, readings off</span>
    : <span className="text-neutral-500" data-weight-loudness="ok">Loudness check: softer → louder {d}</span>;
}

function Mapping({ snap, blocked }) {
  const phase = snap?.phase ?? "unmapped";
  const btn = "px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer disabled:opacity-40 disabled:cursor-default";
  if (phase === "mapping") {
    const p = snap.prompt;
    return (
      <div className="rounded-lg border border-neutral-700 px-2.5 py-2 text-xs text-neutral-300 space-y-1.5" data-weight-mapping="">
        <div>
          <span className="text-neutral-500">Mapping {p.index + 1} / {p.of}: </span>
          <span className="text-neutral-100">{p.label}</span>
          <span className="text-neutral-500"> — keep talking in full sentences (read aloud, describe your day).</span>
        </div>
        <div className="h-1.5 rounded bg-neutral-800 overflow-hidden">
          <div className="h-full bg-neutral-400" style={{ width: `${Math.min(100, (100 * p.have) / p.need)}%` }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {/* One width for "Next" and "Done", so the buttons after it never move. */}
          <button className={btn} onClick={() => weightCommand("next")}>
            <span className="inline-grid">
              {["Next", "Done"].map((t) => <span key={t} aria-hidden="true" className="invisible col-start-1 row-start-1">{t}</span>)}
              <span className="col-start-1 row-start-1">{p.index + 1 < p.of ? "Next" : "Done"}</span>
            </span>
          </button>
          <button className={btn} onClick={() => weightCommand("finish")}>Finish now</button>
          <button className={btn} onClick={() => weightCommand("cancel")}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
      {phase === "mapped" && snap.map && <span>Your map: {snap.map.nReady} pitch × loudness area{snap.map.nReady === 1 ? "" : "s"}</span>}
      {phase === "mapped" && snap.map && <LoudnessCheck l={snap.map.loudness} />}
      {phase !== "mapped" && <span>First map your voice: about 3 minutes of talking, guided.</span>}
      <button className={btn} disabled={blocked} onClick={() => weightCommand("start")} data-weight-map-start="">
        {phase === "mapped" ? "Map again" : "Map your voice"}
      </button>
      {snap?.note && <span className="text-neutral-500">{snap.note}</span>}
    </div>
  );
}

export default function WeightClarityView({ s, phone = false }) {
  useEffect(() => { enableWeight(); }, []);
  const short = useSyncExternalStore(subscribeShort, isShort, () => false);
  const height = useSyncExternalStore(subscribeHeight, viewHeight, () => 800);
  const snap = s.weightSnap;
  const agcBlocked = snap ? !snap.captureOk : false;
  const r = snap?.reading;
  const cur = snap?.current;
  const cost = s.perf?.weightMsPerAudioS;
  const header = (
    <div>
      <h3 className="text-sm text-neutral-200">Weight × clarity <span className="text-neutral-500 text-xs">experimental</span></h3>
      <p className="text-xs text-neutral-300 font-medium">Experimental — not a measurement of vocal-fold weight or contact</p>
      <p className="text-[11px] text-neutral-500 leading-snug mt-0.5">
        Compares your voice now with your own usual voice <em>at the same pitch and loudness</em>: is its sound lighter or
        heavier, breathier or clearer, than your usual there? No targets — it reads the same for any training direction.
      </p>
    </div>
  );
  const status = (
    <>
      {!s.running && <p className="text-sm text-neutral-500">Start listening to use this view.</p>}
      {s.running && s.weight === "loading" && <p className="text-xs text-neutral-500">Loading…</p>}
      {s.weight === "error" && <p className="text-xs text-neutral-400">Could not start: {s.weightError}</p>}
      {snap && agcBlocked && (
        <p className="text-xs text-neutral-300 rounded border border-neutral-700 px-2 py-1">
          This browser did not confirm that automatic gain control is off, so loudness can't be matched and the comparison stays off.
        </p>
      )}
      {snap && <Mapping snap={snap} blocked={agcBlocked} />}
    </>
  );
  const plot = snap && (
    <div className="flex flex-col items-center shrink-0">
      <div className="text-[10px] leading-3 uppercase tracking-wide text-neutral-500">clearer</div>
      <div className="flex items-center gap-1">
        <div className="text-[10px] leading-3 uppercase tracking-wide text-neutral-500 [writing-mode:vertical-rl] rotate-180">lighter</div>
        <DotPlot snap={snap} size={short ? 116 : phone ? phonePlotSize(height) : 240} />
        <div className="text-[10px] leading-3 uppercase tracking-wide text-neutral-500 [writing-mode:vertical-rl]">heavier</div>
      </div>
      <div className="text-[10px] leading-3 uppercase tracking-wide text-neutral-500" data-weight-axis-bottom="">breathier</div>
      <div className={`text-[10px] text-neutral-600 mt-0.5 text-center ${short ? "max-w-[160px]" : ""}`} data-weight-box-label="">
        dashed box = typical chance spread (±{NOISE_BOX}) · centre = your usual
      </div>
    </div>
  );
  const readouts = snap && (
    <ReadoutBlock snap={snap} r={r} cur={cur} />
  );
  if (short) {
    return (
      <div className="space-y-2.5" data-weight-view="" data-weight-counts={snap ? JSON.stringify(snap.counts) : undefined} data-weight-layout="side">
        <div className="flex items-start gap-3">
          {plot}
          <div className="min-w-0 flex-1 space-y-2">
            {header}
            {status}
            {readouts}
          </div>
        </div>
        <Caveats cost={cost} />
      </div>
    );
  }
  return (
    <div className="space-y-2.5" data-weight-view="" data-weight-counts={snap ? JSON.stringify(snap.counts) : undefined} data-weight-layout={phone ? "stack" : "row"}>
      {header}
      {status}
      {snap && (
        <div className={phone ? "flex flex-col items-center gap-2" : "flex items-start gap-4"}>
          {plot}
          {readouts}
        </div>
      )}
      <Caveats cost={cost} />
    </div>
  );
}

function ReadoutBlock({ snap, r, cur }) {
  return (
    <div className="text-xs text-neutral-400 space-y-1.5 min-w-0 w-full">
      <div className="text-sm text-neutral-200 tabular-nums" data-weight-reading="">
        {r ? <>Light↔heavy sound {fmt(r.rw)} · Breathy↔clear {fmt(r.rc)} <span className="text-xs text-neutral-500">(your units)</span></> : <>—</>}
      </div>
      <div className="text-neutral-500">{r ? "units of your own usual 1-second variation (from your map)" : snap.phase === "mapping" ? "mapping…" : snap.reason ?? ""}</div>
      <div className="tabular-nums">Loudness now {snap.liveDbfs === null ? "—" : `${snap.liveDbfs.toFixed(0)} dBFS`}</div>
      {cur && (
        <div className="tabular-nums">
          Last second: ~{Math.round(cur.hz)} Hz, {cur.dbfs.toFixed(0)} dBFS — {cur.ready ? "mapped here" : `not mapped here${cur.n ? ` (${cur.n} s)` : ""}`}
        </div>
      )}
      <CellGrid snap={snap} />
      {snap.capture && <div className="text-neutral-500">Browser gain control: {snap.capture.autoGainControl === false ? "off" : snap.capture.autoGainControl ? "on" : "unknown"} <span className="text-neutral-600">(system / headset gain control can't be seen)</span></div>}
    </div>
  );
}

function Caveats({ cost }) {
  return (
    <div className="rounded-lg border border-neutral-800 px-2.5 py-2" data-weight-caveats="">
      <div className="text-xs text-neutral-300 mb-1">What this can and can't tell you</div>
      <ul className="text-[11px] text-neutral-500 leading-snug space-y-1">
        {CAVEATS.map(([k, v]) => <li key={k}><span className="text-neutral-400">{k}:</span> {v}</li>)}
      </ul>
      <p className="text-[10px] text-neutral-600 mt-1.5">
        Weight and clarity come from a small learned model (synthetic voices, CMU ARCTIC, VocalSet, PVQD). Tests used AVID
        (Kodali, Alku, Kadiri; CC BY 4.0) and other public recordings.
        {cost != null && ` Cost here: ${cost.toFixed(1)} ms CPU per s of audio.`}
      </p>
    </div>
  );
}
