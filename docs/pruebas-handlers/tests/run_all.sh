#!/usr/bin/env bash
# Run all test suites or a specific one
# Usage: ./run_all.sh         (all)
#        ./run_all.sh 01      (only register_transaction)
#        ./run_all.sh 03 07   (manage_transactions + anti_regression)
set -euo pipefail

DIR="$(dirname "$0")"

if [ $# -eq 0 ]; then
  SUITES=(01 02 03 04 05 06 07)
else
  SUITES=("$@")
fi

for s in "${SUITES[@]}"; do
  FILE=$(ls "$DIR"/${s}_*.sh 2>/dev/null | head -1)
  if [ -z "$FILE" ]; then
    echo "Suite $s not found"
    continue
  fi
  echo ""
  echo "════════════════════════════════════════"
  echo "  Running: $(basename "$FILE")"
  echo "════════════════════════════════════════"
  bash "$FILE"
  echo ""
done

echo "ALL SUITES COMPLETED"
