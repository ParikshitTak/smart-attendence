@echo off
title Smart Attendance Server
cd /d "%~dp0"
echo ============================================
echo   Smart Attendance - starting server
echo ============================================
echo.
if not exist node_modules (
  echo node_modules not found. Running npm install...
  call npm install
  echo.
)
echo LAN IP addresses (use one of these from your phone):
ipconfig | findstr /i "IPv4"
echo.
echo Server URL: http://localhost:3000
echo Press Ctrl+C to stop.
echo.
call npm start
pause