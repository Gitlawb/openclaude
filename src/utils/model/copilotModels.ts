// Model metadata source of truth: src/integrations/modelCatalog/providers/*.json

import {
  getModelMetadata,
  getProviderCatalog,
} from '../../integrations/modelCatalog/catalog.js'

export type CopilotModel = {
  id: string
  name: string
  family: string
  attachment: boolean
  reasoning: boolean
  tool_call: boolean
  temperature: boolean
  knowledge: string
  release_date: string
  last_updated: string
  modalities: {
    input: string[]
    output: string[]
  }
  open_weights: boolean
  cost: {
    input: number
    output: number
    cache_read?: number
  }
  limit: {
    context: number
    input?: number
    output: number
  }
}

function buildCopilotModels(): Record<string, CopilotModel> {
  const catalog = getProviderCatalog('github-copilot')
  if (!catalog) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(catalog.models).map(([id, entry]) => {
      const model = getModelMetadata(id, 'github-copilot') ?? entry
      const copilotModel: CopilotModel = {
        id: model.apiName ?? id,
        name: model.label,
        family: model.family ?? 'unknown',
        attachment: model.capabilities?.vision ?? false,
        reasoning: model.capabilities?.reasoning ?? false,
        tool_call: model.capabilities?.functionCalling ?? false,
        temperature: true,
        knowledge: '',
        release_date: '',
        last_updated: '',
        modalities: {
          input: model.capabilities?.vision ? ['text', 'image'] : ['text'],
          output: ['text'],
        },
        open_weights: false,
        cost: {
          input: model.pricing?.input ?? 0,
          output: model.pricing?.output ?? 0,
          cache_read: model.pricing?.cacheRead,
        },
        limit: {
          context: model.limits?.contextWindow ?? 128000,
          output: model.limits?.maxOutputTokens?.upperLimit ?? 32768,
        },
      }
      return [copilotModel.id, copilotModel]
    }),
  )
}

export const COPILOT_MODELS: Record<string, CopilotModel> = buildCopilotModels()

export function getCopilotModelIds(): string[] {
  return Object.keys(COPILOT_MODELS)
}

export function getCopilotModel(id: string): CopilotModel | undefined {
  return COPILOT_MODELS[id]
}

export function getAllCopilotModels(): CopilotModel[] {
  return Object.values(COPILOT_MODELS)
}
