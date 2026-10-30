@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist ".env" (
  echo There is no .env file yet. Copy .env.example to .env and fill it in. SETUP.md explains each line.
  pause
  exit /b 1
)
if not exist "node_modules\discord.js" (
  echo Installing what the bot needs. This takes a minute the first time.
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
node src\index.js
pause
