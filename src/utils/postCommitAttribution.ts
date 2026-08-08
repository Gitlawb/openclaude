/**
 * Inert stub for commit-attribution git hook installation.
 *
 * The real implementation is not part of this source tree; the bundler
 * noop-stubs this specifier in builds where `feature('COMMIT_ATTRIBUTION')`
 * is disabled. This module preserves that behavior: no git hooks are
 * installed and no import-time side effects occur.
 */

/**
 * Install the prepare-commit-msg attribution hook into a worktree.
 * Inert: resolves without touching the filesystem or git config.
 *
 * @param _worktreePath Absolute path to the worktree root.
 * @param _hooksDir Optional explicit hooks directory (e.g. the
 *   worktree-local `.husky/`); when omitted the repo's hooks dir is used.
 */
export async function installPrepareCommitMsgHook(
  _worktreePath: string,
  _hooksDir?: string,
): Promise<void> {
  // no-op
}
