import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'

export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | undefined,
): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { restoreContextCollapseState } =
    require('./index.js') as typeof import('./index.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  restoreContextCollapseState(commits, snapshot)
}
