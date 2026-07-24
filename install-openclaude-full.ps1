# One-shot full OpenClaude install (5090 tier)
# Run: powershell -ExecutionPolicy Bypass -File install-openclaude-full.ps1

param(
    [switch]$FullSkills,
    [ValidateSet("default", "5090")]
    [string]$HardwareTier = "5090"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== OpenClaude Full Install (Leaks Army + $HardwareTier) ===" -ForegroundColor Cyan
Write-Host ""

& (Join-Path $root "install-software-skills.ps1")
& (Join-Path $root "install-openclaude-agents.ps1")
& (Join-Path $root "install-openclaude-hardware-tune.ps1") -Tier $HardwareTier

$profileArgs = @{ HardwareTier = $HardwareTier; SoftwareGenius = $true }
if ($FullSkills) { $profileArgs.FullSkills = $true }
& (Join-Path $root "install-openclaude-profiles.ps1") @profileArgs

Write-Host ""
Write-Host "=== Full install done ===" -ForegroundColor Green
Write-Host "Load openclaude-session-conductor in chat for full projects." -ForegroundColor DarkGray
Write-Host "Health: openclaude-health.bat" -ForegroundColor DarkGray
Write-Host ""
