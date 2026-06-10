export type Workflow = 'claude' | 'claude-review'

export type Warning = {
  title: string
  message: string
  instructions: string[]
}

export type ApiKeyOption = 'existing' | 'new' | 'oauth'

export type AuthType = 'api_key' | 'oauth_token'

export type WorkflowAction = 'update' | 'skip' | 'exit'

export type InstallGitHubAppStep =
  | 'check-gh'
  | 'warnings'
  | 'choose-repo'
  | 'install-app'
  | 'check-existing-workflow'
  | 'select-workflows'
  | 'check-existing-secret'
  | 'api-key'
  | 'creating'
  | 'success'
  | 'error'
  | 'oauth-flow'

export type State = {
  step: InstallGitHubAppStep
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
  selectedApiKeyOption: ApiKeyOption
  authType: AuthType
  workflowAction?: WorkflowAction
  error?: string
  errorReason?: string
  errorInstructions?: string[]
}
