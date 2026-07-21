@echo off
rem === Lumen path tracer launcher (Windows) ===
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo [ERROR] Node.js not found. Install from https://nodejs.org && pause && exit /b 1)
set "PORT=8081"
echo === Lumen path tracer ===
echo Starting static server at http://localhost:%PORT%/ ...
start "" "http://localhost:%PORT%/"
node "%~dp0serve.js" %PORT%
pause
