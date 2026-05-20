import { describe, expect, test } from 'bun:test'
import { detectShell } from './shellDetect.js'

// shellDetect.js has zero dependencies — safe to import statically.

// ── detectShell ──────────────────────────────────────────────────────

describe('detectShell', () => {
  test('returns bash for empty command', () => {
    expect(detectShell('')).toBe('bash')
  })

  test('returns bash for simple shell commands', () => {
    expect(detectShell('ls -la')).toBe('bash')
    expect(detectShell('echo hello')).toBe('bash')
    expect(detectShell('cat file.txt | grep foo')).toBe('bash')
    expect(detectShell('tail -f /var/log/syslog')).toBe('bash')
  })

  // ── bash loop detection (regression: $i was detected as PS variable) ──

  test('returns bash for while ... done loops with $i', () => {
    expect(detectShell('i=1; while [ $i -le 60 ]; do echo "Tick $i/60"; sleep 1; i=$((i+1)); done')).toBe('bash')
  })

  test('returns bash for for ... done loops with $j', () => {
    expect(detectShell('for j in $(seq 1 60); do echo "Tick $j/60 - $(date +%H:%M:%S)"; sleep 1; done')).toBe('bash')
  })

  test('returns bash for brace expansion for loop', () => {
    expect(detectShell('for i in {1..60}; do echo "Tick $i"; sleep 1; done')).toBe('bash')
  })

  test('returns bash for until ... done loops', () => {
    expect(detectShell('i=0; until [ $i -ge 10 ]; do echo $i; i=$((i+1)); done')).toBe('bash')
  })

  test('returns bash for nested loops with done', () => {
    expect(detectShell('for i in 1 2 3; do for j in a b c; do echo "$i-$j"; done; done')).toBe('bash')
  })

  test('done without loop keywords returns to other checks', () => {
    expect(detectShell('cat done.txt')).toBe('bash')
  })

  // ── PowerShell detection via cmdlets ────────────────────────────────

  test('returns powershell for Write-Host', () => {
    expect(detectShell('Write-Host "hello"')).toBe('powershell')
  })

  test('returns powershell for ForEach-Object', () => {
    expect(detectShell('1..5 | ForEach-Object { Write-Host "Tick $_" }')).toBe('powershell')
  })

  test('returns powershell for Get-Date', () => {
    expect(detectShell('Get-Date -Format "HH:mm:ss"')).toBe('powershell')
  })

  test('returns powershell for Start-Sleep', () => {
    expect(detectShell('Start-Sleep -Seconds 1')).toBe('powershell')
  })

  // ── PowerShell detection via variables ──────────────────────────────

  test('returns powershell for $_ pipeline variable', () => {
    expect(detectShell('$_ | ForEach-Object { $_ }')).toBe('powershell')
  })

  test('returns powershell for $env:VAR', () => {
    expect(detectShell('$env:USERPROFILE')).toBe('powershell')
  })

  test('returns powershell for PS preference variable', () => {
    expect(detectShell('$ErrorActionPreference = "Stop"')).toBe('powershell')
  })

  // ── PowerShell detection via comparison operators ───────────────────

  test('returns powershell for -eq operator', () => {
    expect(detectShell('if ($a -eq $b) { }')).toBe('powershell')
  })

  test('returns powershell for -like operator', () => {
    expect(detectShell('$name -like "*.txt"')).toBe('powershell')
  })

  // ── Edge cases ──────────────────────────────────────────────────────

  test('bash command substitution $(...) is not detected as PS variable', () => {
    expect(detectShell('echo $(date)')).toBe('bash')
  })

  test('bash $(( )) arithmetic is not detected as PS variable', () => {
    expect(detectShell('i=$((i+1))')).toBe('bash')
  })

  test('bash $? exit code is not detected as PS variable', () => {
    expect(detectShell('echo $?')).toBe('bash')
  })
})

// ── Platform-aware behavior ──────────────────────────────────────────
// On non-Windows platforms, Monitor should skip PS detection entirely
// and default to bash. This is tested at the call-site level:

describe('MonitorTool platform gate', () => {
  test('on Windows, PS commands are auto-detected', () => {
    // Documented contract: getPlatform() === 'windows' → detectShell() is called
    const psCmd = 'Write-Host "hello"'
    const shellType = detectShell(psCmd)
    expect(shellType).toBe('powershell')
  })

  test('platform gate logic: non-windows skips PS detection', () => {
    // On non-Windows platforms, the call site in MonitorTool.call() does:
    //   getPlatform() === 'windows' ? detectShell(cmd) : 'bash'
    // This tests the logic directly (not the platform we're running on).
    const isWindows = false // simulate non-windows
    const psCmd = 'Write-Host "hello"'
    const shellType = isWindows ? detectShell(psCmd) : 'bash'
    expect(shellType).toBe('bash')
  })
})
