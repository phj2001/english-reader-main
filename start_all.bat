@echo off
REM ============================================
REM English Reader - Start All Services
REM ============================================

echo ============================================
echo   English Reader Project Launcher
echo ============================================
echo.
echo This will start:
echo   1. Backend Server (Python/FastAPI)
echo   2. Frontend Dev Server (Next.js)
echo.
echo Press Ctrl+C to stop any service
echo ============================================
echo.

REM Start Backend
echo [1/2] Starting Backend Server...
start "English Reader Backend" /D "%~dp0\english-reader-server" python -m app.main

REM Wait for backend to start
timeout /t 3 /nobreak >nul

REM Start Frontend
echo [2/2] Starting Frontend Dev Server...
cd /d "%~dp0\english-reader-web"
start "English Reader Frontend" cmd /k "npm run dev"

echo.
echo ============================================
echo   Services Started!
echo ============================================
echo.
echo Backend: http://127.0.0.1:8000
echo Frontend: http://localhost:3000
echo.
echo Press any key to open browser...
pause >nul

start http://localhost:3000

echo.
echo Both services are running in separate windows.
echo Close those windows to stop the services.
echo.
pause
