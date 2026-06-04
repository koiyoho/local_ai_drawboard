@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "APP_URL=http://localhost:3010"
set "FORCE_SETUP=0"
set "SETUP_ONLY=0"
set "OPEN_BROWSER=1"
set "PAUSE_ON_EXIT=1"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--setup" set "FORCE_SETUP=1"
if /I "%~1"=="/setup" set "FORCE_SETUP=1"
if /I "%~1"=="--setup-only" set "SETUP_ONLY=1"
if /I "%~1"=="--rebuild-only" (
  set "FORCE_SETUP=1"
  set "SETUP_ONLY=1"
)
if /I "%~1"=="--no-browser" set "OPEN_BROWSER=0"
if /I "%~1"=="--no-pause" set "PAUSE_ON_EXIT=0"
if /I "%~1"=="--help" goto help
if /I "%~1"=="/?" goto help
shift
goto parse_args

:args_done
echo.
echo Local AI Drawboard
echo Project: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22 or newer from https://nodejs.org/ and run this file again.
  goto fail
)

node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer is required.
  node --version
  echo Install Node.js 22 or newer from https://nodejs.org/ and run this file again.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js 22 or newer and include npm.
  goto fail
)

set "NEED_SETUP=%FORCE_SETUP%"
if not exist ".env" set "NEED_SETUP=1"
if not exist "node_modules\" set "NEED_SETUP=1"
if not exist "src\generated\prisma\" set "NEED_SETUP=1"
if not exist "dist\server\server\index.js" set "NEED_SETUP=1"
if not exist ".local\cliproxy\bin\cli-proxy-api.exe" set "NEED_SETUP=1"

if "%NEED_SETUP%"=="1" (
  echo Running local setup. This may take several minutes the first time.
  call npm run setup:local
  if errorlevel 1 goto fail
) else (
  echo Existing setup found. Checking local database schema.
  call npm run db:init
  if errorlevel 1 goto fail
)

if "%SETUP_ONLY%"=="1" (
  echo.
  echo Setup complete. Run start-local.bat to start the app.
  goto done
)

echo.
echo Starting local service.
echo Open: %APP_URL%
echo Press Ctrl+C in this window to stop.
echo.

if "%OPEN_BROWSER%"=="1" (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 4; Start-Process '%APP_URL%'" >nul 2>nul
)

call npm run start:local
if errorlevel 1 goto fail

:done
echo.
echo Done.
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b 0

:help
echo.
echo Usage:
echo   start-local.bat              Setup if needed, then start the app.
echo   start-local.bat --setup      Force setup, rebuild, then start the app.
echo   start-local.bat --setup-only Setup if needed without starting.
echo   start-local.bat --rebuild-only Force setup and rebuild without starting.
echo   start-local.bat --no-browser Start without opening the browser.
echo   start-local.bat --no-pause   Exit without waiting for a key press.
echo.
exit /b 0

:fail
echo.
echo The command failed. Check the messages above.
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b 1
