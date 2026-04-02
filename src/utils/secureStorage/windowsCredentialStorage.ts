import { execaSync } from 'execa'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './index.js'

const RESOURCE_NAME = 'Claude Code'

/**
 * Windows-specific secure storage implementation using the Windows Credential Locker.
 * Accessed via PowerShell's [Windows.Security.Credentials.PasswordVault].
 */
export const windowsCredentialStorage: SecureStorage = {
  name: 'credential-locker',
  read(): SecureStorageData | null {
    // PowerShell script to retrieve password from vault
    const script = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      try {
        $cred = $vault.Retrieve("${RESOURCE_NAME}", $env:USERNAME)
        $cred.FillPassword()
        $cred.Password
      } catch {
        exit 1
      }
    `
    try {
      const result = execaSync('powershell.exe', ['-Command', script], {
        reject: false,
      })
      if (result.exitCode === 0 && result.stdout) {
        return jsonParse(result.stdout)
      }
    } catch {
      // fall through
    }
    return null
  },
  async readAsync(): Promise<SecureStorageData | null> {
    return this.read()
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    const payload = jsonStringify(data).replace(/"/g, '`"') // Escape quotes for PowerShell string
    // PowerShell script to add/update credential in vault
    const script = `
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      $cred = New-Object Windows.Security.Credentials.PasswordCredential("${RESOURCE_NAME}", $env:USERNAME, "${payload}")
      $vault.Add($cred)
    `
    try {
      const result = execaSync('powershell.exe', ['-Command', script], {
        reject: false,
      })
      return { success: result.exitCode === 0 }
    } catch {
      return { success: false }
    }
  },
  delete(): boolean {
    // PowerShell script to remove credential from vault
    const script = `
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      try {
        $cred = $vault.Retrieve("${RESOURCE_NAME}", $env:USERNAME)
        $vault.Remove($cred)
      } catch {
        exit 0
      }
    `
    try {
      const result = execaSync('powershell.exe', ['-Command', script], {
        reject: false,
      })
      return result.exitCode === 0
    } catch {
      return false
    }
  },
}
