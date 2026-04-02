import type { AppState } from '../state/AppStateStore.js'

type AssistantTeamContext = AppState['teamContext']

let assistantForced = false

export function markAssistantForced(): void {
  assistantForced = true
}

export function isAssistantForced(): boolean {
  return assistantForced
}

export function isAssistantMode(): boolean {
  return assistantForced
}

export async function initializeAssistantTeam(): Promise<AssistantTeamContext> {
  return {
    teamName: 'assistant',
    teamFilePath: '',
    leadAgentId: 'assistant',
    selfAgentId: 'assistant',
    selfAgentName: 'assistant',
    isLeader: true,
    teammates: {},
  }
}

export function getAssistantSystemPromptAddendum(): string {
  return ''
}

export function getAssistantActivationPath(): string | undefined {
  return undefined
}
