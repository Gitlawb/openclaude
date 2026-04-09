// Stub: remote background services not available in Forge builds

export type BackgroundRemoteSession = {
  id: string
  command: string
  startTime: number
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed'
  todoList: unknown
  title: string
  type: 'remote_session'
  log: unknown[]
}

export type BackgroundRemoteSessionPrecondition =
  | { type: 'not_logged_in' }
  | { type: 'no_remote_environment' }
  | { type: 'not_in_git_repo' }
  | { type: 'no_git_remote' }
  | { type: 'github_app_not_installed' }
  | { type: 'policy_blocked' }

export async function checkBackgroundRemoteSessionEligibility(): Promise<BackgroundRemoteSessionPrecondition[]> {
  return [{ type: 'not_logged_in' }]
}
