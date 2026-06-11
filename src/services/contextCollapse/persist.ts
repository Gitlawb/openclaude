// Stub — contextCollapse not included in source snapshot (feature-gated).
// Persistence/restore of collapse state across --resume. Inert no-op.
import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'

/**
 * Restore collapse state from transcript log entries on session resume.
 * Inert: collapse is disabled in this snapshot, so restored entries are
 * intentionally dropped.
 */
export function restoreFromEntries(
  _commits: ContextCollapseCommitEntry[],
  _snapshot: ContextCollapseSnapshotEntry | undefined,
): void {}
