export type SessionTurnUploader = (args?: unknown) => Promise<void>

export async function createSessionTurnUploader(): Promise<SessionTurnUploader> {
  return async () => {}
}
