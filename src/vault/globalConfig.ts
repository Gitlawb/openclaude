/**
 * PIF-B per-machine config + global-vault path resolution.
 *
 * Lives at `~/.bridgeai/config.json` (Linux/macOS) or
 * `%APPDATA%\bridgeai\config.json` (Windows). Records the resolved global
 * vault path AND the dev's accept/decline state from the first-machine
 * prompt. Does NOT duplicate per-project state — that lives in
 * `<repo>/.bridgeai/vault/` (PIF-A's `cfg.local`).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Persisted state at the resolved machine-config path. */
export interface MachineConfig {
  /** Resolved absolute path of the global vault (set when bootstrap accepted). */
  globalVaultPath?: string
  /**
   * True ⇒ dev declined the first-machine prompt; suppresses re-prompts
   * forever (until `bridgeai vault enable-global` flips it back).
   */
  declinedGlobalVault?: boolean
}

/** Cross-platform path to the per-machine config file. */
export function resolveMachineConfigPath(): string {
  if (process.env.BRIDGEAI_MACHINE_CONFIG_PATH) {
    // Test/diagnostic override — undocumented for end users.
    return process.env.BRIDGEAI_MACHINE_CONFIG_PATH
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'bridgeai', 'config.json')
  }
  return join(homedir(), '.bridgeai', 'config.json')
}

/**
 * Load the machine config. Returns `{}` when the file is missing OR
 * malformed (silent recovery — corrupted config must not block the dev).
 */
export function loadMachineConfig(): MachineConfig {
  const path = resolveMachineConfigPath()
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as MachineConfig
  } catch {
    return {}
  }
}

/**
 * Write the machine config. Creates the parent directory if missing and
 * sets file mode `0600` so the path stays user-only.
 */
export function saveMachineConfig(cfg: MachineConfig): void {
  const path = resolveMachineConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf-8')
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows + some FUSE filesystems don't support POSIX modes — best effort.
  }
}
