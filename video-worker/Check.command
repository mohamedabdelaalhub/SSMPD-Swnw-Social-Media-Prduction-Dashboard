#!/bin/zsh
set -e
SCRIPT_DIR="${0:A:h}"
python3 "$SCRIPT_DIR/worker.py" --check
echo
read "?اضغط Enter للإغلاق..."
