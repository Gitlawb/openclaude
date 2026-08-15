@echo off
setlocal EnableExtensions
rem ============================================================
rem  OPENCLAUDE — one launcher, local MAX
rem  Double-click: run.bat
rem  Weights: official Qwen3.8-27B + 160k OpenClaude tag + effort max + thinking
rem ============================================================
title OpenClaude - Local POWER MAX
set "ROOT=C:\Users\GoldenBoy\Desktop\openclaude\openclaude-main"
cd /d "%ROOT%" || (
  echo ERROR: Cannot open folder:
  echo   %ROOT%
  pause
  exit /b 1
)

set "MODEL=qwen3.8-oc-code:27b"
set "SOURCE=qwen3.8:27b"
set "PASSTHRU=%*"

echo.
echo ============================================================
echo  OpenClaude — MAX local ^(one path^)
echo  Model: %MODEL%
echo  Qwen3.8-27B + 160k + effort max + thinking on + GPU
echo ============================================================
echo.
echo Checking install...

if not exist "%ROOT%\dist\cli.mjs" (
  echo ERROR: Build missing: dist\cli.mjs
  echo Fix:  cd /d "%ROOT%"
  echo       bun run build
  echo.
  pause
  exit /b 1
)

if not exist "C:\Program Files\nodejs\node.exe" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
  )
)

echo Waiting for Ollama...
set "OLLAMA_READY=0"
for /L %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "OLLAMA_READY=1"
    goto ollama_ready
  )
  timeout /t 1 /nobreak >nul
)
:ollama_ready
if "%OLLAMA_READY%"=="0" (
  echo ERROR: Ollama is not running.
  echo Start the Ollama app from the Start menu, wait 10 seconds, then run this again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $h=@{Authorization='Bearer ollama'}; Invoke-RestMethod 'http://127.0.0.1:11434/v1/models' -Headers $h -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Ollama API not ready for OpenClaude.
  echo Quit Ollama from the tray, start it once, wait 10s, try again.
  echo.
  pause
  exit /b 1
)

echo Ensuring daily Qwen3.8 tag exists...
ollama show "%MODEL%" >nul 2>&1
if errorlevel 1 (
  echo First-time bake of %MODEL% from %SOURCE% ^(pull can take several minutes^)...
  "C:\Program Files\nodejs\node.exe" "%ROOT%\setup\create-coding-model.mjs"
  if errorlevel 1 (
    echo ERROR: Could not create %MODEL% from %SOURCE%
    echo Fix: ollama pull %SOURCE%
    echo      then: node setup\create-coding-model.mjs
    echo If pull says a newer Ollama is required, upgrade Ollama then retry.
    echo.
    pause
    exit /b 1
  )
)

echo Proving chat link to Ollama...
"C:\Program Files\nodejs\node.exe" "%ROOT%\setup\prove-ollama-chat.mjs" "%MODEL%"
if errorlevel 1 (
  echo ERROR: Ollama chat failed — OpenClaude would Hyperspace with no reply.
  echo Fix: close OpenClaude, run: node setup\verify-local-stack.mjs
  echo Or reconnect: node setup\max-local-connected.mjs
  echo.
  pause
  exit /b 1
)

echo [OK] Folder, Node, Ollama, chat
echo Model: %MODEL%
echo.

"C:\Program Files\nodejs\node.exe" -e "const fs=require('fs');const p=require('path').join(process.env.USERPROFILE,'.openclaude','settings.json');const s=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));s.effortLevel='max';s.alwaysThinkingEnabled=true;s.model='qwen3.8-oc-code:27b';s.env=s.env||{};s.env.CLAUDE_CODE_USE_OPENAI='1';s.env.OPENAI_BASE_URL='http://127.0.0.1:11434/v1';s.env.OPENAI_API_KEY='ollama';s.env.OPENAI_MODEL='qwen3.8-oc-code:27b';s.env.OPENCLAUDE_TTS='1';s.env.OLLAMA_CONTEXT_LENGTH='163840';s.env.OLLAMA_MAX_VRAM='32768';s.env.OLLAMA_NUM_PARALLEL='1';s.env.OLLAMA_MAX_LOADED_MODELS='1';s.env.CLAUDE_CODE_OPENAI_FALLBACK_CONTEXT_WINDOW='153600';s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW='143360';s.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS='16384';s.env.OPENCLAUDE_PERFORMANCE_MODE='max5090';s.env.CLAUDE_CODE_USE_POWERSHELL_TOOL='1';try{const m=JSON.parse(s.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS||'{}');m['qwen3.8-oc-code:27b']=163840;m['qwen3.8:27b']=163840;m['qwen3.8:latest']=163840;s.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS=JSON.stringify(m);}catch(_){}fs.writeFileSync(p,JSON.stringify(s,null,4)+'\n');console.log('[OK] settings: qwen3.8-oc-code:27b effort=max thinking=on 160k');"

