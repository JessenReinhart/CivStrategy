#!/usr/bin/env bash
set -euo pipefail
ROLE="$1"
PROMPT_FILE="$2"
DIRECTION="${3:-right}"

CWD="C:/Users/LGSM228/CivStrategy"

# Step 1: Split pane (creates new shell pane, output gives pane id)
SPLIT_OUT=$(herdr pane split wF:p8 --direction "$DIRECTION" --cwd "$CWD" --no-focus)
echo "Split output: $SPLIT_OUT"
NEW_PANE_ID=$(echo "$SPLIT_OUT" | grep -oE 'wF:p[0-9]+' | head -1)

if [ -z "$NEW_PANE_ID" ]; then
  echo "Failed to extract new pane ID from split output"
  exit 1
fi

echo "Created pane $NEW_PANE_ID for $ROLE"

# Step 2: Start interactive OMP agent in that pane
# Use herdr pane run to send the launch command to the new pane shell
herdr pane run "$NEW_PANE_ID" "omp @$PROMPT_FILE"

