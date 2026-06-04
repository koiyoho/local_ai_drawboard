#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

APP_URL="http://localhost:3010"
FORCE_SETUP=0
SETUP_ONLY=0
OPEN_BROWSER=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --setup)
      FORCE_SETUP=1
      ;;
    --setup-only)
      SETUP_ONLY=1
      ;;
    --rebuild-only)
      FORCE_SETUP=1
      SETUP_ONLY=1
      ;;
    --no-browser)
      OPEN_BROWSER=0
      ;;
    --help|-h)
      cat <<'HELP'

Usage:
  sh start-local.sh                Setup if needed, then start the app.
  sh start-local.sh --setup        Force setup, rebuild, then start the app.
  sh start-local.sh --setup-only   Setup if needed without starting.
  sh start-local.sh --rebuild-only Force setup and rebuild without starting.
  sh start-local.sh --no-browser   Start without opening the browser.

HELP
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      echo "Run: sh start-local.sh --help"
      exit 1
      ;;
  esac
  shift
done

echo
echo "Local AI Drawboard"
echo "Project: $(pwd)"
echo

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

NEED_SETUP="$FORCE_SETUP"
[ -f ".env" ] || NEED_SETUP=1
[ -d "node_modules" ] || NEED_SETUP=1
[ -d "src/generated/prisma" ] || NEED_SETUP=1
[ -f "dist/server/server/index.js" ] || NEED_SETUP=1
[ -x ".local/cliproxy/bin/cli-proxy-api" ] || NEED_SETUP=1

if [ "$NEED_SETUP" = "1" ]; then
  echo "Running local setup. This may take several minutes the first time."
  npm run setup:local
else
  echo "Existing setup found. Checking local database schema."
  npm run db:init
fi

if [ "$SETUP_ONLY" = "1" ]; then
  echo
  echo "Setup complete. Run sh start-local.sh to start the app."
  exit 0
fi

echo
echo "Starting local service."
echo "Open: $APP_URL"
echo "Press Ctrl+C in this terminal to stop."
echo

if [ "$OPEN_BROWSER" = "1" ]; then
  if command -v open >/dev/null 2>&1; then
    (sleep 4 && open "$APP_URL") >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    (sleep 4 && xdg-open "$APP_URL") >/dev/null 2>&1 &
  fi
fi

npm run start:local