set "CLAUDE_CODE_NO_FLICKER=0"
set "CLAUDE_CODE_DISABLE_MOUSE=1"
set "CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1"
set "CLAUDE_CODE_FORCE_FULL_LOGO=1"
set "CLAUDE_CODE_USE_OPENAI=1"
set "OPENAI_BASE_URL=http://127.0.0.1:11434/v1"
set "OPENAI_API_KEY=ollama"
set "OPENAI_MODEL=%MODEL%"
set "OLLAMA_HOST=127.0.0.1:11434"
set "OLLAMA_KEEP_ALIVE=30m"
set "OLLAMA_FLASH_ATTENTION=1"
set "OLLAMA_MAX_VRAM=32768"
set "OLLAMA_NUM_THREAD=24"
set "OLLAMA_NUM_GPU=1"
set "OLLAMA_MAX_LOADED_MODELS=1"
set "OLLAMA_NUM_PARALLEL=1"
set "OLLAMA_CONTEXT_LENGTH=163840"
set "CLAUDE_CODE_OPENAI_FALLBACK_CONTEXT_WINDOW=153600"
set "CLAUDE_CODE_AUTO_COMPACT_WINDOW=143360"
set "CLAUDE_CODE_MAX_OUTPUT_TOKENS=16384"
set "CLAUDE_CODE_EFFORT_LEVEL=max"
set "API_TIMEOUT_MS=900000"
set "CLAUDE_STREAM_IDLE_TIMEOUT_MS=90000"
set "OPENCLAUDE_MAX_RETRIES=10"
set "OPENCLAUDE_AUTOCOMPACT_FAILURE_COOLDOWN_MS=30000"
set "USE_BUILTIN_RIPGREP=0"
set "CLAUDE_ENABLE_STREAM_WATCHDOG=1"
set "OPENCLAUDE_PERFORMANCE_MODE=max5090"
set "CLAUDE_CODE_USE_POWERSHELL_TOOL=1"
set "OPENCLAUDE_DISABLE_TOOL_REMINDERS=1"
set "OPENCLAUDE_TTS=1"
set "OPENCLAUDE_INSTALL_ROOT=%ROOT%"
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%LOCALAPPDATA%\Programs\cursor\resources\app\node_modules\@vscode\ripgrep\bin;%PATH%"

if exist "C:\Program Files\Git\bin\bash.exe" set "CLAUDE_CODE_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe"

if exist "%ROOT%\setup\stable-preflight.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\setup\stable-preflight.ps1" -Model "%MODEL%" -NumCtx %OLLAMA_CONTEXT_LENGTH% -Warm
) else if exist "%ROOT%\warm-coder.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\warm-coder.ps1" -Quiet -Model "%MODEL%" -NumCtx %OLLAMA_CONTEXT_LENGTH%
)

echo.
echo Starting OpenClaude POWER MAX ^(160k + max effort + thinking^)...
echo Model: %MODEL%
echo Perf: %OPENCLAUDE_PERFORMANCE_MODE%
echo If context fills: /clear then continue.
echo Press Esc to cancel a stuck reply.
echo.

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" --max-old-space-size=8192 "%ROOT%\dist\cli.mjs" --model %MODEL% --effort max --dangerously-skip-permissions --permission-mode bypassPermissions %PASSTHRU%
set "EXITCODE=%ERRORLEVEL%"

if "%EXITCODE%"=="0" (
  echo.
  echo OpenClaude closed normally.
  exit /b 0
)

echo.
echo OpenClaude exited with error %EXITCODE%.
echo Checks:
echo   1. Ollama tray app running
echo   2. Model installed: ollama list
echo   3. Build present: dist\cli.mjs
echo   4. Health: openclaude-health.bat
echo.
pause
exit /b %EXITCODE%
