@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."

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

call bun run start -- %*
