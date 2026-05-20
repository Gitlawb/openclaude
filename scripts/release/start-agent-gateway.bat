@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

if exist ".env" (
  for /f "usebackq eol=# tokens=1* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

set OPENCLAUDE_AGENT_API_ENABLED=1
if "%OPENCLAUDE_AGENT_CRON_ENABLED%"=="" set OPENCLAUDE_AGENT_CRON_ENABLED=1
if "%OPENCLAUDE_RESPECT_PROVIDER_ENV%"=="" if not "%OPENAI_API_KEY%"=="" set OPENCLAUDE_RESPECT_PROVIDER_ENV=1

if not "%OPENCLAUDE_RESPECT_PROVIDER_ENV%"=="1" (
  set CLAUDE_CODE_USE_OPENAI=
  set CLAUDE_CODE_USE_GEMINI=
  set CLAUDE_CODE_USE_GITHUB=
)

if not exist node_modules (
  call scripts\release\install-deps.bat || exit /b 1
)

if not exist dist\cli.mjs (
  call bun run build || exit /b 1
)

call bun run start:agent-gateway -- %*
