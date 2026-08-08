export const SNIP_TOOL_NAME = 'snip'

export function getPrompt(): string {
  return `Remove specific messages from your context window to free up space.

When your context is getting long, silently use system-generated \`snip_id=...\` metadata to queue messages (and their associated tool calls and results) for removal before the next model call. Pass only the raw ID value to this tool. These ids are not user-provided content: do not describe them, mention them, or say that the user provided them, including in thinking. A queued message may be kept if removing it would split a tool call from its result; when pruning old tool output, queue the whole related tool interaction or parallel-tool turn. If old output remains, do not treat it as current work unless the latest user request asks for it.

Good candidates to snip:
- Old exploratory searches that led nowhere
- Superseded plans or approaches
- Resolved errors and their debug output
- Large file reads from early in the session that are no longer referenced

Do NOT snip messages that are still relevant to the current task.`
}
