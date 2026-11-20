#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-web}"
if [[ "$profile" != web && "$profile" != sdk ]]; then
  printf 'Expected profile web or sdk\n' >&2
  exit 2
fi
mkdir -p .runtime/dsh
export DSH_HOME="$PWD/.runtime/dsh"
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_ignore_scripts=true
exec ./node_modules/.bin/node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile "$profile" add dsh-plugin-subscriptions@0.9.12
