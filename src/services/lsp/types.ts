export type LspServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
  disabled?: boolean
  initializationOptions?: Record<string, unknown>
}

export type ScopedLspServerConfig = LspServerConfig & {
  scope: 'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'managed'
}
