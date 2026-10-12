# Custom voice-vs-machine detector — round 4 selection and freeze (2026-10-12)

Branch `voice-detector`. Step 3 of the round-4 pre-registration
([voice-detector-round4-preregistration-2026-10-11.md](voice-detector-round4-preregistration-2026-10-11.md),
§3–§5, Addenda R4-A and R4-B): training, selection on **validation data
only**, the deployable re-check, the freeze and the go / no-go of §5.

**Result: GO by the rule. The look is on hold until the user rules on the trills clip.**

- **Frozen.** The rule chose **r10-notch step 8,000** (an F1 network, seed 44),
  as a single model with its state carried and never reset. The point is agg
  `mean`, p ≥ 0.10, hangover 300 ms.
- **Deployable re-check.** Run as streaming ONNX, the same point has
  **O = 69.30 %** (go bar: 60 %). It is feasible on every validation reading
  and costs **0.56 ms (Node) / 0.52 ms (headless Chrome) per 25 ms**.
- **Not done yet:**
  - No probability file was written for any harness or confirmatory stream.
  - The sealed set is unbroken: no model of any round has run on it.
  - The private session recordings were not read.
- **Why the look waits.** Addendum R4-A A.5 leaves one decision to the user,
  before the look: keep or drop the 1885 Volta recording `c_tr4_wc__a488f3b5`
  in the trills row. If it is dropped, the sealed set gets a blind re-seal
  (R4-A′) first. Running the frozen model on confirmatory streams now would
  close that option.

## 1. What was trained and scored

- **Runs.** Four runs, 16,000 steps each, two at a time (Addendum R4-B
  B.10). All use the round-4 training data D1–D6 and sessions of 64–256 s.

  | run | seed | features | training time |
  |---|---|---|---|
  | `r10-data` | 41 | log-mel only (round 3's network) | 84 min |
  | `r10-stat-a` | 42 | F1 | 156 min |
  | `r10-stat-b` | 43 | F1 | 151 min |
  | `r10-notch` | 44 | F1; F3 not used (B.7) | 113 min |

  No run crashed or resumed.
- **Candidates.** 28 EMA checkpoints (steps 4,000 to 16,000, every 2,000),
  each `plain`, plus the reference row `custom-vd-r3`.
- **Scoring.** Each candidate went through the §4 grid (24 thresholds × 16
  hangovers × 3 aggs), the feasibility checks and the within-candidate pick.
- **Feasibility.** All 29 candidates have a feasible point.
- **Binding split.** For every candidate, O is set by the tuning-194 split,
  as in round 3.

### Best point per run (torch selection files)

| run | features | best checkpoint | pick (agg / p / hangover) | O % (= tuning-194 V2) | val-negatives V2 % | one-room sessions V2 % |
|---|---|---|---|---|---|---|
| reference: `custom-vd-r3` | log-mel | r9-sess-b step 8,000 | mean / 0.3 / 600 ms | 51.93 | 74.95 | 75.03 |
| `r10-data` | log-mel | step 16,000 | max / 0.3 / 2000 ms | 62.72 | 78.91 | 79.39 |
| `r10-stat-a` | F1 | step 6,000 | max / 0.07 / 300 ms | 61.93 | 83.91 | 84.62 |
| `r10-stat-b` | F1 | step 6,000 | last / 0.07 / 250 ms | 63.10 | 81.27 | 85.23 |
| **`r10-notch`** | **F1** | **step 8,000** | **mean / 0.1 / 300 ms** | **69.30** | **86.65** | **89.37** |

What this shows, on validation data only:

- **The round-4 training data moved every run past round 3.** With round
  3's network and features unchanged, `r10-data` reaches 62.7 %, against
  51.9 % for round 3's freeze. Each of the four runs has at least one
  checkpoint at or above 60 %.
- **F1 helps on the validation negatives and the one-room sessions.** The
  F1 runs remove more false paint there than the log-mel run. At each run's
  best point: 81–87 % of the validation negatives' false hops (log-mel:
  79 %) and 85–89 % of the sessions' (log-mel: 79 %). On the tuning split
  the gain is clear in only one of the three F1 seeds.
