import { execaSync } from 'execa'
import { readFileSync } from 'node:fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getSecureStorageServiceName,
  getUsername,
} from './macOsKeychainHelpers.js'
import type { SecureStorage, SecureStorageData, SecureStorageReadResult } from './index.js'

/**
 * Windows-specific secure storage implementation using DPAPI for new writes,
 * with best-effort reads/deletes from the legacy PasswordVault path.
 */
function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function getLegacyResourceName(): string {
  return getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX)
}

function getWindowsSecureStorageEntropy(): string {
  return `${getLegacyResourceName()}:${getUsername()}`
}

function getWindowsSecureStorageFilePath(): string {
  const resourceName = getLegacyResourceName().replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(getClaudeConfigHomeDir(), `${resourceName}.secure.dpapi`)
}

function shouldUseLegacyPasswordVault(): boolean {
  return (process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT ?? process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT) === '1'
}

type DpapiFileRead =
  | { kind: 'ok'; encrypted: string }
  | { kind: 'missing' }
  | { kind: 'error'; warning: string }

function readDpapiFile(path: string): DpapiFileRead {
  try {
    return { kind: 'ok', encrypted: readFileSync(path, 'utf8').trim() }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return { kind: 'error', warning: `Windows credential file could not be read (${code ?? 'unknown error'}).` }
  }
}

// Every read still checks the encrypted file. A login, refresh or logout in
// another process becomes visible immediately, without starting PowerShell
// again for each agent that uses an unchanged credential record.
let readCache: {
  path: string
  entropy: string
  encrypted: string
  data: SecureStorageData
} | null = null

function runPowerShell(
  script: string,
  options?: { input?: string },
): ReturnType<typeof execaSync> | null {
  try {
    // Execa reads/writes UTF-8 pipes; Windows console code pages must not
    // corrupt non-ASCII credential metadata on either side of the pipe.
    const utf8Script = `[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
${script}`
    return execaSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', utf8Script], {
      // Credential operations use a closed input pipe, never the CLI terminal
      // or interactive shell profiles. Delete operations receive empty input.
      input: options?.input ?? '',
      reject: false,
      timeout: 10_000,
    })
  } catch {
    return null
  }
}

function getFailureWarning(
  result: ReturnType<typeof execaSync> | null,
  fallback: string,
): string {
  const stderr = typeof result?.stderr === 'string' ? result.stderr.trim() : ''
  if (stderr) {
    return stderr
  }

  if (typeof result?.exitCode === 'number' && result.exitCode !== 0) {
    return `${fallback} (exit code ${result.exitCode}).`
  }

  return fallback
}

