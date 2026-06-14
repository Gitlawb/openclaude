export const CTX_INSPECT_TOOL_NAME = 'ctx_inspect'

export function getPrompt(): string {
  return `Inspect context collapse state to understand what spans have been collapsed and what spans are staged for collapse.

Use this tool when you need to understand the current state of context management - what's been summarized away and what's queued for summarization.

This is a read-only introspection tool. It has no side effects.`
}
