import { execaSync } from 'execa'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getSecureStorageServiceName,
  getUsername,
} from './macOsKeychainHelpers.js'
import type { SecureStorage, SecureStorageData } from './index.js'

const SECRET_TOOL_MISSING_HINT =
  "secret-tool is not installed. Install libsecret-tools (Debian/Ubuntu: 'apt install libsecret-tools', Fedora: 'dnf install libsecret') and ensure a Secret Service provider (gnome-keyring or KWallet) is running."
const SECRET_TOOL_RUNTIME_HINT =
  "secret-tool failed to talk to the Secret Service. Make sure gnome-keyring or KWallet is running and the default keyring is unlocked (this commonly fails over SSH without an active desktop session)."

function isMissingSecretToolError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'ENOENT') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /ENOENT|not found|no such file/i.test(message)
}

function buildSecretToolFailureWarning(
  result: ReturnType<typeof execaSync> | null,
  thrown: unknown,
): string {
  if (isMissingSecretToolError(thrown)) {
    return SECRET_TOOL_MISSING_HINT
  }

  const stderr = result?.stderr?.toString().trim()
  if (stderr) {
    return `secret-tool: ${stderr}`
  }

  if (typeof result?.exitCode === 'number' && result.exitCode !== 0) {
    return `${SECRET_TOOL_RUNTIME_HINT} (exit code ${result.exitCode})`
  }

  return SECRET_TOOL_RUNTIME_HINT
}

/**
 * Linux-specific secure storage implementation using the secret-tool CLI.
 * secret-tool interacts with the Secret Service API (GNOME Keyring, KWallet, etc.).
 */
export const linuxSecretStorage: SecureStorage = {
  name: 'libsecret',
  read(): SecureStorageData | null {
    try {
      const username = getUsername()
      const serviceName = getSecureStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      // secret-tool lookup service [service] account [account]
      const result = execaSync(
        'secret-tool',
        ['lookup', 'service', serviceName, 'account', username],
        { reject: false },
      )

      if (result.exitCode === 0 && result.stdout) {
        return jsonParse(result.stdout)
      }
    } catch {
      // fall through
    }
    return null
  },
  async readAsync(): Promise<SecureStorageData | null> {
    // Reusing sync implementation for simplicity as it wraps a CLI call
    return this.read()
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    let result: ReturnType<typeof execaSync> | null = null
    try {
      const username = getUsername()
      const serviceName = getSecureStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      const payload = jsonStringify(data)
      // secret-tool store --label=[label] service [service] account [account]
      // The payload is passed via stdin
      result = execaSync(
        'secret-tool',
        [
          'store',
          '--label',
          serviceName,
          'service',
          serviceName,
          'account',
          username,
        ],
        { input: payload, reject: false },
      )

      if (result.exitCode === 0) {
        return { success: true }
      }

      return {
        success: false,
        warning: buildSecretToolFailureWarning(result, null),
      }
    } catch (error) {
      return {
        success: false,
        warning: buildSecretToolFailureWarning(result, error),
      }
    }
  },
  delete(): boolean {
    try {
      const username = getUsername()
      const serviceName = getSecureStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      // secret-tool clear service [service] account [account]
      const result = execaSync(
        'secret-tool',
        ['clear', 'service', serviceName, 'account', username],
        { reject: false },
      )
      return result.exitCode === 0
    } catch {
      return false
    }
  },
}
