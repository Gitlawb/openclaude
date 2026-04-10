import { resolveProviderRequest } from '../../services/api/providerConfig.js'
import {
  isOpenAIEffortLevel,
  resolveAppliedEffort,
  type EffortValue,
} from '../effort.js'

function getCodexDisplayEffort(
  model: string,
  effortValue: EffortValue | undefined,
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  const resolvedEffort = resolveAppliedEffort(model, effortValue)
  return typeof resolvedEffort === 'string' && isOpenAIEffortLevel(resolvedEffort)
    ? resolvedEffort
    : undefined
}

export function formatCodexModelDisplay(options: {
  model: string
  effortValue?: EffortValue
  fastMode?: boolean
}): string {
  const resolved = resolveProviderRequest({
    model: options.model,
    reasoningEffortOverride: getCodexDisplayEffort(
      options.model,
      options.effortValue,
    ),
  })

  const parts = [resolved.resolvedModel]
  if (resolved.reasoning?.effort) {
    parts.push(resolved.reasoning.effort)
  }
  if (options.fastMode) {
    parts.push('fast')
  }
  return parts.join(' ')
}