- **The spread between seeds is still large.** The three F1 runs differ only
  by seed, and their best O values are 61.9, 63.1 and 69.3 %. The chosen
  candidate is the best seed of three. Its O on the tuning split is
  therefore optimistic in two ways:
  - the design targets the noise types of that split (§4's caution);
  - the choice among seeds is itself a selection on it.

  The sealed confirmatory set is the check on both.
- **The spliced validation sessions (reported only, not feasibility):** at
  the chosen point, the worst clean group ("exercises") is vetoed 1.97 % of
  the time; round 3's freeze had 1.70 %. Those are carried-state streams
  spliced end to end. The confirmatory bar's carried clause (V1 carried
  ≤ 1 % clean) is judged on the sealed one-room sessions, not on these. It
  is the reading to watch at the look.

### Choice (§4)

- **Largest O.** `r10-notch-e8000:plain` and `r10-notch-e16000:plain` both
  have 69.30 % (54,902 of 79,223 false hops on the tuning split).
  `r10-notch-e14000` (68.46 %) is also within 1 pp.
- **Tie-break 1, WASM cost per architecture.** All three are F1 networks,
  so cost does not separate them. Costs were measured in one session
  (Node, onnxruntime-web 1.30.0, 1 thread): log-mel 0.49 ms, F1 0.62 ms per
  25 ms.
- **Tie-break 2, val-negatives V2.** e8000 86.65 %, e16000 86.46 %,
  e14000 85.35 %. **The pick is `r10-notch-e8000`.**

## 2. Deployable re-check and the freeze

- **The exported model.** The checkpoint was exported to streaming ONNX
  with F1's 5 state inputs (`export.py`). Streaming vs batch: max abs
  difference 1.1e-5.
- **The re-made files.** All selection files were re-made with
  onnxruntime CPU, 1 thread, chunks of 8 frames, state carried:
  - the fresh validation streams (5,969) and the tuning 194;
  - the 240 one-room validation sessions, each run as one stream;
  - round 2's spliced sessions, via `infer_carried.py` with seed 20261007.
    The 207 sessions it built are identical to round 2's construction.
- **The rule on those files** gives **the same pick and the same numbers**:
  mean, p ≥ 0.10, 300 ms, O 69.30 %. That pick is the frozen point.
- **Frozen file:** `scripts/voice-detector/train/frozen/candidate-r4.json`
  (`custom-vd-r4`):

  | item | sha256 |
  |---|---|
  | checkpoint `r10-notch/ckpt_ema_008000.pt` | `60e558c1…d3e08` |
  | state dict | `5a54ca75…23a80` |
  | ONNX file | `c10b28f3…84a5` (1,519,577 bytes, 91,213 parameters) |

  - Model and files stay under the gitignored `build/vad-train/model-r4/`.
  - Weights: MIT.
  - Training data: the round-4 training list (`r4/d1.json`, 36,898
    records, the fsr4 clips included). `ATTRIBUTION.md` comes from
    `attribution.py --tag=r4`; the synthetic banks are generated in code.

| frozen point (deployable files) | value | limit (§4) |
|---|---|---|
| fresh, worst clean val group (children; clinical 0.44 %) | 0.49 % | ≤ 0.5 % |
| fresh, worst val mix cell (lead 0, 0 dB) | 0.95 % | ≤ 1.5 % |
| one-room carried, worst clean group (children) | 0.27 % | ≤ 0.5 % |
| one-room carried, worst SNR cell (0 dB) | 1.19 % | ≤ 1.5 % |
| `frame_ms` + lookahead; median onset delay, fresh / carried | 82 ms; 0 / 0 ms | ≤ 100 ms |
| WASM, onnxruntime-web 1.30.0, 1 thread: Node / headless Chrome 154 | 0.56 / 0.52 ms per 25 ms | ≤ 2 ms |
| WASM vs ONNX CPU files, max abs difference | 1.1e-5 | — |
| **O** = min(tuning-194 69.30, val negatives 86.65, one-room sessions 89.37) | **69.30 %** | go needs ≥ 60 % |
| spliced sessions (reported): worst clean (exercises) / worst mix; tuning-194 V2 | 1.97 % / 0.85 %; 66.34 % | not gating |

- **Measurement conditions.** The WASM figures were measured on a shared
  machine under load (i9-11900K). The Chrome run used a temporary
  `--user-data-dir` and was closed by its own PID.
- **Phone estimate.** Using the benchmark's desktop-to-mobile ratios
  (2.4–4.5×), this gives about **1.3–2.5 ms per 25 ms on a phone**. This is
  an estimate, not a measurement.
- **Margins.** The children row is 0.01 pp under its 0.5 % limit, both on
  the torch files and the ONNX files.

### Reported rows (not in the rule; B.10)

