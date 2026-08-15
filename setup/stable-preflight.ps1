# Preflight before OpenClaude local: free GPU, kill bad 262k loads, optional light warm.
param(
    [Parameter(Mandatory = $true)][string]$Model,
    [int]$NumCtx = 163840,
    [switch]$Warm
)

$ErrorActionPreference = "Continue"

function Stop-AllOllamaModels {
    try {
        $lines = ollama ps 2>$null
        foreach ($line in $lines) {
            if ($line -match '^\s*NAME') { continue }
            $name = ($line.ToString().Trim() -split '\s+')[0]
            if ($name) { ollama stop $name 2>$null | Out-Null }
        }
    } catch { }
    foreach ($m in @(
        'qwen3.8:27b',
        'qwen3.8:latest',
        'qwen3.8:27b-mtp-q8_0',
        'qwen3.8:27b-q8_0',
        'qwen3.8-oc-code:27b',
        'qwen3.6:27b',
        'qwen3.6-oc:27b',
        'qwen3.6-oc-code:27b',
        'n0404n0404/qwen3.6-finetune-qwen3.8-max-glm5.2-kimi-k3-distillation-a56-1168cb-heretic:q6_k',
        'qwen3.6:35b',
        'qwen3.6:latest',
        'qwen3-coder:30b',
        'qwen3-coder:480b-cloud',
        'qwen2.5-coder:7b'
    )) {
        try { ollama stop $m 2>$null | Out-Null } catch { }
    }
}

Write-Host '[stable5090] Clearing GPU models...' -ForegroundColor DarkGray
Stop-AllOllamaModels
Start-Sleep -Seconds 1

# Never allow bare 256k/262k official tags or retired cloud coder as the session model
if ($Model -eq 'qwen3.8:27b' -or $Model -eq 'qwen3.8:latest' -or $Model -eq 'qwen3.8:27b-mtp-q8_0' -or $Model -eq 'qwen3.8:27b-q8_0' -or $Model -eq 'qwen3.6:27b' -or $Model -eq 'qwen3.6:latest' -or $Model -eq 'qwen3-coder:480b-cloud' -or $Model -eq 'qwen3-coder:30b') {
    Write-Host '[WARN] Refusing unsafe/retired model - using qwen3.8-oc-code:27b' -ForegroundColor Yellow
    $Model = 'qwen3.8-oc-code:27b'
}

if ($Warm) {
    Write-Host ("[stable5090] Light warm {0} ctx={1} ..." -f $Model, $NumCtx) -ForegroundColor DarkGray
    $env:OLLAMA_CONTEXT_LENGTH = "$NumCtx"
    $bodyObj = @{
        model      = $Model
        prompt     = 'OK'
        stream     = $false
        keep_alive = '10m'
        options    = @{
            num_ctx     = $NumCtx
            num_predict = 4
        }
    }
    $body = $bodyObj | ConvertTo-Json -Depth 5 -Compress
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 180 | Out-Null
        $ps = ollama ps 2>$null | Out-String
        if ($ps -match '100%\s+GPU' -and $ps -notmatch '262144') {
            Write-Host ("[OK] {0} on GPU (ctx={1})" -f $Model, $NumCtx) -ForegroundColor Green
        } else {
            Write-Host '[OK] Warm finished.' -ForegroundColor Green
            Write-Host $ps
        }
    } catch {
        Write-Host ('[WARN] Warm failed - OpenClaude will still start. ' + $_.Exception.Message) -ForegroundColor Yellow
    }
} else {
    Write-Host '[stable5090] Warm skipped (model loads on first message).' -ForegroundColor DarkGray
}

exit 0
