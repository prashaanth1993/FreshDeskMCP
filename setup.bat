@echo off
setlocal EnableDelayedExpansion
title Freshdesk MCP Chat - Setup

echo ==========================================
echo  Freshdesk MCP Chat - Setup
echo ==========================================
echo.

where node >/dev/null 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    echo         Install Node.js 18 or newer from https://nodejs.org
    echo         Then re-run this script.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER! found.

echo.
echo [1/2] Installing MCP server dependencies...
pushd "%~dp0mcp-server"
call npm install 2>&1
if %errorlevel% neq 0 ( echo [ERROR] npm install failed & popd & pause & exit /b 1 )
popd
echo [OK] MCP server ready.

echo.
echo [2/2] Installing chat app dependencies...
pushd "%~dp0chat-app"
call npm install 2>&1
if %errorlevel% neq 0 ( echo [ERROR] npm install failed & popd & pause & exit /b 1 )
popd
echo [OK] Chat app ready.

echo.
if not exist "%~dp0.env" (
    copy "%~dp0.env.example" "%~dp0.env" >nul
    echo [ACTION REQUIRED] Edit the .env file before starting:
    echo.
    echo   Location: %~dp0.env
    echo.
    echo   FRESHDESK_DOMAIN   your subdomain (e.g. acme for acme.freshdesk.com)
    echo   FRESHDESK_API_KEY  your API key from Freshdesk Profile Settings
    echo.
) else (
    echo [OK] .env already exists.
)

echo ==========================================
echo  Setup complete!
echo ==========================================
echo.
echo Next steps:
echo   1. Edit .env with your Freshdesk credentials (if not done)
echo   2. Install Ollama: https://ollama.com/download/windows
echo   3. Open a terminal and run: ollama pull qwen2.5:3b
echo   4. Double-click start.bat
echo.
pause
