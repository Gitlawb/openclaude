import { AgentDefinitionSchema } from './coreSchemas.js'

type SdkAgentDefinitionInput = {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  maxSteps?: number
}

export type SdkInjectedAgentDefinition = {
  agentType: string
  whenToUse: string
  getSystemPrompt: () => string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  maxSteps?: number
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

export function buildSdkUserAgents(
  userAgents: Record<string, unknown> | undefined,
  reportInvalidAgent: (name: string, errorMessage: string) => void,
): SdkInjectedAgentDefinition[] {
  if (!userAgents || Object.keys(userAgents).length === 0) {
    return []
  }

  return Object.entries(userAgents).flatMap(([name, def]) => {
    if (def === null || typeof def !== 'object' || Array.isArray(def)) {
      reportInvalidAgent(name, 'Agent definition must be an object')
      return []
    }

    const candidate = def as Partial<SdkAgentDefinitionInput>
    const normalizedDef = {
      ...candidate,
      description: candidate.description ?? name,
    }
    const maxTurns = normalizePositiveInteger(candidate.maxTurns)
    const maxSteps = normalizePositiveInteger(candidate.maxSteps)
    if (candidate.maxTurns !== undefined) {
      if (maxTurns === undefined) {
        delete normalizedDef.maxTurns
      } else {
        normalizedDef.maxTurns = maxTurns
      }
    }
    if (candidate.maxSteps !== undefined) {
      if (maxSteps === undefined) {
        delete normalizedDef.maxSteps
      } else {
        normalizedDef.maxSteps = maxSteps
      }
    }

    const parsed = AgentDefinitionSchema().safeParse(normalizedDef)
    if (!parsed.success) {
      reportInvalidAgent(name, parsed.error.message)
      return []
    }

    const data = parsed.data
    return [
      {
        agentType: name,
        whenToUse: data.description,
        getSystemPrompt: () => data.prompt,
        ...(data.tools ? { tools: data.tools } : {}),
        ...(data.disallowedTools
          ? { disallowedTools: data.disallowedTools }
          : {}),
        ...(data.model ? { model: data.model } : {}),
        ...(data.maxTurns !== undefined ? { maxTurns: data.maxTurns } : {}),
        ...(data.maxSteps !== undefined ? { maxSteps: data.maxSteps } : {}),
      },
    ]
  })
}
