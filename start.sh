#!/bin/bash
set -e

# Internal port for the API server (localhost only)
API_INTERNAL_PORT=${API_INTERNAL_PORT:-7070}

# API server runs on internal port
PORT=$API_INTERNAL_PORT node --enable-source-maps artifacts/artifacts/api-server/dist/index.cjs &
API_PID=$!

# Webmail server runs on Railway's PORT, proxies /api/* to localhost
PORT=${PORT:-3000} API_ORIGIN=http://127.0.0.1:$API_INTERNAL_PORT \
  node artifacts/artifacts/webmail/server.mjs &
WEBMAIL_PID=$!

trap "kill $API_PID $WEBMAIL_PID 2>/dev/null; exit" SIGTERM SIGINT
wait