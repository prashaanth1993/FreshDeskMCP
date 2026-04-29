@echo off
setlocal EnableDelayedExpansion
title Freshdesk MCP Chat

echo ==========================================
echo  Freshdesk MCP Chat
echo ==========================================
echo.

if not exist "%~dp0.env" (
    echo [ERROR] .env not found. Run setup.bat first.
    pause & exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Run setup.bat first.
    pause & exit /b 1
)

if not exist "%~dp0chat-app\node_modules" (
    echo [ERROR] Dependencies not installed. Run setup.bat first.
    pause & exit /b 1
)

if not exist "%~dp0mcp-server\node_modules" (
    echo [ERROR] MCP server dependencies not installed. Run setup.bat first.
    pause & exit /b 1
)

where ollama >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Ollama not found.
    echo         Install from https://ollama.com/download/windows
    pause & exit /b 1
)

where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] curl not found. Install curl or use Windows 10 1803+ which includes it.
    pause & exit /b 1
)

curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo Starting Ollama in background...
    start /min "" ollama serve
    timeout /t 4 /nobreak >nul
)

curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Ollama did not start. Run "ollama serve" manually then retry.
    pause & exit /b 1
)
echo [OK] Ollama running.

echo.
echo Starting chat app...
echo.
echo   Open browser at: http://localhost:3000
echo   Press Ctrl+C to stop.
echo.

pushd "%~dp0chat-app"
node server.js
popd
