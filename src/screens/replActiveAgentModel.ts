import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import {
  getDefaultMainLoopModelSetting,
  type ModelSetting,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'

type ActiveSessionAgentModelSelection =
  | {
      shouldUpdateModel: false
      mainLoopModelForSession?: undefined
    }
  | {
      shouldUpdateModel: true
      mainLoopModelForSession: ModelSetting
    }

export function getActiveSessionAgentModelSelection({
  agent,
  baseMainLoopModel,
  hasExplicitModelOverride,
  hasAgentManagedModel,
}: {
  agent: AgentDefinition
  baseMainLoopModel: ModelSetting | undefined
  hasExplicitModelOverride: boolean
  hasAgentManagedModel: boolean
}): ActiveSessionAgentModelSelection {
  if (hasExplicitModelOverride) {
    return { shouldUpdateModel: false }
  }

  if (agent.model && agent.model !== 'inherit') {
    return {
      shouldUpdateModel: true,
      mainLoopModelForSession: parseUserSpecifiedModel(agent.model),
    }
  }

  if (!hasAgentManagedModel) {
    return { shouldUpdateModel: false }
  }

  return {
    shouldUpdateModel: true,
    mainLoopModelForSession:
      baseMainLoopModel ?? getDefaultMainLoopModelSetting(),
  }
}
