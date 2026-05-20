@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

where node >nul 2>nul || (
  echo Node.js 20+ is required.
  exit /b 1
)

where bun >nul 2>nul || (
  echo Bun is required. Install it first: https://bun.sh
  exit /b 1
)

call bun install --frozen-lockfile || exit /b 1
echo Dependencies installed.
