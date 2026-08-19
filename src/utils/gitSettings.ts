// Git-related behaviors that depend on user settings.
//
// This lives outside git.ts because git.ts is in the vscode extension's
// dep graph and must stay free of settings.ts, which transitively pulls
// @opentelemetry/api + undici (forbidden in vscode). It's also a cycle:
// settings.ts → git/gitignore.ts → git.ts, so git.ts → settings.ts loops.
//
// If you're tempted to add `import settings` to git.ts — don't. Put it here.

import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

// Cheap upward .git probe (no child process, no git.ts dependency — see the
// header comment): the ~1.7k-token commit/PR protocol in the Bash tool
// description is pure waste outside a repository. Cached per cwd, not
// per process — worktree tools and setup call process.chdir() mid-session,
// and a daemon/SDK process can serve sessions in different directories.
const gitRepoCacheByCwd = new Map<string, boolean>()
function isInsideGitRepo(): boolean {
  const cwd = process.cwd()
  const cached = gitRepoCacheByCwd.get(cwd)
  if (cached !== undefined) return cached
  let dir = cwd
  let result = false
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      result = true
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  gitRepoCacheByCwd.set(cwd, result)
  return result
}

export function shouldIncludeGitInstructions(): boolean {
  const envVal = process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(envVal)) return false
  if (isEnvDefinedFalsy(envVal)) return true
  if (!isInsideGitRepo()) return false
  return getInitialSettings().includeGitInstructions ?? true
}
