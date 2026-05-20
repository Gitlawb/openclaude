@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required to run OpenClaude Control Center.
  exit /b 1
)

if not exist node_modules (
  call scripts\release\install-deps.bat || exit /b 1
)

node scripts\release\control-center.mjs %*
