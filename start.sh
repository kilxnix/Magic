#!/bin/bash

# MTG Deck Generator - Startup Script
# Handles venv setup and starts both backend and frontend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== MTG Deck Generator ===${NC}"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv "$VENV_DIR"
fi

# Activate venv
echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Install backend dependencies if needed
if [ ! -f "$VENV_DIR/.deps_installed" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    pip install --upgrade pip
    pip install -r "$BACKEND_DIR/requirements.txt"
    touch "$VENV_DIR/.deps_installed"
fi

# Install frontend dependencies if needed
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    cd "$FRONTEND_DIR"
    npm install
    cd "$SCRIPT_DIR"
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$SHELECTOR_PID" ]; then
        kill $SHELECTOR_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend (run from project root so imports work)
echo -e "${GREEN}Starting backend on http://0.0.0.0:8000${NC}"
cd "$SCRIPT_DIR"
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready (loads 30k cards + ML model)
echo "Waiting for backend to load (this may take 10-20 seconds on first run)..."
for i in {1..30}; do
    if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend ready!${NC}"
        break
    fi
    sleep 1
done

if ! curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Backend may not be ready yet. Check for errors above.${NC}"
fi

# Start Shelector agent server
echo -e "${GREEN}Starting Shelector agent on http://0.0.0.0:8100${NC}"
cd "$SCRIPT_DIR"
python -m backend.agent.server &
SHELECTOR_PID=$!

# Start frontend
echo -e "${GREEN}Starting frontend on http://0.0.0.0:5173${NC}"
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

echo -e "\n${GREEN}All servers running!${NC}"
echo "  Backend:   http://localhost:8000"
echo "  Shelector: http://localhost:8100"
echo "  Frontend:  http://localhost:5173"
echo "  Chat UI:   http://localhost:5173/shelector"
echo "  LAN:       http://<your-ip>:5173"
echo -e "\nPress Ctrl+C to stop all servers.\n"

# Wait for both processes
wait
