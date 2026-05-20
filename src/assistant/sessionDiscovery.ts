export type AssistantSession = {
  id: string
  label?: string
  cwd?: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
