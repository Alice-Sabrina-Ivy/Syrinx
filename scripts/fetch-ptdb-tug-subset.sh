#!/usr/bin/env bash
# fetch-ptdb-tug-subset.sh — Download a subset of the PTDB-TUG corpus
# (Pirker et al. 2011, Graz Univ. of Technology) for Stage 2.B real-world
# regression testing. The full 3.9 GB archive is overkill for our use; we
# pull 4 speakers × 45 SX sentences × {MIC, REF} = 360 files (~140 MB).
#
# License: PTDB-TUG is released under the Open Database License + Database
# Contents License (Open Data Commons). Citation:
#   G. Pirker, M. Wohlmayr, S. Petrik, F. Pernkopf,
#   "A Pitch Tracking Corpus with Evaluation on Multipitch Tracking
#    Scenario", Interspeech 2011.
#
# Output: tests/dsp/data/ptdb-tug/{FEMALE,MALE}/{MIC,REF}/{F,M}NN/<files>
# Audio is gitignored (see tests/dsp/data/ptdb-tug/.gitignore).

set -euo pipefail

BASE_URL="http://www2.spsc.tugraz.at/databases/PTDB-TUG/SPEECH%20DATA"
DEST="tests/dsp/data/ptdb-tug"

mkdir -p "$DEST"

# Speakers to fetch — first 2 of each gender. Each PTDB-TUG speaker has a
# UNIQUE SX index range (the SX sentences are partitioned across speakers,
# not shared). Indices verified against the upstream directory listing.
declare -A SPEAKER_SX_START=(
  [F01]=3  [F02]=48
  [M01]=3  [M02]=48
)
declare -A SPEAKER_SX_END=(
  [F01]=47 [F02]=92
  [M01]=47 [M02]=92
)
SPEAKERS_F=("F01" "F02")
SPEAKERS_M=("M01" "M02")

fetch_speaker() {
  local gender_dir="$1"  # FEMALE or MALE
  local speaker="$2"     # F01, M01, ...
  local mic_dir="$DEST/$gender_dir/MIC/$speaker"
  local ref_dir="$DEST/$gender_dir/REF/$speaker"
  mkdir -p "$mic_dir" "$ref_dir"
  local first="${SPEAKER_SX_START[$speaker]}"
  local last="${SPEAKER_SX_END[$speaker]}"

  for sx in $(seq "$first" "$last"); do
    local mic_url="$BASE_URL/$gender_dir/MIC/$speaker/mic_${speaker}_sx${sx}.wav"
    local ref_url="$BASE_URL/$gender_dir/REF/$speaker/ref_${speaker}_sx${sx}.f0"
    local mic_path="$mic_dir/mic_${speaker}_sx${sx}.wav"
    local ref_path="$ref_dir/ref_${speaker}_sx${sx}.f0"
    [ -f "$mic_path" ] || curl -sSfL -o "$mic_path" "$mic_url"
    [ -f "$ref_path" ] || curl -sSfL -o "$ref_path" "$ref_url"
  done
  echo "  $gender_dir/$speaker: $((last - first + 1)) files done"
}

echo "Fetching PTDB-TUG SX subset (~140 MB total)…"
for sp in "${SPEAKERS_F[@]}"; do fetch_speaker "FEMALE" "$sp"; done
for sp in "${SPEAKERS_M[@]}"; do fetch_speaker "MALE" "$sp"; done
echo "Done."
