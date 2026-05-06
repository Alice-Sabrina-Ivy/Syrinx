#!/usr/bin/env bash
# fetch-fda-subset.sh — Fetches the CSTR FDA evaluation database for
# pitch-detector regression testing.
#
# What this corpus provides:
#   50 sentences × 2 speakers (RL = male, SB = female) of connected English
#   speech with laryngograph-derived F0 ground truth (gold standard, same
#   methodology as PTDB-TUG). Coverage of sub-90 Hz fundamentals on the
#   male speaker (RL: min 60 Hz, p1 68 Hz, p5 88 Hz on connected speech)
#   that's the strongest available oracle for the low-pitch regime
#   Hillenbrand and Vocadito don't fully cover.
#
#   Citation when used in publications:
#     P.C. Bagshaw, "Automatic prosodic analysis for computer aided
#     pronunciation teaching", PhD thesis, University of Edinburgh, 1994.
#
# License situation:
#   The corpus README has no explicit license header. CSTR Edinburgh has
#   freely distributed the archive for 30+ years for the express purpose
#   of evaluating pitch-determination algorithms. The fetch-on-demand
#   pattern keeps Syrinx clear of redistribution liability — users
#   download directly from the original CSTR URL rather than from a
#   Syrinx-hosted mirror. Syrinx commits no audio or .fx files; only
#   the test runner that consumes them. If you are integrating FDA into
#   a published work, contact CSTR Edinburgh for any required license
#   clarification beyond the implicit free-distribution-for-evaluation
#   the corpus has carried since 1994.
#
# Output:
#   tests/dsp/data/fda/{rl,sb}/*.{sig,fx}  (audio + F0 ground truth)
#   tests/dsp/data/fda/UPSTREAM_README     (upstream README from the archive)
#   tests/dsp/data/fda/orthographic.index  (sentence transcriptions)
#
#   .lar (laryngograph waveform), src/, and man/ are not extracted —
#   we only need .sig (audio) and .fx (F0 contour) for evaluation.

set -euo pipefail

URL="https://www.cstr.ed.ac.uk/research/projects/fda/fda_eval.tar.gz"
DEST="tests/dsp/data/fda"
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Fetching CSTR FDA evaluation database from $URL ..."
curl -sSfL -o "$TMPDIR/fda_eval.tar.gz" "$URL"
echo "Extracting to $DEST ..."
tar -xzf "$TMPDIR/fda_eval.tar.gz" -C "$TMPDIR"

mkdir -p "$DEST/rl" "$DEST/sb"
cp "$TMPDIR/rl/"*.sig "$DEST/rl/"
cp "$TMPDIR/rl/"*.fx  "$DEST/rl/"
cp "$TMPDIR/sb/"*.sig "$DEST/sb/"
cp "$TMPDIR/sb/"*.fx  "$DEST/sb/"
cp "$TMPDIR/README" "$DEST/UPSTREAM_README"
cp "$TMPDIR/orthographic.index" "$DEST/orthographic.index"

rl_count=$(ls "$DEST/rl" | wc -l)
sb_count=$(ls "$DEST/sb" | wc -l)
echo "Done. $DEST/rl: $rl_count files; $DEST/sb: $sb_count files"
