export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type AnyZodRawShape = Record<string, unknown>

export type InferShape<Schema> = Schema extends Record<string, infer Value>
  ? Record<string, Value>
  : Record<string, unknown>

export type Options = Record<string, unknown>
export type InternalOptions = Options & {
  isInternal?: boolean
}
export type Query = AsyncIterable<unknown>
export type InternalQuery = Query

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  includeHistory?: boolean
}

export type ForkSessionResult = {
  sessionId: string
}

export type SessionMessage = Record<string, unknown>

export type SDKSessionOptions = {
  cwd?: string
  model?: string
  permissionMode?: string
}

export type SDKSession = {
  id: string
  options?: SDKSessionOptions
}

export type SdkMcpToolDefinition<Schema = AnyZodRawShape> = {
  name?: string
  description?: string
  inputSchema?: Schema
}

export type McpSdkServerConfigWithInstance = {
  name?: string
  version?: string
  tools?: SdkMcpToolDefinition[]
  instance?: unknown
}
