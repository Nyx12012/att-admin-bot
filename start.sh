#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 or newer and run this again."
  exit 1
fi
if [ ! -f .env ]; then
  echo "There is no .env file yet. Copy .env.example to .env and fill it in. SETUP.md explains each line."
  exit 1
fi
if [ ! -d node_modules/discord.js ]; then
  echo "Installing what the bot needs. This takes a minute the first time."
  npm install --omit=dev --no-fund --no-audit || exit 1
fi
exec node src/index.js
