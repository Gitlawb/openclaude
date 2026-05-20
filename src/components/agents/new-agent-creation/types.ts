import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'

export type AgentWizardData = {
  location?:
    | 'userSettings'
    | 'projectSettings'
    | 'localSettings'
    | 'flagSettings'
    | 'policySettings'
    | 'built-in'
  generationPrompt?: string
  wasGenerated?: boolean
  generatedAgent?: unknown
  isGenerating?: boolean
  agentType?: string
  whenToUse?: string
  systemPrompt?: string
  selectedTools?: string[]
  selectedModel?: string
  selectedColor?: AgentColorName
  selectedMemory?: AgentMemoryScope
  finalAgent?: any
  [key: string]: unknown
}
