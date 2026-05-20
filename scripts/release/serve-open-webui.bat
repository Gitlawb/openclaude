@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

if exist ".env" (
  for /f "usebackq eol=# tokens=1* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set LANG=C.UTF-8
if "%WEBUI_AUTH%"=="" set WEBUI_AUTH=False

if "%OPENCLAUDE_AGENT_API_HOST%"=="" set OPENCLAUDE_AGENT_API_HOST=127.0.0.1
if "%OPENCLAUDE_AGENT_API_PORT%"=="" (
  for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "$p=Join-Path $env:USERPROFILE '.openclaude\agent-gateway.json'; if (Test-Path $p) { try { $c=Get-Content $p -Raw | ConvertFrom-Json; if ($c.api.port) { [Console]::Write($c.api.port) } } catch {} }"`) do set "OPENCLAUDE_AGENT_API_PORT=%%V"
)
if "%OPENCLAUDE_AGENT_API_PORT%"=="" set OPENCLAUDE_AGENT_API_PORT=8642

if "%OPENAI_API_BASE_URLS%"=="" set "OPENAI_API_BASE_URLS=http://%OPENCLAUDE_AGENT_API_HOST%:%OPENCLAUDE_AGENT_API_PORT%/v1"
if "%OPENAI_API_KEYS%"=="" if not "%OPENCLAUDE_AGENT_API_KEY%"=="" set "OPENAI_API_KEYS=%OPENCLAUDE_AGENT_API_KEY%"
if "%OPENAI_API_KEYS%"=="" (
  for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "$p=Join-Path $env:USERPROFILE '.openclaude\agent-gateway.json'; if (Test-Path $p) { try { $c=Get-Content $p -Raw | ConvertFrom-Json; if ($c.api.apiKey) { [Console]::Write($c.api.apiKey) } } catch {} }"`) do set "OPENAI_API_KEYS=%%V"
)
if "%OPENAI_API_KEYS%"=="" set OPENAI_API_KEYS=openclaude-local
echo Open WebUI: http://localhost:8080
open-webui serve --host localhost --port 8080
