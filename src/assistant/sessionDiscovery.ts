/**
 * Session discovery stub for the open build.
 *
 * In the Anthropic-internal build, this discovers remote assistant sessions
 * running on bridge infrastructure. In the open build, assistant mode runs
 * locally — there are no remote sessions to discover.
 */

export type AssistantSession = { id: string; name: string }

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
