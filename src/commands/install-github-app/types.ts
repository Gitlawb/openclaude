export type Workflow = 'claude' | 'claude-review'

export type Warning = {
  title: string
  message: string
  instructions: string[]
}

export type State = {
  step: string
  selectedRepoName: string
  currentRepo: string
  useCurrentRepo: boolean
  apiKeyOrOAuthToken: string
  useExistingKey: boolean
  currentWorkflowInstallStep: number
  warnings: Warning[]
  secretExists: boolean
  secretName: string
  useExistingSecret: boolean
  workflowExists: boolean
  selectedWorkflows: Workflow[]
  selectedApiKeyOption: 'existing' | 'new' | 'oauth'
  authType: 'api_key' | 'oauth_token'
  workflowAction?: 'update' | 'skip' | 'exit'
  error?: string
  errorReason?: string
  errorInstructions?: string[]
  [key: string]: any
}
