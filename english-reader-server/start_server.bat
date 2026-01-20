@echo off
REM ============================================
REM English Reader Backend Server Launcher
REM ============================================

cd /d "%~dp0"
echo ============================================
echo   Starting English Reader Backend Server
echo ============================================
echo.

python -m app.main

pause
