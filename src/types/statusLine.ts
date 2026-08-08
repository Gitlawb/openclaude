/**
 * Input passed (as JSON on stdin) to the user's configured statusLine
 * command. Built in src/components/StatusLine.tsx and consumed by
 * executeStatusLineCommand in src/utils/hooks.ts.
 *
 * This shape is part of the public statusline contract — fields are
 * additive-only.
 */

import type { VimMode } from './textInputTypes.js'

type StatusLineRateLimitWindow = {
  /** 0-100. */
  used_percentage: number
  /** Unix epoch seconds. */
  resets_at: number
}

export type StatusLineCommandInput = {
  // Base hook input (createBaseHookInput)
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string

  /** Present when the session has a title. */
  session_name?: string
  model: {
    id: string
    display_name: string
  }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
  }
  version: string
  output_style: {
    name: string
  }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number
    total_output_tokens: number
    /**
     * Present when session totals include transcript-based estimates for one
     * or more turns whose provider did not report token usage.
     */
    total_tokens_are_estimated?: boolean
    context_window_size: number
    current_usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
      /**
       * Present when the active provider did not report token usage and
       * OpenClaude estimated the current context from the transcript.
       */
      is_estimated?: boolean
    } | null
    used_percentage: number | null
    remaining_percentage: number | null
  }
  exceeds_200k_tokens: boolean
  rate_limits?: {
    five_hour?: StatusLineRateLimitWindow
    seven_day?: StatusLineRateLimitWindow
  }
  vim?: {
    mode: VimMode
  }
  agent?: {
    name: string
  }
  remote?: {
    session_id: string
  }
  worktree?: {
    name: string
    path: string
    branch: string | undefined
    original_cwd: string
    original_branch: string | undefined
  }
}
