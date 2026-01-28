#!/bin/bash
# Start script for combined deployment
# Both processes inherit environment variables directly

echo "Starting AI Service on port 8000..."
cd /app/ai-service
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1 &
AI_PID=$!

echo "Waiting for AI Service to be ready..."
sleep 5

echo "Starting Backend on port 3000..."
cd /app/backend
exec node dist/src/main.js
