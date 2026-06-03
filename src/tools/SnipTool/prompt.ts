export const SNIP_TOOL_NAME = 'snip'

export function getPrompt(): string {
  return `Remove specific messages from your context window to free up space.

When your context is getting long, look for \`[id:XXXXXX]\` tags appended to user messages. Pass those IDs to this tool to queue those messages (and their associated tool calls and results) for removal before the next model call. A queued message is kept if removing it would orphan a tool call (for example, snipping one result from a turn that ran several tools in parallel); if a message you queued still shows its \`[id:...]\` tag next turn, it was kept.

Good candidates to snip:
- Old exploratory searches that led nowhere
- Superseded plans or approaches
- Resolved errors and their debug output
- Large file reads from early in the session that are no longer referenced

Do NOT snip messages that are still relevant to the current task.`
}
