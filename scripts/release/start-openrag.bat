@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

if exist ".env" (
  for /f "usebackq eol=# tokens=1* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

where wsl >nul 2>nul && (
  echo Starting OpenRAG TUI in WSL...
  wsl bash -lc "set -e; command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH=\"$HOME/.local/bin:$HOME/.cargo/bin:$PATH\"; mkdir -p ~/openclaude-openrag-workspace; cd ~/openclaude-openrag-workspace; uvx --python 3.13 openrag"
  exit /b %errorlevel%
)

where uv >nul 2>nul || call "%~dp0install-openrag.bat"
if "%OPENCLAUDE_OPENRAG_WORKSPACE_DIR%"=="" set "OPENCLAUDE_OPENRAG_WORKSPACE_DIR=%USERPROFILE%\.openclaude\openrag-workspace"
mkdir "%OPENCLAUDE_OPENRAG_WORKSPACE_DIR%" >nul 2>nul
cd /d "%OPENCLAUDE_OPENRAG_WORKSPACE_DIR%"
uvx --python 3.13 openrag
