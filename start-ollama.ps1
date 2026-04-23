# ============================================================
# OpenClaude Agent - Script de Lancamento (PowerShell)
# ============================================================
# Uso:
#   .\start-ollama.ps1                                → cloud (qwen3-vl:235b)
#   .\start-ollama.ps1 -Mode local                    → local 14B na GPU
#   .\start-ollama.ps1 -Mode openai                   → GPT-4o (plano B)
#   .\start-ollama.ps1 -Mode openrouter               → OpenRouter (Claude, GPT, etc)
#   .\start-ollama.ps1 -Project "E:\meu-projeto"      → abrir em diretorio
#   .\start-ollama.ps1 -Mode local -Project "E:\proj"  → combinar opcoes
# ============================================================

param(
    [ValidateSet("cloud", "local", "openai", "openrouter")]
    [string]$Mode = "cloud",
    [string]$Project = "",
    [string]$Model = ""
)

# -----------------------------------------------------------
# Configuracao por modo
# -----------------------------------------------------------
$env:CLAUDE_CODE_USE_OPENAI = "1"

switch ($Mode) {
    "cloud" {
        $env:OPENAI_BASE_URL = "http://localhost:11434/v1"
        $env:OPENAI_API_KEY = "ollama"
        if (-not $Model) { $Model = "qwen3-vl:235b-cloud" }
        $env:OPENAI_MODEL = $Model
        $label = "Ollama Cloud"
        $color = "Cyan"
    }
    "local" {
        $env:OPENAI_BASE_URL = "http://localhost:11434/v1"
        $env:OPENAI_API_KEY = "ollama"
        if (-not $Model) { $Model = "qwen2.5:14b" }
        $env:OPENAI_MODEL = $Model
        $label = "Ollama Local (GPU)"
        $color = "Green"
    }
    "openai" {
        Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
        if (-not $Model) { $Model = "gpt-4o" }
        $env:OPENAI_MODEL = $Model
        $label = "OpenAI API"
        $color = "Yellow"

        if (-not $env:OPENAI_API_KEY -or $env:OPENAI_API_KEY -eq "ollama") {
            $key = Read-Host "OPENAI_API_KEY nao encontrada. Cole sua chave"
            $env:OPENAI_API_KEY = $key
        }
    }
    "openrouter" {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $envFile = Join-Path $scriptDir ".env.openrouter"
        $defaultModel = "qwen/qwen3.6-plus:free"

        if (Test-Path $envFile) {
            # Carregar variaveis do .env.openrouter
            Get-Content $envFile | ForEach-Object {
                if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)\s*$') {
                    $name = $matches[1].Trim()
                    $value = $matches[2].Trim()
                    Set-Item -Path "env:$name" -Value $value
                }
            }
            if ($env:OPENROUTER_DEFAULT_MODEL) { $defaultModel = $env:OPENROUTER_DEFAULT_MODEL }
        } else {
            Write-Host ".env.openrouter nao encontrado. Criando..." -ForegroundColor Yellow
            $key = Read-Host "Cole sua OPENROUTER_API_KEY (sk-or-v1-...)"
            Set-Content -Path $envFile -Value @"
OPENROUTER_API_KEY=$key
OPENROUTER_DEFAULT_MODEL=$defaultModel
"@
            $env:OPENROUTER_API_KEY = $key
        }

        if (-not $env:OPENROUTER_API_KEY) {
            Write-Host "ERRO: OPENROUTER_API_KEY nao definida em .env.openrouter" -ForegroundColor Red
            exit 1
        }

        $env:OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
        $env:OPENAI_API_KEY = $env:OPENROUTER_API_KEY
        if (-not $Model) { $Model = $defaultModel }
        $env:OPENAI_MODEL = $Model
        $label = "OpenRouter"
        $color = "Magenta"
    }
}

# -----------------------------------------------------------
# Verificar Ollama (modos cloud e local)
# -----------------------------------------------------------
if ($Mode -eq "cloud" -or $Mode -eq "local") {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
        Write-Host "Ollama OK - $($response.models.Count) modelo(s)" -ForegroundColor Green
    } catch {
        Write-Host "Iniciando Ollama..." -ForegroundColor Yellow
        Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }

    # Verificar modelo disponivel
    $models = (Invoke-RestMethod -Uri "http://localhost:11434/api/tags").models.name
    if ($Model -notin $models) {
        Write-Host "Baixando modelo $Model..." -ForegroundColor Yellow
        ollama pull $Model
    }
}

# -----------------------------------------------------------
# Banner
# -----------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor $color
Write-Host "  OpenClaude Agent - $label" -ForegroundColor $color
Write-Host "============================================" -ForegroundColor $color
Write-Host "  Modelo  : $Model" -ForegroundColor White
if ($Mode -ne "openai") {
    Write-Host "  Endpoint: $($env:OPENAI_BASE_URL)" -ForegroundColor White
}
if ($Mode -eq "openrouter") {
    Write-Host "  Dashboard: https://openrouter.ai/activity" -ForegroundColor DarkGray
}
if ($Project) {
    Write-Host "  Projeto : $Project" -ForegroundColor White
}
Write-Host "============================================" -ForegroundColor $color
Write-Host ""

# -----------------------------------------------------------
# Navegar e iniciar
# -----------------------------------------------------------
if ($Project -and (Test-Path $Project)) {
    Set-Location $Project
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$scriptDir\dist\cli.mjs"
