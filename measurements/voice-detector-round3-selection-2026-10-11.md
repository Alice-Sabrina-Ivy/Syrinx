# Custom voice-vs-machine detector — round 3 selection and freeze (2026-10-11)

Branch `voice-detector`. Step 3 of the round-3 pre-registration
([voice-detector-round3-preregistration-2026-10-07.md](voice-detector-round3-preregistration-2026-10-07.md),
§3, Addenda R3-B and R3-C): training, selection on **validation data only**,
the freeze, and the go / no-go of §3.5.

**Result: NO-GO.** The rule's choice is feasible on every validation
reading, but its objective is **O = 51.9 %**, below the 60 % that §3.5
requires before the look. Round 3 therefore stops before the look:

- the sealed confirmatory set stays sealed (no model of any round has run on
  it);
- no probability file was written for any harness or confirmatory stream;
- the private session recordings were not read (V5 runs only after a look).

The user decides what happens next (§5 below; §7 of the pre-registration).

## 1. What was trained and scored

- Four runs (Addendum R3-B.1), 16,000 steps each, reused after the pause
  (R3-C.1): `r9-leak` (B-leak), `r9-sess-a` and `r9-sess-b` (B-sess),
  `r9-sessleak` (B-sess-leak).
- 70 candidates (R3-B.3):
  - A0: r8a EMA 8,000–16,000 and r5-bighard EMA 10,000, each as `plain`,
    `mean5`, `mean10`, `old5` and `old10`;
  - B: the 20 EMA checkpoints of the four runs, each as `plain` and `old10`.
- Each candidate: the §3.2 grid (24 thresholds × 16 hangovers × 3 aggs),
  §3.3 feasibility, the §3.4 pick. 61 of the 70 have a feasible point.
- Objective O = min(tuning-194 V2, val-negatives V2, one-room validation
  sessions V2). **For every one of the 70 candidates the tuning-194 split is
  the minimum**: the best networks remove 70–75 % of the false hops on the
  validation negatives and in the one-room sessions, but at most 52 % on the
  194 tuning clips.

### Best feasible point per family

| family | copies | candidate | pick (agg / p / hangover) | O % (= tuning-194 V2) | val-negatives V2 % | one-room sessions V2 % |
|---|---|---|---|---|---|---|
| A0 r5-bighard | 2 | r5-bighard-e10000:mean5 | max / 0.05 / 1250 ms | 26.97 | 44.18 | 40.19 |
| A0 r8a | 1 | r8a-e16000:plain | last / 0.01 / 1500 ms | 30.57 | 54.05 | 66.59 |
| A0 r8a | 2 | r8a-e16000:old5 | last / 0.02 / 1000 ms | 44.10 | 62.44 | 64.42 |
| B-leak | 1 | r9-leak-e10000:plain | mean / 0.02 / 100 ms | 45.16 | 71.87 | 72.26 |
| B-leak | 2 | r9-leak-e10000:old10 | mean / 0.03 / 300 ms | 46.61 | 71.67 | 70.38 |
| B-sess (seed 32) | 1 | r9-sess-a-e8000:plain | mean / 0.2 / 3000 ms | 48.99 | 65.91 | 65.66 |
| B-sess (seed 32) | 2 | r9-sess-a-e8000:old10 | max / 0.35 / 750 ms | 45.59 | 59.84 | 47.54 |
| **B-sess (seed 33)** | **1** | **r9-sess-b-e8000:plain** | **mean / 0.3 / 600 ms** | **51.93** | **74.95** | **75.03** |
| B-sess (seed 33) | 2 | r9-sess-b-e14000:old10 | mean / 0.25 / 750 ms | 40.50 | 55.05 | 50.57 |
| B-sess-leak | 1 | r9-sessleak-e16000:plain | mean / 0.13 / 1250 ms | 44.07 | 68.23 | 71.78 |
| B-sess-leak | 2 | r9-sessleak-e14000:old10 | mean / 0.1 / 1000 ms | 45.25 | 67.84 | 67.61 |

What this shows, on validation data only:

- **One-room session training gave the best candidate, but not reliably.**
  The best candidate is seed 33 at step 8,000. The same recipe with seed 32
  reached 49.0 %. Later checkpoints of both seeds fell to 19–41 %.
