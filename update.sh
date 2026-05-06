#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT="$(dirname "$SCRIPT_DIR")"

# ── Find the zip ──────────────────────────────────────────────────────────────
# Priority 1: first argument  (e.g. bash update.sh ~/Downloads/freshdesk-mcp.zip)
# Priority 2: freshdesk-mcp.zip in the folder above this one

if [ -n "$1" ]; then
    ZIP="$1"
    echo "Using: $ZIP"
else
    ZIP="$PARENT/freshdesk-mcp.zip"
    echo "No path given — looking for: $ZIP"
fi

echo "=========================================="
echo " Freshdesk MCP Chat - Update"
echo "=========================================="
echo ""

if [ ! -f "$ZIP" ]; then
    echo "[ERROR] Update zip not found."
    echo ""
    echo "To update, run one of these:"
    echo "  bash update.sh ~/Downloads/freshdesk-mcp.zip"
    echo "  OR place freshdesk-mcp.zip in: $PARENT"
    exit 1
fi

echo "BEFORE YOU CONTINUE:"
echo "  - Stop the app (Ctrl+C in the terminal running start.sh)"
echo ""
read -rp "Press Enter when ready..."

# ── Show versions ─────────────────────────────────────────────────────────────

[ -f "$SCRIPT_DIR/VERSION" ] && echo "Current version:  $(cat "$SCRIPT_DIR/VERSION")"

NEW_VER=$(unzip -p "$ZIP" freshdesk-mcp/VERSION 2>/dev/null | tr -d '[:space:]') || true
[ -n "$NEW_VER" ] && echo "Incoming version: $NEW_VER"
echo ""

# ── Backup .env ───────────────────────────────────────────────────────────────

echo "[1/3] Backing up .env..."
if [ -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env" "$SCRIPT_DIR/.env.bak"
    echo "[OK] .env saved to .env.bak"
else
    echo "[WARN] No .env found to back up."
fi

# ── Extract zip ───────────────────────────────────────────────────────────────

echo ""
echo "[2/3] Extracting update (overwrites code files, not .env)..."
unzip -o "$ZIP" -d "$PARENT"
echo "[OK] Files updated."

# Restore .env (extraction overwrites it with the blank template)
if [ -f "$SCRIPT_DIR/.env.bak" ]; then
    cp "$SCRIPT_DIR/.env.bak" "$SCRIPT_DIR/.env"
    echo "[OK] .env restored from backup."
fi

# ── npm install ───────────────────────────────────────────────────────────────

echo ""
echo "[3/3] Updating dependencies..."
cd "$SCRIPT_DIR/mcp-server" && npm install
cd "$SCRIPT_DIR/chat-app"   && npm install
echo "[OK] Dependencies up to date."

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
[ -f "$SCRIPT_DIR/VERSION" ] && echo "Installed version: $(cat "$SCRIPT_DIR/VERSION")"
echo ""
echo "=========================================="
echo " Update complete! Run start.sh to launch."
echo "=========================================="
echo ""
