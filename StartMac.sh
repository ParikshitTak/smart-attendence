#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "============================================"
echo "  Smart Attendance - starting server"
echo "============================================"
if [ ! -d node_modules ]; then
  echo "node_modules not found. Running npm install..."
  npm install
fi
echo
echo "LAN IP addresses (use one from your phone):"
if command -v ip >/dev/null 2>&1; then
  ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}'
else
  ifconfig | grep "inet " | grep -v 127.0.0.1
fi
echo
echo "Server URL: http://localhost:3000"
echo "Press Ctrl+C to stop."
echo
npm start