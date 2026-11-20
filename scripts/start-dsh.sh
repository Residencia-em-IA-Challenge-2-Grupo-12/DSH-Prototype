#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime/dsh
export DSH_HOME="$PWD/.runtime/dsh"
export DSH_PERMISSION_MODE=read-only
exec ./node_modules/.bin/node node_modules/@deepseek-ai/dsh/lib/bin.js web --patch "$PWD/dsh-study.patch.yml" --host 127.0.0.1 --port 3080 --no-open
