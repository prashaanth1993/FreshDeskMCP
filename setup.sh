#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo " Freshdesk MCP Chat - Setup"
echo "=========================================="
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js not found."
    echo "        Mac:   brew install node"
    echo "        Linux: https://nodejs.org/en/download/package-manager"
    exit 1
fi

NODE_VER=$(node --version)
NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[ERROR] Node.js 18 or newer required. Found: $NODE_VER"
    echo "        Upgrade: https://nodejs.org/en/download"
    exit 1
fi
echo "[OK] Node.js $NODE_VER found."

echo ""
echo "[1/2] Installing MCP server dependencies..."
cd "$SCRIPT_DIR/mcp-server"
npm install
echo "[OK] MCP server ready."

echo ""
echo "[2/2] Installing chat app dependencies..."
cd "$SCRIPT_DIR/chat-app"
npm install
echo "[OK] Chat app ready."

echo ""
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "[ACTION REQUIRED] Edit the .env file before starting:"
    echo ""
    echo "  Location: $SCRIPT_DIR/.env"
    echo ""
    echo "  FRESHDESK_DOMAIN   your subdomain (e.g. acme for acme.freshdesk.com)"
    echo "  FRESHDESK_API_KEY  your API key from Freshdesk Profile Settings"
    echo ""
else
    echo "[OK] .env already exists."
fi

echo "=========================================="
echo " Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Freshdesk credentials (if not done)"
echo "  2. Install Ollama: https://ollama.com/download"
echo "  3. Run: ollama pull qwen2.5:3b"
echo "  4. Run: bash start.sh"
echo ""