| candidate (point) | tuning-194 V2 % by census label: stationary-tonal / mixed / broadband / intermittent-tonal (all) | val negatives V2 %: steady / not steady (all) | fsr4 val V2 % (14 clips) |
|---|---|---|---|
| `custom-vd-r4` (mean / 0.1 / 300 ms; torch and ONNX files identical here) | 76.7 / 67.0 / 41.1 / 47.0 (69.3) | 93.5 / 74.1 (86.6) | 88.4 |
| `custom-vd-r3` reference (mean / 0.3 / 600 ms) | 52.8 / 54.2 / 37.9 / 40.2 (51.9) | 85.4 / 55.8 (75.0) | 54.9 |

- **Steady noise: the intended gain.** On the tuning split's
  stationary-tonal clips, removal rises from 52.8 to 76.7 %. On the steady
  validation negatives it rises from 85.4 to 93.5 %. On the fsr4 val clips
  (steady machine topics) it rises from 54.9 to 88.4 %.
- **What still fails.** Broadband (22 clips, 41 %) and intermittent-tonal
  (9 clips, 47 %) noise on the tuning split stay well under 60 %. The
  "mixed" class (94 clips) reaches 67 %.
- **The census class sizes** (38,760 / 32,490 / 6,068 / 1,905 false hops)
  equal the pre-registration's §0 table, and "all" equals the rule's
  tuning-194 V2.

## 3. Go / no-go (§5)

| condition | result |
|---|---|
| frozen point feasible (§4, incl. V3 and V4), on the deployable re-check | yes |
| O ≥ 60 % on the deployable re-check | **yes — 69.30 %** |
| trills row after §2.2 | gating under the rules as written: 835 CORRECT hops, gender unknown, pooled. **The user's ruling on `c_tr4_wc__a488f3b5` is still open (A.5)** |
| seal check | not run yet; it runs first at the look (`seal.py verify --tag=r4`, `verify-r3`) |
| **decision** | **go by the rule. The look waits for the trills ruling** |

## 4. Checks, departures and process notes

- **Selection inputs unchanged.**
  - `r4/sel_inputs.py` hashed all 18,610 selection input files (9.1 GB):
    stream specs, dumps, audio and the spliced construction. List:
    `build/vad-train/r4/sel/inputs.sha256` (sha256 `7d8e6c2b…3b46f`).
  - One file was modified after round 3's rule output: round 2's
    `sessions.json`. Round 3's ONNX re-check rewrote it at 15:58 on
    2026-10-11. Its content is identical to a fresh construction from seed
    20261007.
  - The reference row, re-scored in this round's rule run, reproduces
    round 3's entry exactly: the pick and all 1,152 grid points.
- **Smoke tests.** Two code smoke tests of `train_r4.py` ran before training
  (≤ 40 steps, deleted, never scored), as Addendum R4-B part 2 records.
- **Rule runs.** The rule ran twice with the same code: first over the 21
  candidates of the first three runs, while `r10-notch` was still training,
  then over `r10-notch`'s 7. Nothing was changed in between.
- **fsr4 val clips.** Their current-app dumps came from `valdump.mjs` (src
  equals dd92037). Their model files for the torch candidates were written by
  `infer.py` (the batch form, as rounds 1–2). The reference row's fsr4 files
  were written next to its round-3 files in `r3/cand/` (extra files only).
- **A wasted pass.** The first deployable pass over the fresh validation
  streams pointed at a relative path that does not exist from the scripts
  folder, so it found 0 streams. It was re-run with the explicit root before
  the rule read any file.
- **The trills flag.** Training started under the rules as written,
  recorded in B.11 before training.

## 5. For the user

1. **The trills ruling (A.5).** Keep the 1885 Volta clip
   `c_tr4_wc__a488f3b5` in the real lip / tongue-trills row, or drop it?
   - **Keep:** the row gates with 835 CORRECT hops.
   - **Drop:** §2.2 resumes at the open research datasets and then the
     Internet Archive. It now also excludes every round-4 training person
     (B.11). A blind re-seal (R4-A′) follows. Only then the look.
2. **Then the look** (§6): seal verification first; then the frozen runner
   writes the harness and confirmatory probability files (with
   `VAD_R3_LOOK=1`); then exactly one scorer run. Before it, the remaining
   old-harness sets (`noiseho`, `vocalset`, `pvqd`, `voiced`, the mixes)
   must be restored and checked, as in round 3 R3-C.2.
