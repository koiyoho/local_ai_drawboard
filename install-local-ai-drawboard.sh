#!/usr/bin/env sh
set -eu

REPO_URL="https://github.com/koiyoho/local_ai_drawboard.git"
REPO_MARKER="koiyoho/local_ai_drawboard"
TARGET_DIR="local_ai_drawboard"
TARGET_DIR_SET="0"
START_ARGS="--setup"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      if [ "$#" -lt 2 ]; then
        echo "[ERROR] --dir requires a folder path."
        exit 1
      fi
      TARGET_DIR="$2"
      TARGET_DIR_SET="1"
      shift 2
      ;;
    --setup-only)
      START_ARGS="$START_ARGS --setup-only"
      shift
      ;;
    --no-browser)
      START_ARGS="$START_ARGS --no-browser"
      shift
      ;;
    --help|-h)
      cat <<'HELP'

Usage:
  sh install-local-ai-drawboard.sh
  sh install-local-ai-drawboard.sh --dir ~/Apps/local_ai_drawboard
  sh install-local-ai-drawboard.sh --setup-only
  sh install-local-ai-drawboard.sh --no-browser

This installer clones or updates local_ai_drawboard, then runs start-local.sh.
After installation, use start-local.sh inside the project folder for daily startup.

HELP
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      echo "Run: sh install-local-ai-drawboard.sh --help"
      exit 1
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "[ERROR] Git was not found."
  echo "Install Git from https://git-scm.com/downloads and run this script again."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found."
  echo "Install Node.js 22 or newer from https://nodejs.org/ and run this script again."
  exit 1
fi

if ! node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)"; then
  echo "[ERROR] Node.js 22 or newer is required."
  node --version
  echo "Install Node.js 22 or newer from https://nodejs.org/ and run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found. Reinstall Node.js 22 or newer and include npm."
  exit 1
fi

if [ "$TARGET_DIR_SET" = "0" ] && [ -d ".git" ]; then
  CURRENT_ORIGIN_URL="$(git -C "." remote get-url origin 2>/dev/null || true)"
  case "$CURRENT_ORIGIN_URL" in
    *"$REPO_MARKER"*) TARGET_DIR="." ;;
  esac
fi

echo
echo "Local AI Drawboard installer"
echo "Target: $(pwd)/$TARGET_DIR"
echo

if [ -d "$TARGET_DIR" ]; then
  if [ ! -d "$TARGET_DIR/.git" ]; then
    echo "[ERROR] The target folder already exists, but it is not a Git repository:"
    echo "$(pwd)/$TARGET_DIR"
    echo "Choose another folder with --dir or move the existing folder."
    exit 1
  fi

  ORIGIN_URL="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || true)"
  if [ -z "$ORIGIN_URL" ]; then
    echo "[ERROR] The target folder has no origin remote:"
    echo "$(pwd)/$TARGET_DIR"
    exit 1
  fi

  case "$ORIGIN_URL" in
    *"$REPO_MARKER"*)
      ;;
    *)
      echo "[ERROR] The target folder is not local_ai_drawboard."
      echo "Origin: $ORIGIN_URL"
      echo "Choose another folder with --dir or move the existing folder."
      exit 1
      ;;
  esac

  echo "Updating existing project."
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning project."
  git clone "$REPO_URL" "$TARGET_DIR"
fi

echo
echo "Starting setup and local service."
# shellcheck disable=SC2086
sh "$TARGET_DIR/start-local.sh" $START_ARGS
