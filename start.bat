@echo off
cd /d "%~dp0"
if not exist "src\index.js" (
  echo The bot's files are not here. Right click the downloaded zip, pick Extract All, then run start.bat from the extracted folder.
  pause
  exit /b 1
)
if exist "node\node.exe" set "PATH=%~dp0node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "node_modules\.package-lock.json" (
  echo Installing what the bot needs. This takes a minute the first time.
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
set ATT_BOT_LOOP=1
node src\index.js
if errorlevel 75 if not errorlevel 76 "%~f0"
pause
