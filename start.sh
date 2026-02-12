#!/bin/bash
# TrendRadar Dashboard Auto-Start Script
# Add to ~/.bashrc for auto-start: source ~/claude-code-guide/tools/trendradar-dashboard/start.sh

DASHBOARD_DIR="$HOME/claude-code-guide/tools/trendradar-dashboard"
PORT=4444

# Check if already running
if lsof -i :$PORT > /dev/null 2>&1; then
  echo "TrendRadar Dashboard already running on port $PORT"
else
  echo "Starting TrendRadar Dashboard on port $PORT..."
  cd "$DASHBOARD_DIR"
  npm install --silent 2>/dev/null
  nohup npm start > /tmp/trendradar-dashboard.log 2>&1 &
  sleep 2
  if lsof -i :$PORT > /dev/null 2>&1; then
    echo "TrendRadar Dashboard started: http://localhost:$PORT"
  else
    echo "Failed to start. Check /tmp/trendradar-dashboard.log"
  fi
fi