- **State decay** (B-leak) beats the round-2 network.
- **Two copies no longer pay.** Two copies help the A0 networks
  (r8a: 30.6 → 44.1 %), but not the networks trained with one-room sessions.
- **None of the 70 candidates reaches 60 %.**

### Choice (§3.4)

- The largest O is r9-sess-b-e8000:plain, at 51.93 %. The next candidate
  (r9-sess-a-e8000:plain, 48.99 %) is more than 1 pp behind, so no
  tie-break applies.
- It is a single model (one run per 25 ms) with plain carried state: the GRU
  state runs from the stream start and is never reset.
- Its operating point is agg `mean`, p ≥ 0.30, hangover 600 ms.

## 2. Deployable re-check and the freeze

- **The exported model.** The checkpoint was exported to the streaming ONNX
  model (`export.py`; streaming vs batch max abs diff 5.2e-6).
- **The re-made files.** Its selection files were re-made with onnxruntime
  CPU, 1 thread, chunk by chunk, with the state carried:
  - the fresh validation streams and the tuning 194;
  - the 240 one-room validation sessions, each run as one stream;
  - round 2's spliced sessions, via `infer_carried.py` with seed 20261007.
- **The rule on those files.** The rule gives **the same pick**: mean,
  p ≥ 0.30, 600 ms, O 51.93 %. That pick is the frozen point.
- **Frozen file.** `scripts/voice-detector/train/frozen/candidate-r3.json`
  (`custom-vd-r3`):

  | item | sha256 |
  |---|---|
  | checkpoint `r9-sess-b/ckpt_ema_008000.pt` | `2e886439…ebb3c` |
  | state dict | `e0a5a9da…6e9c9` |
  | ONNX file | `1af5a357…0979b` (1,485,032 bytes, 89,257 parameters) |

  - The model and its files stay under the gitignored `build/vad-train/`.
  - The weights are MIT.
  - The training data are the round-2 training sources. Their attribution
    file is copied from round 2.

| frozen point (deployable files) | value | limit (§3.3) |
|---|---|---|
| fresh, worst clean val group (children) | 0.47 % | ≤ 0.5 % |
| fresh, worst val mix cell (lead 0, 0 dB) | 1.09 % | ≤ 1.5 % |
| one-room carried, worst clean group (children) | 0.04 % | ≤ 0.5 % |
| one-room carried, worst SNR cell (0 dB) | 1.26 % | ≤ 1.5 % |
| `frame_ms` + lookahead; median onset delay, fresh / carried | 82 ms; 0 / 0 ms | ≤ 100 ms |
| WASM, onnxruntime-web 1.30.0, 1 thread: Node / headless Chrome 154 | 0.73 / 0.85 ms per 25 ms | ≤ 2 ms |
| WASM vs ONNX CPU files, max abs diff | 1.9e-5 | — |
| **O** = min(tuning-194 51.93, val negatives 74.95, one-room sessions 75.03) | **51.93 %** | go needs ≥ 60 % |
| spliced sessions (reported): worst clean (exercises) / worst mix; tuning-194 V2 | 1.70 % / 0.31 %; 35.68 % | not gating |

- **WASM measurement.** The desktop WASM figures were measured on a shared
  machine under load (i9-11900K). The Chrome run used a temporary
  `--user-data-dir` and was closed by its own PID.
- **Phone estimate.** By the benchmark's desktop:mobile ratios (2.4–4.5×),
  this gives about **1.8–3.8 ms per 25 ms on a phone**. This is an estimate,
  not a measurement.
- **Commit order.** The freeze is committed and pushed in the same commit as
  this note. The look's runner (`VAD_R3_LOOK=1`) was never started.

## 3. Go / no-go (§3.5)

| condition | result |
|---|---|
| frozen point feasible (§3.3, incl. V3 and V4) | yes |
| O ≥ 60 % | **no — 51.93 %** |
| **decision** | **no-go: no look; the seal stays unbroken** |

## 4. Departures and process notes

- **Tuning audio.** The tuning-194 audio was lost with the notch worktree.
  It was restored and verified byte-identical through the production chain
  before any B network was scored (Addendum R3-C.2).
- **Two rule passes.** The rule ran in two passes with the same code: A0,
  then B. The A0 output file name matched round 3's earlier file, because
  Windows file names ignore case, so the earlier r5-bighard-e10000 entries
  were reused. Those five candidates were then re-scored with `--force`,
  with identical results.
