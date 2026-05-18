#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

python3 -m venv .venv-bgremove
.venv-bgremove/bin/python -m pip install --upgrade pip setuptools wheel
.venv-bgremove/bin/python -m pip install rembg onnxruntime pillow numpy

echo "AI background removal environment ready at .venv-bgremove"