3. **Risks to expect at the look** (validation hints, not results):
   - the children row is at the edge of its validation limit;
   - the spliced carried readings show the exercises group at 1.97 %;
   - broadband and intermittent noise remain weak;
   - the chosen seed was the best of three similar runs.

## 6. Full selection table (validation only; torch files)

| candidate | copies | pick (agg / p / hangover) | O % | tune-194 V2 % | vneg V2 % | vsess V2 % | fresh worst clean / mix % | vsess worst clean / mix % | onset median fresh / vsess ms | spliced worst clean / mix %, tune V2 % |
|---|---|---|---|---|---|---|---|---|---|---|
| **r10-notch-e8000:plain** | 1 | PICK: mean / 0.1 / 300 ms | 69.30 | 69.30 | 86.65 | 89.37 | 0.49 / 0.95 | 0.27 / 1.19 | 0 / 0 | 1.97 / 0.85, 66.34 |
| r10-notch-e16000:plain | 1 | PICK: mean / 0.1 / 200 ms | 69.30 | 69.30 | 86.46 | 92.26 | 0.49 / 0.58 | 0.19 / 0.86 | 0 / 0 | 3.37 / 1.18, 67.62 |
| r10-notch-e14000:plain | 1 | PICK: mean / 0.07 / 150 ms | 68.46 | 68.46 | 85.35 | 90.34 | 0.47 / 0.54 | 0.18 / 0.70 | 0 / 0 | 2.04 / 0.71, 66.14 |
| r10-notch-e12000:plain | 1 | PICK: max / 0.1 / 250 ms | 67.79 | 67.79 | 85.21 | 89.17 | 0.47 / 0.32 | 0.12 / 1.44 | 0 / 0 | 2.49 / 0.42, 64.24 |
| r10-notch-e6000:plain | 1 | PICK: last / 0.13 / 400 ms | 67.27 | 67.27 | 83.63 | 84.19 | 0.35 / 0.88 | 0.29 / 0.81 | 0 / 0 | 2.02 / 0.64, 59.32 |
| r10-notch-e10000:plain | 1 | PICK: max / 0.05 / 100 ms | 66.05 | 66.05 | 83.50 | 88.35 | 0.49 / 0.91 | 0.19 / 1.25 | 0 / 0 | 2.09 / 0.68, 65.02 |
| r10-stat-b-e6000:plain | 1 | PICK: last / 0.07 / 250 ms | 63.10 | 63.10 | 81.27 | 85.23 | 0.47 / 0.94 | 0.41 / 1.04 | 0 / 0 | 0.75 / 0.53, 56.42 |
| r10-data-e16000:plain | 1 | PICK: max / 0.3 / 2000 ms | 62.72 | 62.72 | 78.91 | 79.39 | 0.42 / 1.18 | 0.06 / 1.47 | 0 / 0 | 2.25 / 0.75, 63.65 |
| r10-stat-b-e12000:plain | 1 | PICK: mean / 0.07 / 300 ms | 62.45 | 62.45 | 81.44 | 83.59 | 0.43 / 1.38 | 0.08 / 0.61 | 0 / 0 | 1.65 / 0.67, 60.81 |
| r10-data-e12000:plain | 1 | PICK: max / 0.25 / 1500 ms | 62.26 | 62.26 | 79.24 | 80.30 | 0.47 / 1.38 | 0.29 / 1.32 | 0 / 0 | 2.87 / 0.65, 65.75 |
| r10-stat-a-e6000:plain | 1 | PICK: max / 0.07 / 300 ms | 61.93 | 61.93 | 83.91 | 84.62 | 0.40 / 0.57 | 0.07 / 1.32 | 0 / 0 | 1.44 / 0.48, 43.38 |
| r10-stat-b-e14000:plain | 1 | PICK: mean / 0.05 / 200 ms | 61.41 | 61.41 | 81.17 | 87.18 | 0.47 / 1.29 | 0.08 / 0.17 | 0 / 0 | 3.83 / 1.49, 57.77 |
| r10-data-e14000:plain | 1 | PICK: max / 0.16 / 1000 ms | 60.46 | 60.46 | 80.37 | 80.10 | 0.48 / 1.11 | 0.06 / 1.48 | 0 / 0 | 2.24 / 0.65, 61.90 |
| r10-stat-a-e10000:plain | 1 | PICK: last / 0.05 / 150 ms | 60.32 | 60.32 | 82.79 | 84.53 | 0.49 / 0.72 | 0.06 / 0.45 | 0 / 0 | 4.04 / 0.95, 60.34 |
| r10-data-e8000:plain | 1 | PICK: mean / 0.16 / 1250 ms | 59.25 | 59.25 | 80.24 | 76.91 | 0.48 / 1.24 | 0.03 / 1.49 | 0 / 0 | 2.42 / 0.70, 60.36 |
| r10-stat-a-e12000:plain | 1 | PICK: mean / 0.03 / 100 ms | 57.83 | 57.83 | 78.16 | 81.69 | 0.48 / 0.63 | 0.02 / 0.82 | 0 / 0 | 4.11 / 1.46, 62.09 |
| r10-stat-a-e8000:plain | 1 | PICK: max / 0.07 / 250 ms | 57.46 | 57.46 | 81.18 | 78.26 | 0.37 / 0.41 | 0.08 / 0.66 | 0 / 0 | 2.64 / 0.29, 46.97 |
| r10-stat-b-e4000:plain | 1 | PICK: max / 0.07 / 250 ms | 55.74 | 55.74 | 78.96 | 78.42 | 0.30 / 0.71 | 0.32 / 1.50 | 0 / 0 | 0.79 / 0.63, 50.31 |
| r10-stat-b-e16000:plain | 1 | PICK: last / 0.07 / 1000 ms | 55.34 | 55.34 | 75.63 | 83.05 | 0.44 / 0.36 | 0.00 / 0.10 | 0 / 0 | 2.37 / 0.55, 55.29 |
| r10-stat-b-e8000:plain | 1 | PICK: max / 0.07 / 150 ms | 54.60 | 54.60 | 80.06 | 83.99 | 0.44 / 1.12 | 0.38 / 0.34 | 0 / 0 | 1.54 / 1.09, 54.68 |
| r10-data-e10000:plain | 1 | PICK: mean / 0.05 / 200 ms | 53.37 | 53.37 | 76.07 | 71.42 | 0.44 / 0.84 | 0.02 / 1.16 | 0 / 0 | 3.22 / 0.20, 54.69 |
| r10-stat-a-e16000:plain | 1 | PICK: max / 0.1 / 3000 ms | 52.97 | 52.97 | 70.60 | 72.96 | 0.43 / 0.37 | 0.00 / 0.61 | 0 / 0 | 4.06 / 0.43, 56.18 |
| r10-stat-b-e10000:plain | 1 | PICK: mean / 0.05 / 1250 ms | 51.99 | 51.99 | 72.75 | 76.60 | 0.46 / 0.22 | 0.00 / 0.31 | 0 / 0 | 1.66 / 0.22, 54.15 |
| r9-sess-b-e8000:plain | 1 | PICK: mean / 0.3 / 600 ms | 51.93 | 51.93 | 74.95 | 75.03 | 0.47 / 1.09 | 0.04 / 1.26 | 0 / 0 | 1.70 / 0.31, 35.68 |
| r10-data-e6000:plain | 1 | PICK: max / 0.1 / 600 ms | 50.28 | 50.28 | 74.06 | 71.63 | 0.43 / 0.52 | 0.08 / 1.48 | 0 / 0 | 1.50 / 0.26, 45.23 |
| r10-data-e4000:plain | 1 | PICK: mean / 0.13 / 600 ms | 49.53 | 49.53 | 71.25 | 70.32 | 0.47 / 0.52 | 0.22 / 1.49 | 0 / 0 | 2.44 / 0.21, 38.23 |
| r10-stat-a-e14000:plain | 1 | PICK: mean / 0.07 / 3000 ms | 49.36 | 49.36 | 68.01 | 70.64 | 0.40 / 0.06 | 0.00 / 0.44 | 0 / 0 | 2.82 / 0.14, 51.74 |
| r10-stat-a-e4000:plain | 1 | PICK: last / 0.02 / 150 ms | 47.83 | 47.83 | 72.79 | 71.51 | 0.07 / 0.33 | 0.11 / 1.46 | 0 / 0 | 0.56 / 0.15, 38.13 |
| r10-notch-e4000:plain | 1 | PICK: max / 0.02 / 600 ms | 33.88 | 33.88 | 57.35 | 53.25 | 0.07 / 0.15 | 0.04 / 1.48 | 0 / 0 | 1.15 / 0.16, 32.04 |

Each row is the rule's pick for one candidate (all 29 have a feasible point): worst clean and mix rows, onset medians, and the spliced row (reported only). The reference row `r9-sess-b-e8000:plain` is round 3's freeze `custom-vd-r3`.
