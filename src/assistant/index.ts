/**
 * Assistant mode module for the open build.
 *
 * Imported by main.tsx:81 via:
 *   const assistantModule = feature('KAIROS')
 *     ? require('./assistant/index.js') : null;
 *
 * Provides the core API for KAIROS assistant/daemon mode:
 * - Activation detection (settings.json or --assistant flag)
 * - Team context initialization for agent spawning
 * - System prompt addendum for assistant behavior
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '../utils/state.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { setCliTeammateModeOverride } from '../utils/swarm/backends/teammateModeSnapshot.js'
import { randomUUID } from '../utils/crypto.js'

// ── Module-level state ──────────────────────────────────────────────

let _forced = false

// ── Public API consumed by main.tsx, bridge, etc. ───────────────────

/**
 * Returns true if running in assistant mode — either forced via
 * --assistant CLI flag or opted in via settings.json { assistant: true }.
 */
export function isAssistantMode(): boolean {
  if (_forced) return true
  const settings = getInitialSettings()
  return (settings as Record<string, unknown>).assistant === true
}

/**
 * Mark assistant mode as forced (called when --assistant flag is passed).
 * The daemon has already checked entitlement — don't re-check the gate.
 */
export function markAssistantForced(): void {
  _forced = true
}

/**
 * Returns true if assistant mode was forced via markAssistantForced().
 * Used to skip the GrowthBook gate check (daemon is pre-entitled).
 */
export function isAssistantForced(): boolean {
  return _forced
}

/**
 * Pre-seed an in-process team context so Agent(name: "foo") spawns
 * teammates without an explicit TeamCreate call. Must run BEFORE
 * setup() captures the teammateMode snapshot.
 */
export async function initializeAssistantTeam(): Promise<{
  teamName: string
  teamFilePath: string
  leadAgentId: string
  selfAgentName: string
  isLeader: boolean
  teammates: Record<string, unknown>
}> {
  // Set teammate mode to in-process so spawned agents run as threads,
  // not separate tmux panes.
  setCliTeammateModeOverride('in-process')

  const teamName = 'assistant'
  const leadAgentId = randomUUID()

  return {
    teamName,
    teamFilePath: join(getCwd(), '.claude', 'team.json'),
    leadAgentId,
    selfAgentName: 'assistant',
    isLeader: true,
    teammates: {},
  }
}

/**
 * Returns assistant-specific system prompt instructions appended
 * after the main system prompt. Instructs the model about its role
 * as a persistent assistant, Brief tool usage, and cron awareness.
 *
 * If .claude/agents/assistant.md exists in the project, its content
 * is loaded and appended.
 */
export function getAssistantSystemPromptAddendum(): string {
  const parts: string[] = []

  parts.push(`# Assistant Mode

You are running as a persistent assistant. Key behaviors:

- Use the SendUserMessage tool to communicate important updates to the user.
- You may receive scheduled prompts from cron tasks — handle them proactively.
- When idle with no pending work, you may Sleep to conserve resources.
- The user can interact with you at any time by sending messages.`)

  // Load project-specific assistant instructions if present
  try {
    const agentMdPath = join(getCwd(), '.claude', 'agents', 'assistant.md')
    if (existsSync(agentMdPath)) {
      const content = readFileSync(agentMdPath, 'utf-8').trim()
      if (content) {
        parts.push(`\n# Project Assistant Instructions\n\n${content}`)
      }
    }
  } catch {
    // Silently ignore read errors
  }

  return parts.join('\n')
}

/**
 * Returns the activation path for analytics metadata.
 */
export function getAssistantActivationPath(): string | undefined {
  return _forced ? 'cli-flag' : 'settings'
}
