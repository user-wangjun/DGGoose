@echo off
chcp 65001 >nul
setlocal

rem Use the script directory as the working directory.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js first.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [INFO] Installing project dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)

echo [INFO] Starting the Goose Escape development server...
start "Goose Escape development server" cmd /k "npm run dev"

rem Give Vite a moment to start before opening the browser.
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173/"

echo [DONE] Browser opened: http://localhost:5173/
echo Close the server window to stop the development server.
exit /b 0
