#!/usr/bin/env bash
# First run on a fresh mount: install dependencies. Then run whatever was asked (default: npm run dev).
set -e
cd /app
git config --global --add safe.directory /app 2>/dev/null || true
if [ ! -f package.json ]; then
  echo "No repo at /app. Mount the mimicTV checkout there (see docs/unraid.md)." >&2
  exit 1
fi
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies..."
  npm install --no-audit --no-fund
fi
exec "$@"