- **Bug fixed during the re-check.** `opselect_r3.py`'s mode for files with
  the rule already applied (`DIR:file`) parsed as `plain` and looked for
  per-variant subfolders. This was fixed before the re-check produced any
  number.
- **Trills (Q2).** The trills question is still open. It has no effect on a
  no-go.

## 5. For the user

Round 3 stops here, as the pre-registration says.

**Why it stopped.** The binding constraint is the old tuning split of 194
noise clips (MS-SNSD, DEMAND, DCASE 2020 dev, Freesound fans / fridges /
hums). No candidate removes more than 52 % of the false pitch on those clips
while keeping voices safe on validation. On the validation negatives and the
realistic one-room sessions, the chosen network removes about 75 %.

**Options**, none taken without the user's decision:

1. **Stop the custom-detector line here.** The confirmatory set stays sealed
   for later use.
2. **A pre-registered round 4 aimed at the tuning-split noise types.** For
   example, more stationary hum / fan / fridge negatives in training. It would
   be judged on the same sealed set, which is still unseen.
3. **A bar decision.** For example, an O threshold or objective that does
   not rest on the 194-clip split alone. This is a change to the bar,
   decided by the user, and it would be recorded as such before any look.

## 6. Full selection table (validation only; torch files; R3-B.4)

Each row is the rule's pick for one candidate: worst clean and mix rows,
onset medians, and the spliced row (reported only). A "fallback" row has no
feasible point and shows its best-ratio point instead.

