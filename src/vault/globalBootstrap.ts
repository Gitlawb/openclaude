/**
 * PIF-B global vault bootstrap.
 *
 * Idempotent first-machine setup. When the resolved global vault path is a
 * fresh dir, runs `git init` and scaffolds the v2 tree. When the path
 * already contains `.git`, accepts it as-is and re-scaffolds (existing
 * files are preserved by the scaffold writer's "create if missing"
 * semantics).
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { bootstrapVault } from './scaffold.js'
import {
  loadMachineConfig,
  saveMachineConfig,
} from './globalConfig.js'
import type { ProviderType, VaultConfig } from './types.js'

export interface BootstrapGlobalResult {
  path: string
  initializedGit: boolean
  scaffoldedFromScratch: boolean
}

export interface BootstrapGlobalOptions {
  /** Provider hint for the global vault's manifest. Default `'generic'`. */
  provider?: ProviderType
}

function appendBootstrapLog(
  vaultPath: string,
  initializedGit: boolean,
): void {
  try {
    const logPath = join(vaultPath, '_log.md')
    const ts = new Date().toISOString()
    const line = `- ${ts}  global-vault-bootstrapped  path=${vaultPath} initializedGit=${initializedGit}  source: code-analysis\n`
    if (!existsSync(logPath)) {
      writeFileSync(logPath, `# Vault log\n\n${line}`, 'utf-8')
      return
    }
    const content = readFileSync(logPath, 'utf-8')
    const needsNl = content.length > 0 && !content.endsWith('\n')
    writeFileSync(logPath, content + (needsNl ? '\n' : '') + line, 'utf-8')
  } catch {
    // Best-effort. Audit trail must never block bootstrap.
  }
}

/**
 * Bootstrap (or re-scaffold) the global vault at `targetPath`. After
 * success, the machine config records the resolved path so future
 * `resolveGlobalVault()` calls return `{ kind: 'configured' }`.
 */
export async function bootstrapGlobalVault(
  targetPath: string,
  opts: BootstrapGlobalOptions = {},
): Promise<BootstrapGlobalResult> {
  // 1. Ensure the directory exists.
  mkdirSync(targetPath, { recursive: true })

  // 2. `git init` if no .git yet.
  let initializedGit = false
  const dotGit = join(targetPath, '.git')
  if (!existsSync(dotGit)) {
    const result = spawnSync('git', ['init', '-q'], {
      cwd: targetPath,
      stdio: 'pipe',
    })
    if (result.status !== 0) {
      throw new Error(
        `git init failed at ${targetPath}: ${result.stderr?.toString() ?? '(no stderr)'}`,
      )
    }
    initializedGit = true
  }

  // 3. Build a global-vault VaultConfig and run bootstrapVault.
  //    The global vault is its own "project" for scaffold purposes — its
  //    projectRoot is itself, since there's no surrounding repo.
  const globalCfg: VaultConfig = {
    local: { path: targetPath },
    global: null,
    vaultPath: targetPath,
    provider: opts.provider ?? 'generic',
    projectName: 'global',
    projectRoot: targetPath,
  }

  // bootstrapVault is "create if missing" — re-scaffolding an existing
  // global vault won't clobber user-edited notes. Treat the result as
  // scaffoldedFromScratch only when we just created the .git.
  await bootstrapVault(globalCfg, { gitignore: false })
  appendBootstrapLog(targetPath, initializedGit)

  // 4. Persist the resolved path in the machine config.
  const cfg = loadMachineConfig()
  saveMachineConfig({
    ...cfg,
    globalVaultPath: targetPath,
    declinedGlobalVault: false,
  })

  return {
    path: targetPath,
    initializedGit,
    scaffoldedFromScratch: initializedGit,
  }
}
