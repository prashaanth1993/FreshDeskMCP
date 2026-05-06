@echo off
setlocal EnableDelayedExpansion
title Freshdesk MCP Chat - Update

echo ==========================================
echo  Freshdesk MCP Chat - Update
echo ==========================================
echo.

REM ── Find the zip ──────────────────────────────────────────────────────────
REM   Priority 1: drag the zip onto update.bat  (%%1 is set automatically)
REM   Priority 2: freshdesk-mcp.zip in the folder above this one

if not "%~1"=="" (
    set ZIP=%~1
    echo Using: !ZIP!
) else (
    set ZIP=%~dp0..\freshdesk-mcp.zip
    echo No zip dragged — looking for: !ZIP!
)

if not exist "!ZIP!" (
    echo.
    echo [ERROR] Update zip not found.
    echo.
    echo To update, do ONE of these:
    echo   A) Drag the new freshdesk-mcp.zip file onto update.bat
    echo   B) Place freshdesk-mcp.zip in the folder ABOVE this one
    echo      ^(the folder that contains the freshdesk-mcp folder^)
    echo.
    pause & exit /b 1
)

echo.
echo BEFORE YOU CONTINUE:
echo   - Close the terminal window running start.bat
echo.
pause

REM ── Show current and incoming version ─────────────────────────────────────

if exist "%~dp0VERSION" (
    set /p OLD_VER=<"%~dp0VERSION"
    echo Current version:  !OLD_VER!
)

REM Peek at the version inside the zip using PowerShell
for /f "delims=" %%v in ('powershell -NoProfile -Command "try { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('!ZIP!'); $e=$z.Entries | Where-Object {$_.FullName -eq 'freshdesk-mcp/VERSION'}; if($e){$r=New-Object System.IO.StreamReader($e.Open()); $v=$r.ReadToEnd().Trim(); $r.Close()}; $z.Dispose(); $v } catch {}"') do set NEW_VER=%%v
if defined NEW_VER echo Incoming version: !NEW_VER!
echo.

REM ── Backup .env ───────────────────────────────────────────────────────────

echo [1/3] Backing up .env...
if exist "%~dp0.env" (
    copy "%~dp0.env" "%~dp0.env.bak" >nul
    echo [OK] .env saved to .env.bak
) else (
    echo [WARN] No .env found to back up.
)

REM ── Extract zip over existing folder ──────────────────────────────────────

echo.
echo [2/3] Extracting update (overwrites code files, not .env)...
set PARENT=%~dp0..
powershell -NoProfile -Command "Expand-Archive -Path '!ZIP!' -DestinationPath '!PARENT!' -Force"
if %errorlevel% neq 0 (
    echo [ERROR] Extraction failed.
    if exist "%~dp0.env.bak" (
        echo         Restoring .env from backup...
        copy "%~dp0.env.bak" "%~dp0.env" >nul
    )
    pause & exit /b 1
)
echo [OK] Files updated.

REM ── Restore .env (extraction may have blanked it) ─────────────────────────

if exist "%~dp0.env.bak" (
    copy "%~dp0.env.bak" "%~dp0.env" >nul
    echo [OK] .env restored from backup.
)

REM ── npm install ───────────────────────────────────────────────────────────

echo.
echo [3/3] Updating dependencies...
pushd "%~dp0mcp-server"
call npm install 2>&1
if %errorlevel% neq 0 ( echo [ERROR] npm install failed in mcp-server & popd & pause & exit /b 1 )
popd
pushd "%~dp0chat-app"
call npm install 2>&1
if %errorlevel% neq 0 ( echo [ERROR] npm install failed in chat-app & popd & pause & exit /b 1 )
popd
echo [OK] Dependencies up to date.

REM ── Done ──────────────────────────────────────────────────────────────────

echo.
if exist "%~dp0VERSION" (
    set /p VER=<"%~dp0VERSION"
    echo Installed version: !VER!
)
echo.
echo ==========================================
echo  Update complete! Run start.bat to launch.
echo ==========================================
echo.
pause
