export async function sendToUdsSocket(
  _target: string,
  _message: string,
): Promise<void> {}

export async function listAllLiveSessions(): Promise<
  Array<{ kind?: string; sessionId?: string }>
> {
  return []
}
