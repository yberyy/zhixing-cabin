@echo off
setlocal
cd /d "%~dp0"
node scripts/start-deepseek.mjs
set "result=%errorlevel%"
echo.
pause
exit /b %result%
