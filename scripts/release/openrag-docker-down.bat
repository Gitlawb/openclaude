@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

if exist ".env" (
  for /f "usebackq eol=# tokens=1* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%OPENCLAUDE_OPENRAG_REPO_DIR%"=="" set "OPENCLAUDE_OPENRAG_REPO_DIR=%USERPROFILE%\.openclaude\openrag"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONLEGACYWINDOWSSTDIO=0"
set "NO_COLOR=1"
set "RICH_NO_COLOR=1"
set "FORCE_COLOR=0"
set "TERM=dumb"
if not exist "%OPENCLAUDE_OPENRAG_REPO_DIR%\docker-compose.yml" (
  echo OpenRAG repo not found: %OPENCLAUDE_OPENRAG_REPO_DIR%
  exit /b 0
)

cd /d "%OPENCLAUDE_OPENRAG_REPO_DIR%"
docker compose down
uv run --python 3.13 python scripts/docling_ctl.py stop
