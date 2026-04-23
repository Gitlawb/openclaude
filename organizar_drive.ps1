# Organizar arquivos do Google Drive por tipo
# Uso: .\organizar_drive.ps1 [-DryRun]
# -DryRun: mostra o que seria feito sem mover de fato

param(
    [switch]$DryRun
)

$DRIVE_ROOT = "G:\Meu Drive"

# Definir regras de organizacao: pasta => filtros
$rules = @{
    "01_Planilhas"  = @("*.gsheet")
    "02_Mapas"      = @("*.gmap")
    "03_Documentos" = @("*.gdoc", "*.docx", "*.gpdf")
    "04_Formularios" = @("*.gform")
    "05_Sites"      = @("*.gsite")
    "06_PDFs"       = @("*.pdf")
    "07_Imagens"    = @("*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp")
    "08_Arquivos"   = @("*.zip", "*.rar", "*.7z", "*.tar.gz")
    "09_Dados"      = @("*.csv", "*.xlsx", "*.xls")
}

# Arquivos especificos (quando o nome importa mais que a extensao)
$specificRules = @{
    "01_Planilhas"  = @("AÇÕES 2011")
    "03_Documentos" = @("CONTRATO ENERGINOVA", "Relatório mensal ENERGINOVA", "Métodos para estudo")
    "06_PDFs"       = @("Comprovante")
    "08_Arquivos"   = @("EngenhariaPrompts")
}

# Arquivos/pastas para ignorar
$ignoreList = @(
    ".Trash",
    ".shortcut-targets-by-id",
    "Desktop",
    "Computers"
)

$stats = @{ moved = 0; skipped = 0; errors = 0 }
$logFile = Join-Path $DRIVE_ROOT "organizacao_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

Function Write-Log {
    param($msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $msg"
    Write-Host $line
    $line | Out-File -Append -FilePath $logFile -Encoding UTF8
}

Function ShouldIgnore {
    param($name)
    foreach ($ignore in $ignoreList) {
        if ($name -like "*$ignore*") { return $true }
    }
    return $false
}

Function FindTargetFolder {
    param($fileName)

    # 1) Checar regras especificas primeiro
    foreach ($folder in $specificRules.Keys) {
        foreach ($keyword in $specificRules[$folder]) {
            if ($fileName -like "*$keyword*") {
                return $folder
            }
        }
    }

    # 2) Checar por extensao
    $ext = [System.IO.Path]::GetExtension($fileName).ToLower()
    if ($ext) {
        foreach ($folder in $rules.Keys) {
            foreach ($pattern in $rules[$folder]) {
                if ($ext -eq [System.IO.Path]::GetExtension($pattern).ToLower()) {
                    return $folder
                }
            }
        }
    }

    return $null
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Organizador Google Drive" -ForegroundColor Cyan
Write-Host "  Raiz: $DRIVE_ROOT" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  MODO DRY RUN (nada sera movido)" -ForegroundColor Yellow }
Write-Host "========================================`n" -ForegroundColor Cyan

# Criar pastas de destino
foreach ($folder in $rules.Keys) {
    $path = Join-Path $DRIVE_ROOT $folder
    if (-not (Test-Path $path)) {
        if ($DryRun) {
            Write-Log "[CRIAR] $folder" -ForegroundColor DarkGray
        } else {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
            Write-Log "[CRIADA] Pasta '$folder'" -ForegroundColor Green
        }
    }
}

# Processar arquivos na raiz
$files = Get-ChildItem -Path $DRIVE_ROOT -File -Depth 0

foreach ($file in $files) {
    if (ShouldIgnore $file.Name) {
        $stats.skipped++
        continue
    }

    # Ignorar nosso proprio log e script
    if ($file.Name -like "organizacao_*.log" -or $file.Name -eq "organizar_drive.ps1") {
        continue
    }

    $targetFolder = FindTargetFolder $file.Name

    if ($null -eq $targetFolder) {
        Write-Log "[IGNORADO] '$($file.Name)' - sem regra de classificacao" -ForegroundColor DarkGray
        $stats.skipped++
        continue
    }

    $destPath = Join-Path $DRIVE_ROOT $targetFolder

    # Se arquivo ja existe no destino, adicionar timestamp
    $destFile = Join-Path $destPath $file.Name
    if (Test-Path $destFile) {
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        $ext = [System.IO.Path]::GetExtension($file.Name)
        $destFile = Join-Path $destPath "${baseName}_$([System.Guid]::NewGuid().ToString().Substring(0,8))$ext"
    }

    if ($DryRun) {
        Write-Log "[DRY] '$($file.Name)' -> $targetFolder\" -ForegroundColor Yellow
    } else {
        try {
            Move-Item -Path $file.FullName -Destination $destFile -Force
            Write-Log "[MOVIDO] '$($file.Name)' -> $targetFolder\" -ForegroundColor Green
            $stats.moved++
        } catch {
            Write-Log "[ERRO] '$($file.Name)' : $_" -ForegroundColor Red
            $stats.errors++
        }
    }
}

# Resumo
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Resumo:" -ForegroundColor Cyan
Write-Host "  Movidos : $($stats.moved)" -ForegroundColor Green
Write-Host "  Ignorados: $($stats.skipped)" -ForegroundColor DarkGray
Write-Host "  Erros   : $($stats.errors)" -ForegroundColor $(if ($stats.errors -gt 0) { 'Red' } else { 'Green' })
Write-Host "  Log     : $logFile" -ForegroundColor Cyan
Write-Host "========================================`n"
