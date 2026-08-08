/**
 * Input passed (as JSON on stdin) to the user's configured fileSuggestion
 * command. Built in src/hooks/fileSuggestions.ts and consumed by
 * executeFileSuggestionCommand in src/utils/hooks.ts.
 */

export type FileSuggestionCommandInput = {
  // Base hook input (createBaseHookInput)
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string

  /** The partial path the user has typed so far. */
  query: string
}
