# Custom voice-vs-machine detector — round 5 selection and freeze (2026-10-12)

Branch `voice-detector`. Step 6 of the round-5 pre-registration
([voice-detector-round5-preregistration-2026-10-12.md](voice-detector-round5-preregistration-2026-10-12.md),
§3–§5, Addenda R5-A to R5-C): training, selection on **validation data
only**, the deployable re-check, the freeze and the go / no-go of §5.

**Result: NO-GO by the rule. Round 5 stops before the look; the seal stays
unbroken; the user decides.**

- **Frozen** (as §4 requires once a candidate has a feasible point):
  `custom-vd-r5` = **r11-harm step 10,000** (F1m + F5, seed 53), one model,
  state carried and never reset; agg `mean`, p ≥ 0.05, hangover 200 ms.
- **The voice-safety fix worked on the new rows:** at the frozen point every
  H1 and H2 reading passes for **both sexes** (round 4's freeze fails 64 of
  them, round 3's 29).
- **But it costs most of the noise removal:** O = **31.15 %** on the
  deployable files (go bar 60 %; round 4: 69.30 %). Steady-noise removal on
  the tuning split's stationary-tonal clips fell from 76.7 to 35.3 %.
- **Rows that fail the go rule:**
  1. **O ≥ 60 % on the tuning-194 split: 31.15 %** — the binding failure.
  2. **V4 ≤ 2 ms per 25 ms: 2.02 ms (Node) / 1.87 ms (headless Chrome)**,
     measured on a shared machine at 40–47 % CPU load from other work; round
     4's frozen model read 0.93–0.95 ms in the same session (0.56 ms in
     round 4's quieter session), so a quiet-machine value near 1.2 ms is
     likely — **an estimate, not a measurement**. As measured, the row fails
     by 0.02 ms.
  - Every other feasibility reading (round 4's rows, H1, H2, V3) passes.
- **Not done, by design:** no probability file was written for any harness
  or confirmatory stream; no model of any round has run on the sealed set;
  the private session recordings were not read. (Even under a go, the look
  waits for the §6.2 review and the user's recorded confirmation.)

## 1. What was trained and scored

| run | seed | features | best checkpoint | pick (agg / p / hangover) | O % (extended bar) | best O of the run's checkpoints on round-4 rows only % | training time |
|---|---|---|---|---|---|---|---|
| `r11-data` | 51 | F1 (round 4's network) | 16,000 | mean / 0.05 / 3000 ms | 10.15 | 53.32 | 3 h 48 min* |
| `r11-floor` | 52 | F1m | 10,000 | mean / 0.05 / 200 ms | 12.21 | 44.26 | 3 h 37 min* |
| **`r11-harm`** | **53** | **F1m + F5** | **10,000** | **mean / 0.05 / 200 ms** | **31.22** | 44.29 | 2 h 39 min |
| `r11-harm-s54` (run 4) | 54 | F1m + F5 | 16,000 | mean / 0.05 / 3000 ms | 19.58 | 45.26 | 2 h 12 min |
| reference `custom-vd-r4` | — | F1 | (r10-notch 8,000) | **no feasible point** | (fallback 22.76) | 69.30 | — |
| reference `custom-vd-r3` | — | log-mel | (r9-sess-b 8,000) | mean / 0.01 / 50 ms | 5.48 | 51.93 | — |

\* runs 1–2 in parallel, paused repeatedly by the machine's load governor.

- **28 candidates** (7 EMA checkpoints × 4 runs, each `plain`) plus the two
  reference rows, scored by `opselect_r5.py` (round 4's grid, readings,
  objective and within-candidate pick, plus H1 / H2 per sex). 27 of the 28
  have a feasible point; all of them only at low thresholds (p ≤ 0.07).
- **Run 4** was fixed by §3.6's rule before it started (Addendum R5-C): a
  second seed of the best feasible candidate's features (F1m + F5).
- **Seed spread is large again:** the two F1m + F5 seeds peak at 31.2 and
  19.6 %. The chosen point is the best of eight F1m + F5 checkpoints.
- **The D7 training costs noise removal even before the new rows:** on round
  4's rows alone the round-5 checkpoints reach at most 53.3 % (round 4's
  best: 69.3 %). The diagnostic `hbind_r5.py` (reported, not in the rule)
  shows that the men's 0 dB / +10 dB synthetic rows and the men's long holds
  are what pull each checkpoint's feasible threshold down.

### Choice (§4)

- Largest O: `r11-harm-e10000` (31.22 % on the torch files). Next:
  `r11-harm-e12000`, 27.06 % — not within 1 pp, so no tie-break was needed.
- WASM cost per architecture (one session, Node, onnxruntime-web 1.30.0,
  1 thread, 25–47 % machine load): F1 0.65, F1m 0.75, F1m + F5 1.57,
  F1m + F5 + Bound 1.65 ms per 25 ms (random-weight exports; the cost does
  not depend on the weights).

## 2. Deployable re-check and the freeze

- **Export:** `build/vad-train/model-r5/custom-vd-r5.onnx`, 2,231,552 bytes,
  97,013 parameters, sha256 `191a973f…9205` (checkpoint `b1e305d3…84b6`,
  state dict `cd19a9fb…aff4`). MIT; `ATTRIBUTION.md` from
  `attribution.py --tag=r5` (round 4's training list, 36,898 files; D7a is a
  subset of it, D7b is generated).
- **Every selection file re-made with onnxruntime CPU, 1 thread, chunks of 8
  frames, state carried** (`run-r5-recheck.sh`): the 5,969 fresh validation
  streams and the tuning 194, the 240 one-room sessions, the 2,048 H streams,
  and round 2's spliced sessions (`infer_carried.py`, seed 20261007; the 207
  sessions are identical to round 2's construction).
- **The rule on those files gives the same pick** (mean, p ≥ 0.05, 200 ms):
  O 31.15 % (torch files: 31.22 %). That is the frozen point:
  `scripts/voice-detector/train/frozen/candidate-r5.json`.

| frozen point (deployable files) | value | limit |
|---|---|---|
| fresh, worst clean val group (clinical; children 0.42 %) | 0.43 % | ≤ 0.5 % |
| fresh, worst val mix cell (lead 0, 0 dB) | 0.23 % | ≤ 1.5 % |
| one-room carried, worst clean group (children) | 0.35 % | ≤ 0.5 % |
| one-room carried, worst SNR cell (0 dB) | 0.15 % | ≤ 1.5 % |
| H1 / H2, every cell and bin, each sex | pass (worst: men real series 0 dB, first 10 s 0.97 %) | ≤ 0.5 % / 1.5 %; last ≤ first + 1 pp |
| `frame_ms` + lookahead; median onset delay fresh / carried | 82 ms; 0 / 0 ms | ≤ 100 ms |
| WASM, 1 thread: Node / headless Chrome 155 (40–47 % load) | **2.02** / 1.87 ms per 25 ms | ≤ 2 ms |
| **O** = min(tuning-194 31.15, val negatives 45.83, one-room sessions 56.65) | **31.15 %** | go needs ≥ 60 % |
| spliced sessions (reported): worst clean (exercises) / worst mix; tuning-194 V2 | 0.39 % / 0.09 %; 14.03 % | not gating |

- **Phone estimate** (the benchmark's 2.4–4.5× desktop-to-mobile ratios on a
  quiet-machine value near 1.2 ms): about 2.8–5.3 ms per 25 ms — an
  estimate, not a measurement.

### H rows per sex at the frozen point (deployable files)

H1: veto % of the in-band CORRECT hops (men 75–130 Hz, women 160–300 Hz).

| voice | men: clean / +20 / +10 / 0 dB | women: clean / +20 / +10 / 0 dB |
|---|---|---|
| real held vowels | 0.00 / 0.16 / 0.31 / 0.21 | 0.00 / 0.04 / 0.01 / 0.01 |
| synthetic vowels | 0.00 / 0.03 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 / 0.00 |
| synthetic hums | 0.00 / 0.00 / 0.00 / 0.11 | 0.00 / 0.00 / 0.00 / 0.07 |
| *round 4's freeze, synthetic hums* | *9.08 / 18.37 / 27.79 / 21.64* | *0.00 / 0.00 / 0.00 / 2.31* |

H2: worst 10-s bin / first 10 s / last 10 s, veto % of every CORRECT hop.

| holds | men: clean; +20; +10; 0 dB | women: clean; +20; +10; 0 dB |
|---|---|---|
| synthetic 30–60 s | 0 / 0 / 0; 0 / 0 / 0; 0 / 0 / 0; 0.48 / 0.48 / 0.03 | all 0.00 |
| real series | 0.05 / 0.01 / 0.01; —; 0.13 / 0.01 / 0.00; 0.97 / 0.97 / 0.00 | 0.10 / 0.00 / 0.00; —; 0 / 0 / 0; 0.27 / 0.00 / 0.24 |
| *round 4's freeze, synthetic, men* | *64.05 / 0.70 / 36.68; 65.53 / 3.46 / 54.96; 76.98 / 20.35 / 70.22; 95.11 / 24.12 / 83.49* | |

- No hold's last 10 s is more than 10 % vetoed; H1 streams with more than
  10 % of their hops vetoed: men real vowels 2 / 100 at 0 dB and 2 / 100 at
  +10 dB, women 1 / 100 (+20 dB) and 1 / 40 synthetic hums (0 dB).
- **H3 (reported):** speech rows in the one-room validation sessions ≤ 0.01 %
  for both sexes at every condition (round 4's medium finding does not show
  in the validation sessions for any model).

### Reported rows (not in the rule)

| candidate (point) | tune-194 V2 % by census label: stationary-tonal / mixed / broadband / intermittent-tonal (all) | val negatives V2 %: steady / not steady (all) | fsr4 val V2 % (14 clips) |
|---|---|---|---|
| `custom-vd-r5` (mean / 0.05 / 200 ms; ONNX files) | 35.3 / 29.9 / 15.5 / 17.8 (31.2) | 52.9 / 32.9 (45.8) | 17.8 |
| `custom-vd-r4` (mean / 0.1 / 300 ms) | 76.7 / 67.0 / 41.1 / 47.0 (69.3) | 93.5 / 74.1 (86.6) | 88.4 |

The steady machine noise round 4 learned to remove is now mostly left
painted: the model that no longer vetoes a man humming next to a fan also no
longer vetoes much of the fan.

## 3. Checks, departures and process notes

- **Selection inputs unchanged:** round 4's 18,610 files and the 8,198 H
  files re-hashed, 0 mismatches (`r5/verify_inputs.py`). The reference rows
  reproduce their round-4 rule entries on round 4's rows (O 69.30 / 51.93 %).
- **H readings** match score.py's functions at four grid points (0
  mismatches).
- **Parity on the trained network (finding).** Random-weight parity was
  ≤ 7e-7 (Addendum R5-B part 2), but the trained F1m + F5 network differs by
  up to **0.066** in probability between the torch batch model and the
  streaming ONNX file, and WASM vs ONNX CPU by up to **0.037**. Cause:
  near-ties in F5's cepstral-peak argmax. Float rounding that differs between
  batch and chunked computation flips ln q by about 0.68 (an octave-type
  jump) on some frames (188 of 1,600 in one choir stream; none in 4 of 8
  checked streams), and the trained network reacts to it. It is a property
  of the pre-registered feature, not of the export. The frozen point comes
  from the ONNX files, and the rule gives the same pick on them (O 31.15 vs
  31.22 %). A deployment would see the same small disagreement between
  runtimes.
- **GPU batch size for F5 networks.** `infer_r3.py` ran F5 networks with a
  frame budget of 40,000 per GPU batch (default 300,000). At the default,
  F5's batch spectrum did not fit beside the other GPU work and the run
  stalled. Only the chunking differs.
- **Load.** Other work kept the shared machine at 40–100 % CPU. A governor
  paused the training and inference jobs many times. This slowed them but
  did not change them; the WASM numbers above carry their load.
- **The tail weight of §3.4 changed no weight** (positive frames already
  weigh 3). The decay penalty was the active term (Addendum R5-B part 2,
  B2.5).
- **Smoke tests:** two code smoke runs (12 and 6 steps), deleted, never
  scored.

## 4. For the user

1. **Round 5 fixed the voice-safety failures on the practice bar, at a price
   the go rule does not accept.** Every new H row passes for both sexes at
   the frozen point, but O is 31 % against 60 %. No round-5 checkpoint
   reaches 60 % even on round 4's rows alone (best 53 %). The sealed set
   stays unseen; there is no look.
2. **What the numbers suggest (validation only):**
   - The new bar's synthetic 0 dB / +10 dB cells for men are strict:
     round 3's freeze fails them too.
   - A detector that keeps a low man's hum next to a running fan has to
     leave most of that fan's paint alone. Under these features, removing
     steady noise and keeping steady low voice pull against each other.
3. **Options** (each needs a decision and, for a new round, a new
   pre-registration):
   - **Accept the trade-off.** Lower the noise goal (O ≥ 60 %), or apply it
     per noise class, for a voice-safe detector.
   - **Relax the strictest new cells.** For example, gate H1 / H2 at clean,
     +20 and +10 dB and report 0 dB. This changes the bar after seeing
     results, so it would be a new pre-registration with fresh data.
   - **Keep round 4's detector (`custom-vd-r4`).** Add a separate guard that
     stops it vetoing held low phonation (for example, use the pitch
     worker's own stable-F0 track as an override). This is a different
     design.
   - **Stop the custom detector work.**
4. **V4 is at its edge for F5 networks under load.** If an F5 design goes
   forward, measure its cost on a quiet machine before relying on it.
5. The review of §6.2 (the round-4 probes on the round-5 freeze) was not run.
   It is required only before a go, and the rule gave no go. It can be run
   on request.

## 5. Full selection table (validation only; torch files)

The table is in `build/vad-train/r5/sel/table-torch.md`. Each row is the
rule's pick for one candidate (or its fallback). The columns are O, its three
parts, the worst rows, the number of H readings failing at the point, and the
number of feasible points (with the round-4 rows only in brackets).

| candidate | arch | pick (agg / p / hangover) | O % | tune-194 V2 % | vneg V2 % | vsess V2 % | fresh worst clean / mix % | vsess worst clean / mix % | H readings failing | feasible points (round-4 rows only) |
|---|---|---|---|---|---|---|---|---|---|---|
| **r11-harm-e10000:plain** | F1m+F5 | PICK: mean / 0.05 / 200 ms | 31.22 | 31.22 | 45.84 | 56.66 | 0.43 / 0.23 | 0.35 / 0.15 | 0 | 174 (187) |
| r11-harm-e12000:plain | F1m+F5 | PICK: max / 0.05 / 300 ms | 27.06 | 27.06 | 44.60 | 60.40 | 0.45 / 0.20 | 0.29 / 0.28 | 0 | 152 (183) |
| r11-harm-s54-e16000:plain | F1m+F5 | PICK: mean / 0.05 / 3000 ms | 19.58 | 19.58 | 38.96 | 39.55 | 0.44 / 0.03 | 0.10 / 1.02 | 0 | 97 (115) |
| r11-harm-s54-e14000:plain | F1m+F5 | PICK: mean / 0.03 / 200 ms | 19.03 | 19.03 | 37.34 | 44.10 | 0.21 / 0.14 | 0.03 / 0.17 | 0 | 119 (168) |
| r11-harm-s54-e4000:plain | F1m+F5 | PICK: mean / 0.05 / 200 ms | 18.43 | 18.43 | 28.05 | 30.15 | 0.47 / 0.15 | 0.14 / 0.03 | 0 | 164 (236) |
| r11-harm-s54-e12000:plain | F1m+F5 | PICK: max / 0.05 / 1500 ms | 13.65 | 13.65 | 33.42 | 36.02 | 0.05 / 0.09 | 0.04 / 0.05 | 0 | 113 (186) |
| r11-floor-e10000:plain | F1m | PICK: mean / 0.05 / 200 ms | 12.21 | 12.21 | 28.18 | 37.52 | 0.30 / 0.11 | 0.23 / 0.10 | 0 | 162 (231) |
| r11-floor-e6000:plain | F1m | PICK: mean / 0.07 / 1250 ms | 12.00 | 12.00 | 25.83 | 34.90 | 0.05 / 0.14 | 0.43 / 0.13 | 0 | 172 (187) |
| r11-harm-s54-e6000:plain | F1m+F5 | PICK: max / 0.03 / 500 ms | 11.71 | 11.71 | 29.45 | 39.78 | 0.07 / 0.16 | 0.23 / 0.20 | 0 | 96 (163) |
| r11-floor-e14000:plain | F1m | PICK: mean / 0.03 / 100 ms | 11.47 | 11.47 | 23.16 | 39.66 | 0.16 / 0.13 | 0.10 / 0.04 | 0 | 129 (232) |
| r11-harm-e8000:plain | F1m+F5 | PICK: max / 0.07 / 3000 ms | 10.91 | 10.91 | 22.50 | 29.12 | 0.27 / 0.02 | 0.03 / 0.05 | 0 | 138 (160) |
| r11-floor-e16000:plain | F1m | PICK: max / 0.05 / 750 ms | 10.87 | 10.87 | 27.03 | 43.21 | 0.10 / 0.14 | 0.23 / 0.08 | 0 | 142 (224) |
| r11-floor-e12000:plain | F1m | PICK: max / 0.05 / 750 ms | 10.38 | 10.38 | 24.64 | 35.23 | 0.09 / 0.06 | 0.23 / 0.08 | 0 | 139 (224) |
| r11-harm-e6000:plain | F1m+F5 | PICK: last / 0.02 / 100 ms | 10.35 | 10.35 | 19.04 | 24.98 | 0.40 / 0.14 | 0.10 / 0.04 | 0 | 89 (205) |
| r11-data-e16000:plain | F1 | PICK: mean / 0.05 / 3000 ms | 10.15 | 10.15 | 20.98 | 39.50 | 0.00 / 0.03 | 0.00 / 0.04 | 0 | 97 (277) |
| r11-harm-e14000:plain | F1m+F5 | PICK: mean / 0.03 / 500 ms | 9.69 | 9.69 | 16.49 | 38.09 | 0.10 / 0.06 | 0.00 / 0.08 | 0 | 107 (258) |
| r11-harm-s54-e8000:plain | F1m+F5 | PICK: max / 0.03 / 150 ms | 9.46 | 9.46 | 20.33 | 23.86 | 0.49 / 0.11 | 0.00 / 0.13 | 0 | 120 (177) |
| r11-floor-e4000:plain | F1m | PICK: max / 0.07 / 100 ms | 8.99 | 8.99 | 29.86 | 26.07 | 0.30 / 0.09 | 0.29 / 0.04 | 0 | 226 (282) |
| r11-data-e14000:plain | F1 | PICK: mean / 0.03 / 1000 ms | 8.34 | 8.34 | 18.12 | 42.87 | 0.00 / 0.03 | 0.02 / 0.01 | 0 | 53 (267) |
| r11-floor-e8000:plain | F1m | PICK: max / 0.05 / 750 ms | 6.82 | 6.82 | 23.52 | 25.66 | 0.07 / 0.14 | 0.23 / 0.06 | 0 | 142 (210) |
| r9-sess-b-e8000:plain | plain | PICK: mean / 0.01 / 50 ms | 5.48 | 5.48 | 16.26 | 24.28 | 0.26 / 0.05 | 0.12 / 0.03 | 0 | 84 (385) |
| r11-harm-e16000:plain | F1m+F5 | PICK: mean / 0.03 / 400 ms | 5.43 | 5.43 | 11.69 | 33.22 | 0.10 / 0.08 | 0.01 / 0.06 | 0 | 111 (276) |
| r11-data-e4000:plain | F1 | PICK: last / 0.03 / 300 ms | 4.22 | 4.22 | 11.81 | 22.93 | 0.19 / 0.15 | 0.22 / 0.02 | 0 | 109 (198) |
| r11-data-e6000:plain | F1 | PICK: last / 0.03 / 100 ms | 3.56 | 3.56 | 7.81 | 24.98 | 0.19 / 0.19 | 0.02 / 0.03 | 0 | 128 (293) |
| r11-harm-s54-e10000:plain | F1m+F5 | PICK: last / 0.01 / 100 ms | 3.18 | 3.18 | 6.73 | 17.00 | 0.10 / 0.04 | 0.00 / 0.00 | 0 | 42 (214) |
| r11-data-e10000:plain | F1 | PICK: max / 0.01 / 50 ms | 3.08 | 3.08 | 10.05 | 33.69 | 0.16 / 0.05 | 0.15 / 0.03 | 0 | 43 (181) |
| r11-data-e8000:plain | F1 | PICK: max / 0.01 / 50 ms | 2.65 | 2.65 | 9.37 | 31.31 | 0.26 / 0.06 | 0.34 / 0.09 | 0 | 43 (198) |
| r11-harm-e4000:plain | F1m+F5 | PICK: max / 0.02 / 400 ms | 2.46 | 2.46 | 4.18 | 17.36 | 0.02 / 0.02 | 0.02 / 0.01 | 0 | 61 (188) |
| r10-notch-e8000:plain | F1 | fallback (no feasible point): last / 0.01 / 250 ms | 22.76 | 22.76 | 48.55 | 51.60 | 0.02 / 0.08 | 0.00 / 0.01 | 19 | 0 (229) |
| r11-data-e12000:plain | F1 | fallback (no feasible point): last / 0.01 / 3000 ms | 1.63 | 1.63 | 6.87 | 18.95 | 0.00 / 0.03 | 0.00 / 0.00 | 3 | 0 (190) |
