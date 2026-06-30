import { AgentDefinitionSchema } from './coreSchemas.js'

export type SdkAgentDefinitionInput = {
  description?: string
  prompt: string
  /**
   * Tool allowlist for this agent. If omitted or set to ['*'], the agent can use
   * all tools available to subagents after disallowedTools is applied.
   */
  tools?: string[]
  /**
   * Tool denylist for this agent. Deny entries always override tools entries.
   */
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  maxSteps?: number
}

export type SdkInjectedAgentDefinition = {
  agentType: string
  whenToUse: string
  getSystemPrompt: () => string
  source: 'sdk'
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  maxSteps?: number
}

export type SdkMergeableAgentDefinition = {
  agentType: string
  source: string
}

export type SdkAgentDefinitionSet<
  TAgent extends SdkMergeableAgentDefinition = SdkMergeableAgentDefinition,
> = {
  activeAgents: TAgent[]
  allAgents: TAgent[]
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
        source: 'sdk',
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

export function mergeSdkUserAgents<TAgent extends SdkMergeableAgentDefinition>(
  agentDefs: SdkAgentDefinitionSet<TAgent>,
  userAgents: SdkInjectedAgentDefinition[],
): SdkAgentDefinitionSet<TAgent | SdkInjectedAgentDefinition> {
  if (userAgents.length === 0) {
    return agentDefs
  }

  const protectedAgentTypes = new Set(
    agentDefs.activeAgents
      .filter(agent => agent.source === 'policySettings')
      .map(agent => agent.agentType),
  )
  const activeUserAgents = userAgents.filter(
    agent => !protectedAgentTypes.has(agent.agentType),
  )
  const activeUserAgentTypes = new Set(
    activeUserAgents.map(agent => agent.agentType),
  )
  return {
    ...agentDefs,
    activeAgents: [
      ...agentDefs.activeAgents.filter(
        agent => !activeUserAgentTypes.has(agent.agentType),
      ),
      ...activeUserAgents,
    ],
    allAgents: [...agentDefs.allAgents, ...userAgents],
  }
}