| candidate | copies | pick (agg / p / hangover) | O % | tune-194 V2 % | vneg V2 % | vsess V2 % | fresh worst clean / mix % | vsess worst clean / mix % | onset median fresh / vsess ms | spliced worst clean / mix %, tune V2 % |
|---|---|---|---|---|---|---|---|---|---|---|
| **r9-sess-b-e8000:plain** | 1 | PICK: mean / 0.3 / 600 ms | 51.93 | 51.93 | 74.95 | 75.03 | 0.47 / 1.09 | 0.04 / 1.26 | 0 / 0 | 1.70 / 0.31, 35.68 |
| r9-sess-a-e8000:plain | 1 | PICK: mean / 0.2 / 3000 ms | 48.99 | 48.99 | 65.91 | 65.66 | 0.48 / 0.34 | 0.11 / 0.54 | 0 / 0 | 0.82 / 0.76, 52.38 |
| r9-leak-e10000:old10 | 2 | PICK: mean / 0.03 / 300 ms | 46.61 | 46.61 | 71.67 | 70.38 | 0.07 / 0.81 | 0.23 / 1.45 | 0 / 0 | 0.71 / 0.86, 48.27 |
| r9-sess-a-e8000:old10 | 2 | PICK: max / 0.35 / 750 ms | 45.59 | 45.59 | 59.84 | 47.54 | 0.48 / 1.24 | 0.29 / 0.86 | 0 / 0 | 1.15 / 1.11, 32.67 |
| r9-sessleak-e14000:old10 | 2 | PICK: mean / 0.1 / 1000 ms | 45.25 | 45.25 | 67.84 | 67.61 | 0.45 / 1.36 | 0.36 / 1.42 | 0 / 0 | 0.78 / 1.48, 44.96 |
| r9-leak-e10000:plain | 1 | PICK: mean / 0.02 / 100 ms | 45.16 | 45.16 | 71.87 | 72.26 | 0.10 / 0.76 | 0.49 / 1.42 | 0 / 0 | 0.87 / 0.76, 47.43 |
| r9-leak-e12000:plain | 1 | PICK: mean / 0.05 / 2000 ms | 44.99 | 44.99 | 66.89 | 70.01 | 0.47 / 0.89 | 0.15 / 1.30 | 0 / 0 | 0.61 / 0.90, 47.73 |
| r9-leak-e12000:old10 | 2 | PICK: mean / 0.05 / 2000 ms | 44.62 | 44.62 | 65.74 | 66.14 | 0.43 / 0.89 | 0.13 / 1.15 | 0 / 0 | 0.62 / 0.80, 46.44 |
| r9-leak-e14000:plain | 1 | PICK: max / 0.05 / 2000 ms | 44.62 | 44.62 | 64.60 | 69.66 | 0.47 / 1.46 | 0.49 / 1.30 | 0 / 0 | 0.73 / 1.47, 48.55 |
| r8a-e16000:old5 | 2 | PICK: last / 0.02 / 1000 ms | 44.10 | 44.10 | 62.44 | 64.42 | 0.40 / 1.50 | 0.36 / 1.07 | 0 / 0 | 1.23 / 1.61, 49.75 |
| r9-sessleak-e16000:old10 | 2 | PICK: mean / 0.13 / 1000 ms | 44.09 | 44.09 | 67.37 | 64.60 | 0.42 / 1.34 | 0.35 / 0.67 | 0 / 0 | 0.95 / 1.35, 41.92 |
| r9-sessleak-e16000:plain | 1 | PICK: mean / 0.13 / 1250 ms | 44.07 | 44.07 | 68.23 | 71.78 | 0.41 / 1.25 | 0.10 / 0.71 | 0 / 0 | 0.78 / 1.24, 43.30 |
| r8a-e12000:mean10 | 2 | PICK: max / 0.03 / 400 ms | 44.05 | 44.05 | 62.68 | 64.72 | 0.39 / 0.82 | 0.44 / 1.24 | 0 / 0 | 1.94 / 1.69, 47.76 |
| r9-leak-e14000:old10 | 2 | PICK: max / 0.05 / 2000 ms | 43.49 | 43.49 | 63.51 | 65.35 | 0.45 / 1.38 | 0.42 / 1.06 | 0 / 0 | 0.77 / 1.44, 46.26 |
| r9-sessleak-e12000:plain | 1 | PICK: mean / 0.1 / 750 ms | 43.38 | 43.38 | 70.91 | 72.56 | 0.44 / 1.49 | 0.20 / 1.25 | 0 / 0 | 0.80 / 1.49, 43.24 |
| r9-sessleak-e12000:old10 | 2 | PICK: mean / 0.1 / 750 ms | 43.20 | 43.20 | 69.29 | 66.34 | 0.44 / 1.45 | 0.34 / 1.14 | 0 / 0 | 0.85 / 1.50, 41.90 |
| r8a-e16000:mean5 | 2 | PICK: mean / 0.03 / 250 ms | 43.13 | 43.13 | 62.77 | 59.27 | 0.45 / 0.69 | 0.46 / 1.23 | 0 / 0 | 1.08 / 1.34, 44.97 |
| r9-leak-e8000:old10 | 2 | PICK: last / 0.07 / 3000 ms | 42.80 | 42.80 | 63.58 | 65.39 | 0.40 / 0.74 | 0.39 / 1.37 | 0 / 0 | 0.65 / 0.74, 43.55 |
| r9-sessleak-e14000:plain | 1 | PICK: mean / 0.1 / 1500 ms | 42.57 | 42.57 | 65.31 | 70.31 | 0.31 / 1.05 | 0.12 / 1.49 | 0 / 0 | 0.61 / 1.05, 42.73 |
| r8a-e10000:mean10 | 2 | PICK: max / 0.03 / 500 ms | 42.36 | 42.36 | 61.86 | 64.52 | 0.46 / 0.78 | 0.46 / 1.37 | 0 / 0 | 1.24 / 1.61, 48.01 |
| r9-sess-a-e12000:old10 | 2 | PICK: mean / 0.35 / 2000 ms | 40.83 | 40.83 | 53.16 | 42.70 | 0.50 / 0.91 | 0.36 / 0.38 | 0 / 0 | 1.03 / 1.01, 26.83 |
| r9-sessleak-e10000:old10 | 2 | PICK: mean / 0.1 / 1250 ms | 40.82 | 40.82 | 63.53 | 63.66 | 0.29 / 1.46 | 0.34 / 1.18 | 0 / 0 | 0.68 / 1.43, 39.24 |
| r9-sessleak-e10000:plain | 1 | PICK: mean / 0.1 / 1250 ms | 40.82 | 40.82 | 64.83 | 67.04 | 0.35 / 1.44 | 0.11 / 1.31 | 0 / 0 | 0.66 / 1.44, 39.11 |
| r8a-e14000:mean10 | 2 | PICK: mean / 0.02 / 500 ms | 40.80 | 40.80 | 58.26 | 59.81 | 0.47 / 0.70 | 0.39 / 0.99 | 0 / 0 | 1.40 / 1.72, 44.92 |
| r9-sess-b-e14000:old10 | 2 | PICK: mean / 0.25 / 750 ms | 40.50 | 40.50 | 55.05 | 50.57 | 0.50 / 0.97 | 0.10 / 0.35 | 0 / 0 | 2.66 / 0.75, 30.14 |
| r9-sess-b-e8000:old10 | 2 | PICK: max / 0.45 / 600 ms | 40.24 | 40.24 | 56.17 | 50.89 | 0.44 / 0.83 | 0.47 / 0.33 | 0 / 0 | 1.76 / 0.94, 27.42 |
| r8a-e14000:mean5 | 2 | PICK: max / 0.03 / 300 ms | 39.53 | 39.53 | 57.99 | 55.69 | 0.39 / 0.55 | 0.46 / 1.00 | 0 / 0 | 0.79 / 1.01, 41.72 |
| r8a-e14000:old5 | 2 | PICK: mean / 0.01 / 500 ms | 39.41 | 39.41 | 58.46 | 59.92 | 0.43 / 1.50 | 0.34 / 0.95 | 0 / 0 | 1.43 / 1.59, 45.65 |
| r8a-e8000:mean10 | 2 | PICK: max / 0.05 / 1250 ms | 39.33 | 39.33 | 57.84 | 58.79 | 0.49 / 0.71 | 0.30 / 0.90 | 0 / 0 | 0.78 / 1.67, 43.26 |
| r8a-e16000:mean10 | 2 | PICK: last / 0.03 / 1000 ms | 38.98 | 38.98 | 58.19 | 59.43 | 0.47 / 0.70 | 0.27 / 0.92 | 0 / 0 | 1.11 / 1.62, 42.92 |
| r9-sess-a-e12000:plain | 1 | PICK: last / 0.1 / 3000 ms | 38.47 | 38.47 | 57.66 | 56.01 | 0.50 / 0.38 | 0.03 / 0.19 | 0 / 0 | 0.47 / 0.25, 37.09 |
| r9-sess-b-e16000:old10 | 2 | PICK: max / 0.2 / 400 ms | 37.89 | 37.89 | 54.63 | 49.71 | 0.50 / 0.92 | 0.14 / 0.39 | 0 / 0 | 2.77 / 0.62, 27.60 |
| r9-sess-b-e12000:old10 | 2 | PICK: max / 0.35 / 1500 ms | 37.63 | 37.63 | 54.17 | 48.23 | 0.50 / 1.23 | 0.12 / 0.28 | 0 / 0 | 2.29 / 1.01, 27.58 |
| r9-sessleak-e8000:plain | 1 | PICK: mean / 0.05 / 150 ms | 37.44 | 37.44 | 63.52 | 59.44 | 0.42 / 1.36 | 0.07 / 1.15 | 0 / 0 | 0.84 / 1.35, 36.38 |
| r9-sessleak-e8000:old10 | 2 | PICK: max / 0.05 / 100 ms | 36.88 | 36.88 | 62.73 | 56.59 | 0.40 / 1.45 | 0.29 / 1.07 | 0 / 0 | 1.00 / 1.38, 35.79 |
| r9-leak-e8000:plain | 1 | PICK: last / 0.05 / 3000 ms | 35.92 | 35.92 | 58.62 | 59.51 | 0.43 / 0.53 | 0.31 / 0.83 | 0 / 0 | 0.47 / 0.53, 38.27 |
| r9-sess-a-e14000:old10 | 2 | PICK: last / 0.25 / 750 ms | 35.91 | 35.91 | 49.20 | 40.60 | 0.50 / 0.82 | 0.06 / 0.34 | 0 / 0 | 1.87 / 0.70, 21.23 |
| r9-sess-b-e10000:old10 | 2 | PICK: mean / 0.2 / 1250 ms | 35.27 | 35.27 | 50.09 | 44.64 | 0.50 / 0.77 | 0.08 / 0.30 | 0 / 0 | 1.71 / 0.81, 22.77 |
| r8a-e8000:mean5 | 2 | PICK: mean / 0.03 / 400 ms | 34.90 | 34.90 | 55.73 | 52.02 | 0.35 / 0.59 | 0.49 / 0.73 | 0 / 0 | 0.56 / 1.11, 36.62 |
| r9-sess-a-e10000:plain | 1 | PICK: max / 0.16 / 2000 ms | 33.47 | 33.47 | 55.09 | 61.86 | 0.49 / 0.32 | 0.36 / 0.54 | 0 / 0 | 1.02 / 0.18, 34.87 |
| r8a-e16000:old10 | 2 | PICK: last / 0.01 / 1500 ms | 33.28 | 33.28 | 54.49 | 61.26 | 0.47 / 0.87 | 0.17 / 0.36 | 0 / 0 | 1.04 / 1.51, 43.79 |
| r9-sess-a-e16000:plain | 1 | PICK: max / 0.07 / 2000 ms | 33.25 | 33.25 | 55.77 | 57.21 | 0.44 / 0.43 | 0.00 / 0.35 | 0 / 0 | 0.93 / 0.17, 34.93 |
| r9-sess-a-e14000:plain | 1 | PICK: last / 0.1 / 2000 ms | 33.20 | 33.20 | 55.72 | 58.63 | 0.49 / 0.56 | 0.00 / 0.49 | 0 / 0 | 1.23 / 0.19, 36.83 |
| r8a-e10000:mean5 | 2 | PICK: last / 0.03 / 750 ms | 31.72 | 31.72 | 52.25 | 50.60 | 0.20 / 0.42 | 0.48 / 0.74 | 0 / 0 | 0.41 / 0.77, 33.24 |
| r8a-e12000:mean5 | 2 | PICK: mean / 0.02 / 400 ms | 31.16 | 31.16 | 50.19 | 48.97 | 0.22 / 0.42 | 0.39 / 0.38 | 0 / 0 | 0.63 / 0.67, 32.72 |
| r8a-e16000:plain | 1 | PICK: last / 0.01 / 1500 ms | 30.57 | 30.57 | 54.05 | 66.59 | 0.47 / 0.88 | 0.49 / 1.27 | 0 / 0 | 1.40 / 3.20, 57.85 |
| r9-leak-e16000:plain | 1 | PICK: max / 0.02 / 2000 ms | 29.78 | 29.78 | 51.87 | 54.23 | 0.39 / 1.50 | 0.08 / 0.35 | 0 / 0 | 0.57 / 1.51, 36.76 |
| r9-leak-e16000:old10 | 2 | PICK: max / 0.02 / 2000 ms | 28.19 | 28.19 | 50.21 | 48.00 | 0.38 / 1.50 | 0.06 / 0.25 | 0 / 0 | 0.55 / 1.48, 32.78 |
| r8a-e14000:plain | 1 | PICK: last / 0.01 / 2000 ms | 27.74 | 27.74 | 51.25 | 65.20 | 0.20 / 0.70 | 0.44 / 1.49 | 0 / 0 | 1.19 / 2.94, 56.31 |
| r9-sess-a-e10000:old10 | 2 | PICK: last / 0.16 / 400 ms | 27.70 | 27.70 | 40.34 | 35.97 | 0.48 / 0.67 | 0.38 / 0.09 | 0 / 0 | 1.12 / 0.49, 16.17 |
| r5-bighard-e10000:mean5 | 2 | PICK: max / 0.05 / 1250 ms | 26.97 | 26.97 | 44.18 | 40.19 | 0.45 / 0.18 | 0.49 / 0.64 | 0 / 0 | 0.56 / 0.54, 25.79 |
| r9-sess-b-e10000:plain | 1 | PICK: mean / 0.05 / 1250 ms | 26.51 | 26.51 | 50.43 | 48.80 | 0.48 / 1.41 | 0.00 / 0.08 | 0 / 0 | 0.68 / 0.24, 25.57 |
| r8a-e12000:plain | 1 | PICK: mean / 0.01 / 3000 ms | 23.97 | 23.97 | 45.98 | 62.47 | 0.18 / 0.37 | 0.43 / 1.28 | 0 / 0 | 1.08 / 1.93, 52.99 |
| r8a-e8000:plain | 1 | PICK: mean / 0.01 / 2000 ms | 23.07 | 23.07 | 45.67 | 58.51 | 0.19 / 0.29 | 0.46 / 1.41 | 0 / 0 | 1.15 / 1.17, 51.71 |
| r9-sess-a-e16000:old10 | 2 | PICK: last / 0.1 / 1500 ms | 22.82 | 22.82 | 36.55 | 29.98 | 0.49 / 0.25 | 0.00 / 0.05 | 0 / 0 | 0.60 / 0.36, 13.25 |
| r8a-e10000:plain | 1 | PICK: mean / 0.01 / 3000 ms | 22.81 | 22.81 | 45.11 | 61.39 | 0.23 / 0.36 | 0.42 / 1.15 | 0 / 0 | 1.04 / 1.86, 50.22 |
| r9-sess-b-e14000:plain | 1 | PICK: max / 0.05 / 750 ms | 22.73 | 22.73 | 47.80 | 48.46 | 0.50 / 1.37 | 0.00 / 0.22 | 0 / 0 | 0.91 / 0.19, 28.26 |
| r9-sess-b-e16000:plain | 1 | PICK: last / 0.05 / 1250 ms | 20.89 | 20.89 | 45.21 | 46.21 | 0.49 / 1.24 | 0.00 / 0.34 | 0 / 0 | 0.76 / 0.14, 28.57 |
| r9-sess-b-e12000:plain | 1 | PICK: last / 0.05 / 1000 ms | 18.95 | 18.95 | 46.76 | 45.78 | 0.33 / 1.48 | 0.00 / 0.29 | 0 / 0 | 0.75 / 0.19, 25.20 |
| r5-bighard-e10000:mean10 | 2 | PICK: mean / 0.01 / 1250 ms | 16.03 | 16.03 | 35.22 | 31.35 | 0.30 / 0.54 | 0.49 / 0.18 | 0 / 0 | 0.47 / 0.49, 18.77 |
| r5-bighard-e10000:old5 | 2 | PICK: mean / 0.01 / 3000 ms | 12.69 | 12.69 | 29.94 | 26.53 | 0.33 / 0.08 | 0.49 / 0.35 | 0 / 0 | 0.42 / 0.17, 15.72 |
| r8a-e12000:old10 | 2 | fallback (no feasible point): last / 0.01 / 400 ms | 41.51 | 41.51 | 62.93 | 69.87 | 0.62 / 1.10 | 0.67 / 1.07 | 0 / 0 | 2.79 / 2.05, 51.37 |
| r8a-e10000:old10 | 2 | fallback (no feasible point): last / 0.01 / 400 ms | 40.81 | 40.81 | 61.82 | 70.33 | 0.54 / 1.10 | 0.67 / 1.31 | 0 / 0 | 1.95 / 1.63, 51.94 |
| r8a-e10000:old5 | 2 | fallback (no feasible point): last / 0.01 / 300 ms | 39.81 | 39.81 | 60.46 | 62.49 | 0.26 / 1.70 | 0.67 / 1.06 | 0 / 0 | 1.63 / 1.78, 45.63 |
| r8a-e8000:old10 | 2 | fallback (no feasible point): last / 0.01 / 300 ms | 37.51 | 37.51 | 60.01 | 65.02 | 0.66 / 0.77 | 0.67 / 0.83 | 0 / 0 | 1.93 / 1.02, 49.84 |
| r8a-e14000:old10 | 2 | fallback (no feasible point): last / 0.01 / 1000 ms | 36.49 | 36.49 | 58.42 | 65.74 | 0.53 / 1.03 | 0.54 / 0.61 | 0 / 0 | 1.45 / 2.13, 47.35 |
| r8a-e8000:old5 | 2 | fallback (no feasible point): last / 0.01 / 300 ms | 33.34 | 33.34 | 55.83 | 55.27 | 0.50 / 1.30 | 0.56 / 0.87 | 0 / 0 | 1.41 / 1.52, 39.85 |
| r8a-e12000:old5 | 2 | fallback (no feasible point): last / 0.01 / 750 ms | 31.76 | 31.76 | 52.51 | 54.83 | 0.22 / 1.46 | 0.67 / 0.56 | 0 / 0 | 0.98 / 1.48, 38.02 |
| r5-bighard-e10000:plain | 1 | fallback (no feasible point): max / 0.01 / 3000 ms | 28.09 | 28.09 | 44.64 | 58.83 | 0.37 / 0.55 | 6.43 / 1.79 | 0 / 0 | 1.13 / 1.26, 57.28 |
| r5-bighard-e10000:old10 | 2 | fallback (no feasible point): max / 0.01 / 3000 ms | 18.48 | 18.48 | 39.66 | 38.89 | 0.35 / 0.25 | 0.83 / 0.40 | 0 / 0 | 0.51 / 0.38, 26.40 |
