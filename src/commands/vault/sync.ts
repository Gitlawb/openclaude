/**
 * PIF-B `bridgeai vault sync` — thin git wrapper.
 *
 * git pull --rebase && git push, with merge conflicts surfaced via the
 * PIF-C escape hatch. Manual remote config per D-1: when no remote is
 * configured the command exits with an actionable error message; it does
 * NOT auto-set up the remote.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command, LocalCommandCall } from '../../types/command.js'

interface GitResult {
  status: number
  stdout: string
  stderr: string
}

function runGit(cwd: string, args: string[]): GitResult {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe' })
  return {
    status: r.status ?? -1,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
  }
}

const call: LocalCommandCall = async () => {
  const { resolveVaultConfig } = await import('../../vault/config.js')
  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const { createResolverContext, createReadlineProvider } = await import(
    '../../vault/escapeHatch/index.js'
  )
  const { resolveNeedsInput } = await import('../../vault/escapeHatch/resolver.js')

  const cfg = resolveVaultConfig(getOriginalCwd())

  if (!cfg.global) {
    process.exitCode = 1
    return {
      type: 'text',
      value:
        'No global vault configured. Run `bridgeai vault enable-global` and re-launch bridgeai to bootstrap, or set $BRIDGEAI_GLOBAL_VAULT.',
    }
  }
  const vaultPath = cfg.global.path

  if (!existsSync(join(vaultPath, '.git'))) {
    process.exitCode = 1
    return {
      type: 'text',
      value: `Vault at ${vaultPath} is not a git repo. Cannot sync.`,
    }
  }

  // D-1: no auto-configuration of the remote.
  const remoteCheck = runGit(vaultPath, ['remote', 'get-url', 'origin'])
  if (remoteCheck.status !== 0) {
    process.exitCode = 1
    return {
      type: 'text',
      value:
        `No git remote configured for global vault at ${vaultPath}.\n` +
        `Set one up with: cd ${vaultPath} && git remote add origin <your-url>\n` +
        'Then re-run `bridgeai vault sync`.',
    }
  }

  // git pull --rebase
  const pull = runGit(vaultPath, ['pull', '--rebase'])
  let pulled = 0
  if (pull.status !== 0) {
    if (pull.stderr.includes('CONFLICT') || pull.stdout.includes('CONFLICT')) {
      // PIF-C escape hatch for the merge conflict.
      const escapeHatch = createResolverContext(cfg, {
        provider: process.stdin.isTTY ? createReadlineProvider() : null,
      })
      const resolution = await resolveNeedsInput(
        {
          status: 'needs-input',
          kind: 'sync-conflict-resolve',
          question: `Merge conflict during \`git pull --rebase\` in ${vaultPath}. How to resolve?`,
          // accept-local first per design — preserves the dev's just-made
          // changes when auto-confirm is on.
          suggestedAnswers: ['accept-local', 'accept-remote', 'manual-edit'],
          affectedVault: 'global',
          context: { stderr: pull.stderr.slice(0, 500) },
        },
        escapeHatch,
      )

      if (!resolution.resolved) {
        process.exitCode = 2
        runGit(vaultPath, ['rebase', '--abort'])
        return {
          type: 'text',
          value: `Sync aborted: ${resolution.reason}. Conflict left unresolved; rebase aborted.`,
        }
      }

      const choice = resolution.answer
      if (choice === 'accept-local') {
        runGit(vaultPath, ['checkout', '--ours', '.'])
        runGit(vaultPath, ['add', '.'])
        const cont = runGit(vaultPath, ['rebase', '--continue'])
        if (cont.status !== 0) {
          process.exitCode = 1
          return {
            type: 'text',
            value: `Conflict resolution failed during rebase --continue: ${cont.stderr}`,
          }
        }
      } else if (choice === 'accept-remote') {
        runGit(vaultPath, ['checkout', '--theirs', '.'])
        runGit(vaultPath, ['add', '.'])
        const cont = runGit(vaultPath, ['rebase', '--continue'])
        if (cont.status !== 0) {
          process.exitCode = 1
          return {
            type: 'text',
            value: `Conflict resolution failed during rebase --continue: ${cont.stderr}`,
          }
        }
      } else {
        // 'manual-edit' or any other answer
        runGit(vaultPath, ['rebase', '--abort'])
        return {
          type: 'text',
          value: `Aborted rebase. Resolve conflicts in ${vaultPath} manually, commit, then re-run \`bridgeai vault sync\`.`,
        }
      }
    } else {
      process.exitCode = 1
      return {
        type: 'text',
        value: `git pull --rebase failed: ${pull.stderr.trim()}`,
      }
    }
  } else {
    // Rough count of incoming changes (best-effort). Look for "Fast-forward"
    // or other indicators in stdout. If none, treat as 0.
    if (pull.stdout.includes('Updating') || pull.stdout.includes('Fast-forward')) {
      pulled = 1
    }
  }

  // git push
  const push = runGit(vaultPath, ['push'])
  if (push.status !== 0) {
    process.exitCode = 1
    return {
      type: 'text',
      value: `git push failed: ${push.stderr.trim()}`,
    }
  }

  return {
    type: 'text',
    value: `Synced. Pulled ${pulled === 0 ? 'no' : 'some'} changes, push succeeded.`,
  }
}

const vaultSync = {
  type: 'local',
  name: 'vault-sync',
  description:
    'Sync the global vault via git pull --rebase + git push. Surfaces merge conflicts via the escape hatch.',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultSync
