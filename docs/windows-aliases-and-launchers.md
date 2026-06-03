# Windows Power Aliases and Launchers

This page gives you an "instant command center" in PowerShell for OpenClaude.

After setup, you can use short commands like `oc`, `oc-init`, `oc-local`, and `oc-provider`.

## One-time setup

Run this once in PowerShell:

This resolves the alias helper script from the global npm installation path instead of relying on a local source checkout.

```powershell
$packageRoot = Join-Path (npm root -g) "@gitlawb/openclaude"
$aliases = Join-Path $packageRoot "scripts\windows\openclaude-aliases.ps1"

if (-not (Test-Path $aliases)) {
  throw "Alias script not found at $aliases. Update or reinstall @gitlawb/openclaude."
}

if (-not (Test-Path $PROFILE)) {
  New-Item -ItemType File -Path $PROFILE -Force | Out-Null
}

$profileLine = ". `"$aliases`""

if (-not (Select-String -Path $PROFILE -Pattern ([regex]::Escape($profileLine)) -Quiet)) {
  Add-Content -Path $PROFILE -Value "`n$profileLine"
}

. $aliases
oc-help
```

## Instant launch path (local Ollama)

Use this whenever you want a full local startup in one command:

```powershell
oc-init
```

What it does:

- checks required tools (`npm`, `bun`, `ollama`)
- optionally pulls model (default `llama3.1:8b`)
- saves local provider profile
- validates local Ollama status
- launches OpenClaude TUI with the saved profile

## Daily command set

- `oc` -> launch with saved provider profile
- `oc-local` -> force Ollama launch (`bun run dev:ollama`)
- `oc-fast` -> low-latency launch path (`bun run dev:fast`)
- `oc-check` -> verify Ollama binary, API listening, and model availability
- `oc-provider -Provider ollama -Goal coding` -> auto-pick a coding-focused local model profile
- `oc-provider -Provider ollama -Model qwen2.5-coder:7b` -> pin exact local model
- `oc-provider -Provider codex` -> switch to Codex profile
- `oc-provider -Provider openai -ApiKey sk-... -Model gpt-4o` -> switch to OpenAI profile

## GUI / VS Code usage

The VS Code extension launch button runs your configured command. With this setup, you can set:

- `openclaude.launchCommand` = `openclaude` (default)

Then keep using:

- Command Palette -> `OpenClaude: Launch in Terminal`
- Control Center -> `Launch OpenClaude`

If you use profile-driven launching, keep `openclaude.useOpenAIShim` disabled so saved profile settings are not bypassed by a partial environment override.
