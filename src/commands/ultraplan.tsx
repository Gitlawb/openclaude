// Stub: ultraplan not available in Forge builds
import type { AppState } from '../state/AppStateStore.js'

export const CCR_TERMS_URL = ''

export function buildUltraplanPrompt(_blurb: string, _seedPlan?: string): string {
  return ''
}

export async function stopUltraplan(
  _taskId: string,
  _sessionId: string,
  _setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {}

export async function launchUltraplan(_opts: Record<string, unknown>): Promise<void> {}

const command = {
  type: 'local-jsx' as const,
  name: 'ultraplan',
  description: 'Launch ultraplan (not available in Forge builds)',
  isEnabled: () => false,
  isHidden: true,
  userFacingName: () => 'ultraplan',
  load: async () => ({
    call: async () => null,
  }),
}

export default command
