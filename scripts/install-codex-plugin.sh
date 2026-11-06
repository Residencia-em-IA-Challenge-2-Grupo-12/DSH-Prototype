#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime/dsh
export DSH_HOME="$PWD/.runtime/dsh"
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_ignore_scripts=true
exec ./node_modules/.bin/node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add dsh-plugin-subscriptions@0.9.12