function readLegacyPasswordVault(): SecureStorageData | null {
  if (!shouldUseLegacyPasswordVault()) {
    return null
  }

  const resourceName = getLegacyResourceName().replace(/"/g, '`"')
  const username = getUsername().replace(/"/g, '`"')
  const script = `
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    try {
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      $cred = $vault.Retrieve("${resourceName}", "${username}")
      $cred.FillPassword()
      [Console]::Out.Write($cred.Password)
    } catch {
      exit 1
    }
  `

  const result = runPowerShell(script)
  const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
  if (result?.exitCode === 0 && stdout) {
    try {
      return jsonParse(stdout)
    } catch {
      return null
    }
  }

  return null
}

export const windowsCredentialStorage: SecureStorage = {
  name: 'credential-locker-dpapi',
  read(): SecureStorageData | null {
    const path = getWindowsSecureStorageFilePath()
    const rawEntropy = getWindowsSecureStorageEntropy()
    const file = readDpapiFile(path)
    if (file.kind !== 'ok') {
      readCache = null
      return readLegacyPasswordVault()
    }
    if (readCache?.path === path && readCache.entropy === rawEntropy && readCache.encrypted === file.encrypted) {
      return structuredClone(readCache.data)
    }
    readCache = null
    const entropy = escapePowerShellSingleQuoted(rawEntropy)
    const script = `
      try {
        Add-Type -AssemblyName System.Security
        $protectedBase64 = [Console]::In.ReadToEnd().Trim()
        if (-not $protectedBase64) {
          exit 1
        }

        $protectedBytes = [Convert]::FromBase64String($protectedBase64)
        $entropyBytes = [System.Text.Encoding]::UTF8.GetBytes('${entropy}')
        $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
          $protectedBytes,
          $entropyBytes,
          [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
      } catch {
        exit 1
      }
    `

    // Decrypt exactly the bytes used as the cache key, even if another
    // process replaces the file while PowerShell starts. Never use argv for it.
    const result = runPowerShell(script, { input: file.encrypted })
    const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
    if (result?.exitCode === 0 && stdout) {
      try {
        const data = jsonParse<SecureStorageData>(stdout)
        readCache = { path, entropy: rawEntropy, encrypted: file.encrypted, data: structuredClone(data) }
        return data
      } catch {
        return readLegacyPasswordVault()
      }
    }

    return readLegacyPasswordVault()
  },
  readResult(): SecureStorageReadResult {
    // Stateful read-modify-write callers must always decrypt a fresh snapshot.
    readCache = null
    const file = readDpapiFile(getWindowsSecureStorageFilePath())
    if (file.kind !== 'ok') return file
    const entropy = escapePowerShellSingleQuoted(getWindowsSecureStorageEntropy())
    const script = `
      try {
        Add-Type -AssemblyName System.Security
        $protectedBase64 = [Console]::In.ReadToEnd().Trim()
        if (-not $protectedBase64) { exit 3 }
        $protectedBytes = [Convert]::FromBase64String($protectedBase64)
        $entropyBytes = [System.Text.Encoding]::UTF8.GetBytes('${entropy}')
        $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
          $protectedBytes, $entropyBytes,
          [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
      } catch { exit 3 }
    `
    const result = runPowerShell(script, { input: file.encrypted })
    const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
    if (result?.exitCode === 0 && stdout) {
      try {
        return { kind: 'ok', data: jsonParse(stdout) }
      } catch {
        return { kind: 'error', warning: 'DPAPI returned malformed JSON.' }
      }
    }
    if (result?.exitCode === 3 && shouldUseLegacyPasswordVault()) {
      const legacy = readLegacyPasswordVault()
      if (legacy) return { kind: 'ok', data: legacy }
    }
    return { kind: 'error', warning: getFailureWarning(result, 'Windows DPAPI read failed') }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    return this.read()
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    readCache = null
    const filePath = escapePowerShellSingleQuoted(
      getWindowsSecureStorageFilePath(),
    )
    const entropy = escapePowerShellSingleQuoted(
      getWindowsSecureStorageEntropy(),
    )
    const payload = jsonStringify(data)
    const script = `
      try {
        Add-Type -AssemblyName System.Security
        $path = '${filePath}'
        $directory = [System.IO.Path]::GetDirectoryName($path)
        if ($directory) {
          [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        }

        $payload = [Console]::In.ReadToEnd()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $entropyBytes = [System.Text.Encoding]::UTF8.GetBytes('${entropy}')
        $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
          $bytes,
          $entropyBytes,
          [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $protectedBase64 = [Convert]::ToBase64String($protectedBytes)
        [System.IO.File]::WriteAllText(
          $path,
          $protectedBase64,
          (New-Object System.Text.UTF8Encoding($false))
        )
        $writtenBytes = [System.IO.File]::ReadAllBytes($path)
        $writtenText = [System.Text.Encoding]::ASCII.GetString($writtenBytes)
        if ($writtenText -cne $protectedBase64) {
          Write-Error 'DPAPI post-write validation failed: file is not exact UTF-8 base64 without BOM'
          exit 1
        }
        [void][Convert]::FromBase64String($writtenText)
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `
    const result = runPowerShell(script, { input: payload })
    if (result?.exitCode === 0) {
      return { success: true }
    }

    return {
      success: false,
      warning: getFailureWarning(
        result,
        'Windows secure storage could not encrypt credentials with DPAPI',
      ),
    }
  },
  delete(): boolean {
    readCache = null
    const filePath = escapePowerShellSingleQuoted(
      getWindowsSecureStorageFilePath(),
    )
    const removeDpapiScript = `
      try {
        $path = '${filePath}'
        if (Test-Path -LiteralPath $path) {
          Remove-Item -LiteralPath $path -Force
        }
      } catch {
        exit 1
      }
    `
    const removeDpapiResult = runPowerShell(removeDpapiScript)

    if (shouldUseLegacyPasswordVault()) {
      const resourceName = getLegacyResourceName().replace(/"/g, '`"')
      const username = getUsername().replace(/"/g, '`"')
      const removeLegacyScript = `
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        try {
          $vault = New-Object Windows.Security.Credentials.PasswordVault
          $cred = $vault.Retrieve("${resourceName}", "${username}")
          $vault.Remove($cred)
        } catch {
          exit 0
        }
      `
      const removeLegacyResult = runPowerShell(removeLegacyScript)

      void removeLegacyResult
    }

    return (removeDpapiResult?.exitCode ?? 1) === 0
  },
}
