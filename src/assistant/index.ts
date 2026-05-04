/**
 * Stub — assistant module not included in source snapshot.
 * All consumers guard access behind `feature('KAIROS')`, so these
 * stubs are never invoked at runtime in the open-source build.
 * See issue #473 for the typecheck-foundation effort.
 */

export function isAssistantMode(): boolean {
  return false
}

export function isAssistantForced(): boolean {
  return false
}

export function markAssistantForced(): void {}

export async function initializeAssistantTeam(): Promise<undefined> {
  return undefined
}

export function getAssistantSystemPromptAddendum(): string {
  return ''
}

export function getAssistantActivationPath(): string | undefined {
  return undefined
}
