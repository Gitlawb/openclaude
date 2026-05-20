@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

where wsl >nul 2>nul && (
  echo Installing OpenRAG in WSL, as recommended by OpenRAG for Windows...
  wsl bash -lc "set -e; command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH=\"$HOME/.local/bin:$HOME/.cargo/bin:$PATH\"; uv tool install openrag --python 3.13 || true; uv tool install openrag-mcp --python 3.13 || true"
  exit /b %errorlevel%
)

where uv >nul 2>nul || (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
)

uv tool install openrag --python 3.13
uv tool install openrag-mcp --python 3.13
