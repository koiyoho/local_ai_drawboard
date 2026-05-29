@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_URL=https://github.com/koiyoho/local_ai_drawboard.git"
set "REPO_MARKER=koiyoho/local_ai_drawboard"
set "TARGET_DIR=local_ai_drawboard"
set "START_ARGS=--setup"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--dir" (
  if "%~2"=="" (
    echo [ERROR] --dir requires a folder path.
    exit /b 1
  )
  set "TARGET_DIR=%~2"
  shift
  shift
  goto parse_args
)
if /I "%~1"=="--setup-only" (
  set "START_ARGS=%START_ARGS% --setup-only"
  shift
  goto parse_args
)
if /I "%~1"=="--no-browser" (
  set "START_ARGS=%START_ARGS% --no-browser"
  shift
  goto parse_args
)
if /I "%~1"=="--no-pause" (
  set "START_ARGS=%START_ARGS% --no-pause"
  shift
  goto parse_args
)
if /I "%~1"=="--help" goto help
if /I "%~1"=="/?" goto help

echo [ERROR] Unknown option: %~1
echo Run: install-local-ai-drawboard.bat --help
exit /b 1

:args_done
for %%I in ("%TARGET_DIR%") do set "TARGET_DISPLAY=%%~fI"

echo.
echo Local AI Drawboard installer
echo Target: %TARGET_DISPLAY%
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git was not found.
  echo Install Git from https://git-scm.com/downloads and run this file again.
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22 or newer from https://nodejs.org/ and run this file again.
  exit /b 1
)

node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 22 or newer is required.
  node --version
  echo Install Node.js 22 or newer from https://nodejs.org/ and run this file again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js 22 or newer and include npm.
  exit /b 1
)

if exist "%TARGET_DIR%\" (
  if not exist "%TARGET_DIR%\.git\" (
    echo [ERROR] The target folder already exists, but it is not a Git repository:
    echo %TARGET_DISPLAY%
    echo Choose another folder with --dir or move the existing folder.
    exit /b 1
  )

  set "ORIGIN_URL="
  for /f "delims=" %%R in ('git -C "%TARGET_DIR%" remote get-url origin 2^>nul') do set "ORIGIN_URL=%%R"
  if not defined ORIGIN_URL (
    echo [ERROR] The target folder has no origin remote:
    echo %TARGET_DISPLAY%
    exit /b 1
  )

  echo(!ORIGIN_URL! | findstr /I /C:"%REPO_MARKER%" >nul
  if errorlevel 1 (
    echo [ERROR] The target folder is not local_ai_drawboard.
    echo Origin: !ORIGIN_URL!
    echo Choose another folder with --dir or move the existing folder.
    exit /b 1
  )

  echo Updating existing project.
  git -C "%TARGET_DIR%" pull --ff-only
  if errorlevel 1 exit /b 1
) else (
  echo Cloning project.
  git clone "%REPO_URL%" "%TARGET_DIR%"
  if errorlevel 1 exit /b 1
)

echo.
echo Starting setup and local service.
call "%TARGET_DIR%\start-local.bat" %START_ARGS%
exit /b %ERRORLEVEL%

:help
echo.
echo Usage:
echo   install-local-ai-drawboard.bat
echo   install-local-ai-drawboard.bat --dir D:\Apps\local_ai_drawboard
echo   install-local-ai-drawboard.bat --setup-only
echo   install-local-ai-drawboard.bat --no-browser
echo.
echo This installer clones or updates local_ai_drawboard, then runs start-local.bat.
echo After installation, use start-local.bat inside the project folder for daily startup.
echo.
exit /b 0
