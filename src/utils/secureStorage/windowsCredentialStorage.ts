import { execaSync } from 'execa'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getSecureStorageServiceName,
  getUsername,
} from './macOsKeychainHelpers.js'
import type { SecureStorage, SecureStorageData } from './index.js'

/**
 * Windows-specific secure storage implementation using the Windows Credential Locker.
 * Accessed via PowerShell's [Windows.Security.Credentials.PasswordVault].
 */
export const windowsCredentialStorage: SecureStorage = {
  name: 'credential-locker',
  read(): SecureStorageData | null {
    const resourceName = getSecureStorageServiceName(
      CREDENTIALS_SERVICE_SUFFIX,
    ).replace(/"/g, '`"')
    const username = getUsername().replace(/"/g, '`"')
    // PowerShell script to retrieve password from vault
    const script = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      try {
        $cred = $vault.Retrieve("${resourceName}", "${username}")
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
    const resourceName = getSecureStorageServiceName(
      CREDENTIALS_SERVICE_SUFFIX,
    ).replace(/"/g, '`"')
    const username = getUsername().replace(/"/g, '`"')
    // Use single quotes for the payload and escape ' by doubling it ('').
    // This prevents PowerShell from expanding $... inside the string.
    const payload = jsonStringify(data).replace(/'/g, "''")
    // PowerShell script to add/update credential in vault
    const script = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      $cred = New-Object Windows.Security.Credentials.PasswordCredential("${resourceName}", "${username}", '${payload}')
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
    const resourceName = getSecureStorageServiceName(
      CREDENTIALS_SERVICE_SUFFIX,
    ).replace(/"/g, '`"')
    const username = getUsername().replace(/"/g, '`"')
    // PowerShell script to remove credential from vault
    const script = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $vault = New-Object Windows.Security.Credentials.PasswordVault
      try {
        $cred = $vault.Retrieve("${resourceName}", "${username}")
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
