/**
 * PIF-C `_log.md` append helpers — record dev confirmations and aborts to
 * the affected vault's audit trail.
 *
 * Best-effort: a failing `_log.md` write is swallowed so it cannot block a
 * confirmed user action. The audit trail is informational, not a gate.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultConfig } from '../types.js'
import type { NeedsInput, Resolution } from './contract.js'

/**
 * Pick the vault root path matching `needs.affectedVault`. Silently falls
 * back to `local` when the dev hasn't configured a global vault — never
 * crashes for a missing global path.
 */
function targetVaultPath(cfg: VaultConfig, needs: NeedsInput): string {
  if (needs.affectedVault === 'global' && cfg.global) {
    return cfg.global.path
  }
  return cfg.local.path
}

function appendLine(vaultPath: string, line: string): void {
  try {
    mkdirSync(vaultPath, { recursive: true })
    const logPath = join(vaultPath, '_log.md')
    if (!existsSync(logPath)) {
      writeFileSync(logPath, `# Vault log\n\n${line}\n`, 'utf-8')
      return
    }
    const content = readFileSync(logPath, 'utf-8')
    const needsNl = content.length > 0 && !content.endsWith('\n')
    writeFileSync(logPath, content + (needsNl ? '\n' : '') + line + '\n', 'utf-8')
  } catch {
    // Best-effort. Audit trail must never block a confirmed user action.
  }
}

/**
 * Record a `dev-confirmed` entry. `autoMarker` is an optional string like
 * `'BRIDGEAI_AUTO_CONFIRM'` or `'yes-to-all'` that's appended as
 * `(auto: <marker>)` so the audit trail records auto-acceptances explicitly.
 */
export function appendDevConfirmed(
  cfg: VaultConfig,
  needs: NeedsInput,
  answer: string,
  autoMarker: string | null,
): void {
  const ts = new Date().toISOString()
  const auto = autoMarker ? `  (auto: ${autoMarker})` : ''
  const line = `- ${ts}  dev-confirmed  ${needs.kind}  ${needs.question}  answer=${answer}${auto}  source: code-analysis`
  appendLine(targetVaultPath(cfg, needs), line)
}

/** Record a `dev-aborted` entry with the resolver's documented abort reason. */
export function appendDevAborted(
  cfg: VaultConfig,
  needs: NeedsInput,
  reason: Extract<Resolution, { resolved: false }>['reason'],
): void {
  const ts = new Date().toISOString()
  const line = `- ${ts}  dev-aborted  ${needs.kind}  ${needs.question}  reason=${reason}  source: code-analysis`
  appendLine(targetVaultPath(cfg, needs), line)
}
