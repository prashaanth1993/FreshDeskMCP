#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo " Freshdesk MCP Chat"
echo "=========================================="
echo ""

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "[ERROR] .env not found. Run setup.sh first."
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js not found. Run setup.sh first."
    exit 1
fi

if [ ! -d "$SCRIPT_DIR/chat-app/node_modules" ]; then
    echo "[ERROR] Dependencies not installed. Run setup.sh first."
    exit 1
fi

if [ ! -d "$SCRIPT_DIR/mcp-server/node_modules" ]; then
    echo "[ERROR] MCP server dependencies not installed. Run setup.sh first."
    exit 1
fi

if ! command -v ollama &>/dev/null; then
    echo "[ERROR] Ollama not found."
    echo "        Install from https://ollama.com/download"
    exit 1
fi

if ! curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama in background..."
    ollama serve >/dev/null 2>&1 &
    sleep 4
fi

if ! curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[ERROR] Ollama did not start. Run 'ollama serve' manually in another terminal, then retry."
    exit 1
fi
echo "[OK] Ollama running."

echo ""
echo "Starting chat app..."
echo ""
echo "  Open browser at: http://localhost:3000"
echo "  Press Ctrl+C to stop."
echo ""

cd "$SCRIPT_DIR/chat-app"
node server.js
