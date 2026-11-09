#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 or newer and run this again."
  exit 1
fi
if [ ! -f node_modules/.package-lock.json ]; then
  echo "Installing what the bot needs. This takes a minute the first time."
  npm install --omit=dev --no-fund --no-audit || exit 1
fi
exec node src/index.js
