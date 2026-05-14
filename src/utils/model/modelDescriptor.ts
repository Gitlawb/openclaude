export type ReasoningEffort = 'low' | 'medium' | 'high'

export type ModelDescriptor = {
  raw: string
  baseModel: string
  reasoning?: {
    effort: ReasoningEffort
  }
}

export const CODEX_ALIAS_MODELS: Record<
  string,
  {
    model: string
    reasoningEffort?: ReasoningEffort
  }
> = {
  codexplan: {
    model: 'gpt-5.5',
    reasoningEffort: 'high',
  },
  'gpt-5.5': {
    model: 'gpt-5.5',
    reasoningEffort: 'high',
  },
  'gpt-5.4': {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  },
  'gpt-5.3-codex': {
    model: 'gpt-5.3-codex',
    reasoningEffort: 'high',
  },
  'gpt-5.3-codex-spark': {
    model: 'gpt-5.3-codex-spark',
  },
  codexspark: {
    model: 'gpt-5.3-codex-spark',
  },
  'gpt-5.2-codex': {
    model: 'gpt-5.2-codex',
    reasoningEffort: 'high',
  },
  'gpt-5.1-codex': {
    model: 'gpt-5.1-codex',
    reasoningEffort: 'high',
  },
  'gpt-5-codex': {
    model: 'gpt-5-codex',
    reasoningEffort: 'high',
  },
  'gpt-4.7-codex': {
    model: 'gpt-4.7-codex',
    reasoningEffort: 'high',
  },
}

export type CodexAlias = keyof typeof CODEX_ALIAS_MODELS

export function isCodexAlias(model: string): model is CodexAlias {
  return model.toLowerCase() in CODEX_ALIAS_MODELS
}

export function parseModelDescriptor(model: string): ModelDescriptor {
  const trimmed = model.trim()
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) {
    const alias = trimmed.toLowerCase() as CodexAlias
    const aliasConfig = CODEX_ALIAS_MODELS[alias]
    if (aliasConfig) {
      return {
        raw: trimmed,
        baseModel: aliasConfig.model,
        reasoning: aliasConfig.reasoningEffort
          ? { effort: aliasConfig.reasoningEffort }
          : undefined,
      }
    }
    return {
      raw: trimmed,
      baseModel: trimmed,
    }
  }

  const baseModel = trimmed.slice(0, queryIndex).trim()
  const params = new URLSearchParams(trimmed.slice(queryIndex + 1))
  const alias = baseModel.toLowerCase() as CodexAlias
  const aliasConfig = CODEX_ALIAS_MODELS[alias]
  const resolvedBaseModel = aliasConfig?.model ?? baseModel

  const reasoningEffort =
    (params.get('reasoning_effort') as ReasoningEffort | null) ??
    aliasConfig?.reasoningEffort

  return {
    raw: trimmed,
    baseModel: resolvedBaseModel,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
  }
}
