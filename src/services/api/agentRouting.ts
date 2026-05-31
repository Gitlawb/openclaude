import type { SettingsJson } from '../../utils/settings/types.js'

/**
 * Provider override resolved from agent routing config.
 * When present, the API client should use these instead of global env vars.
 */
export interface ProviderOverride {
  /** Model name to send to the API (e.g. "deepseek-chat", "gpt-4o") */
  model: string
  /** OpenAI-compatible base URL */
  baseURL: string
  /** API key for this provider */
  apiKey: string
}

export interface AgentRunModelRouting {
  mainLoopModel: string
  providerOverride?: ProviderOverride
}

const PROVIDER_ENV_VARS_TO_CLEAR_FOR_OVERRIDE = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
  'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  'NVIDIA_NIM',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_BASE_URL',
  'MISTRAL_MODEL',
  'MISTRAL_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_FORMAT',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_SCHEME',
  'OPENAI_AUTH_HEADER_VALUE',
] as const

/**
 * Normalize an agent identifier for case-insensitive, hyphen/underscore-agnostic matching.
 */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

/**
 * Look up agent.routing by name or subagent_type, then resolve via agent.models.
 *
 * Priority: name > subagentType > "default" > null (use global provider)
 */
export function resolveAgentProvider(
  name: string | undefined,
  subagentType: string | undefined,
  settings: SettingsJson | null,
): ProviderOverride | null {
  if (!settings) return null

  const routing = settings.agentRouting
  const models = settings.agentModels
  if (!routing || !models) return null

  // Build normalized lookup from routing config.
  // Warn on duplicate normalized keys (e.g. "explore-agent" and "explore_agent"
  // both normalize to "exploreagent") to prevent silent shadowing.
  const normalizedRouting = new Map<string, string>()
  for (const [key, value] of Object.entries(routing)) {
    const nk = normalize(key)
    if (normalizedRouting.has(nk)) {
      console.error(
        `[agentRouting] Warning: routing key "${key}" collides with an existing key after normalization (both map to "${nk}"). First entry wins.`,
      )
    }
    if (!normalizedRouting.has(nk)) {
      normalizedRouting.set(nk, value)
    }
  }

  // Try name first, then subagentType, then "default"
  const candidates = [name, subagentType, 'default'].filter(Boolean) as string[]
  let modelName: string | undefined

  for (const candidate of candidates) {
    const match = normalizedRouting.get(normalize(candidate))
    if (match) {
      modelName = match
      break
    }
  }

  if (!modelName) return null

  const modelConfig = models[modelName]
  if (!modelConfig) return null

  return {
    model: modelName,
    baseURL: modelConfig.base_url,
    apiKey: modelConfig.api_key,
  }
}

/**
 * Resolve provider override directly from a requested model name.
 * Checks for an exact match in agentModels. Does not fuzzy match or normalize case.
 */
export function resolveAgentModelProvider(
  modelName: string | undefined,
  settings: SettingsJson | null,
): ProviderOverride | null {
  if (!settings || !settings.agentModels || !modelName) return null

  const trimmedModelName = modelName.trim()
  const modelConfig = settings.agentModels[trimmedModelName]

  if (modelConfig) {
    return {
      model: trimmedModelName,
      baseURL: modelConfig.base_url,
      apiKey: modelConfig.api_key,
    }
  }

  return null
}

export function resolveAgentRunModelRouting({
  resolvedAgentModel,
  toolSpecifiedModel,
  agentName,
  subagentType,
  agentDefinitionModel,
  settings,
}: {
  resolvedAgentModel: string
  toolSpecifiedModel?: string
  agentName?: string
  subagentType?: string
  agentDefinitionModel?: string
  settings: SettingsJson | null
}): AgentRunModelRouting {
  const toolRequestedModel = toolSpecifiedModel?.trim()
  if (toolRequestedModel) {
    // Tool-specified models are explicit. If the request is not a configured
    // agentModels key, preserve getAgentModel() alias/inherit/custom-ID behavior
    // instead of falling through to persistent agentRouting.
    const providerOverride = resolveAgentModelProvider(toolRequestedModel, settings)
    return {
      mainLoopModel: providerOverride?.model ?? resolvedAgentModel,
      ...(providerOverride && { providerOverride }),
    }
  }

  const providerOverride =
    resolveAgentProvider(agentName, subagentType, settings) ??
    resolveAgentModelProvider(agentDefinitionModel, settings)

  return {
    mainLoopModel: providerOverride?.model ?? resolvedAgentModel,
    ...(providerOverride && { providerOverride }),
  }
}

/**
 * Resolve provider routing for a teammate that will run as its own CLI process.
 *
 * Pane/window teammates do not enter runAgent() in the parent process. They
 * become the child process's main loop, so the child startup path must resolve
 * the same configured agentModels route from its CLI identity.
 */
export function resolveOutOfProcessTeammateProvider({
  cliModel,
  agentName,
  agentType,
  agentDefinitionModel,
  settings,
}: {
  cliModel?: string
  agentName?: string
  agentType?: string
  agentDefinitionModel?: string
  settings: SettingsJson | null
}): ProviderOverride | null {
  const requestedModel = cliModel?.trim()
  if (requestedModel) {
    return resolveAgentModelProvider(requestedModel, settings)
  }

  return (
    resolveAgentProvider(agentName, agentType, settings) ??
    resolveAgentModelProvider(agentDefinitionModel, settings)
  )
}

export function resolveOutOfProcessTeammateProviderFromCliArgs(
  args: readonly string[],
  settings: SettingsJson | null,
): ProviderOverride | null {
  if (hasCliFlag(args, '--provider')) return null

  const agentName = parseCliFlag(args, '--agent-name')
  const teamName = parseCliFlag(args, '--team-name')
  if (!agentName || !teamName) return null

  return resolveOutOfProcessTeammateProvider({
    cliModel: parseCliFlag(args, '--model'),
    agentName,
    agentType: parseCliFlag(args, '--agent-type'),
    settings,
  })
}

function hasCliFlag(args: readonly string[], flag: string): boolean {
  return args.some(arg => arg === flag || arg.startsWith(`${flag}=`))
}

function parseCliFlag(args: readonly string[], flag: string): string | undefined {
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1)
      return value || undefined
    }
  }
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

/**
 * Apply an agentModels provider override to a child process environment.
 *
 * agentModels entries are OpenAI-compatible routes. Clear competing route
 * selectors and stale model/endpoint/header knobs first because provider
 * detection gives several selectors higher priority than CLAUDE_CODE_USE_OPENAI.
 */
export function applyAgentProviderOverrideToEnv(
  providerOverride: ProviderOverride,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  for (const key of PROVIDER_ENV_VARS_TO_CLEAR_FOR_OVERRIDE) {
    delete env[key]
  }

  env.CLAUDE_CODE_USE_OPENAI = '1'
  env.OPENAI_MODEL = providerOverride.model
  env.OPENAI_BASE_URL = providerOverride.baseURL
  env.OPENAI_API_KEY = providerOverride.apiKey
}
