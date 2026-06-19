/**
 * Assistant session discovery (KAIROS-gated).
 *
 * The closed-source implementation lists bridge environments and filters
 * for assistant-mode sessions (`worker_type === 'claude_code_assistant'`)
 * so `claude assistant` can attach to a running daemon. This open-source
 * build ships an inert version that discovers nothing.
 */

/** A discoverable remote assistant session. */
export type AssistantSession = {
  /** Bridge session id used to attach. */
  id: string
  /** Human-readable session title, when set. */
  title?: string
  /** Working directory of the remote session. */
  dir?: string
  /** Hostname of the machine running the daemon. */
  machineName?: string
  /** ISO timestamp of the most recent activity. */
  updatedAt?: string
}

/**
 * List remote assistant sessions for the current account.
 * Always returns an empty list in this build.
 */
export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
