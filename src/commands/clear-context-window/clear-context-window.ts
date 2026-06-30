import type { LocalCommandCall } from '../../types/command.js'
import {
  clearSessionContextWindowOverride,
  getSessionContextWindowOverrides,
} from '../../utils/context.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (!trimmed) {
    clearSessionContextWindowOverride()
    return { type: 'text', value: 'All context window overrides cleared for this session.' }
  }

  clearSessionContextWindowOverride(trimmed)
  const remaining = getSessionContextWindowOverrides()
  if (remaining.size === 0) {
    return { type: 'text', value: `Context window override for "${trimmed}" cleared. No overrides remaining.` }
  }
  return { type: 'text', value: `Context window override for "${trimmed}" cleared. ${remaining.size} override(s) remaining.` }
}
