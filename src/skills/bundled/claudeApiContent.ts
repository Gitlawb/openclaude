// Content for the claude-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpClaudeApi from './claude-api/csharp/claude-api.md'
import curlExamples from './claude-api/curl/examples.md'
import goClaudeApi from './claude-api/go/claude-api.md'
import javaClaudeApi from './claude-api/java/claude-api.md'
import phpClaudeApi from './claude-api/php/claude-api.md'
import pythonAgentSdkPatterns from './claude-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './claude-api/python/agent-sdk/README.md'
import pythonClaudeApiBatches from './claude-api/python/claude-api/batches.md'
import pythonClaudeApiFilesApi from './claude-api/python/claude-api/files-api.md'
import pythonClaudeApiReadme from './claude-api/python/claude-api/README.md'
import pythonClaudeApiStreaming from './claude-api/python/claude-api/streaming.md'
import pythonClaudeApiToolUse from './claude-api/python/claude-api/tool-use.md'
import rubyClaudeApi from './claude-api/ruby/claude-api.md'
import skillPrompt from './claude-api/SKILL.md'
import sharedErrorCodes from './claude-api/shared/error-codes.md'
import sharedLiveSources from './claude-api/shared/live-sources.md'
import sharedModels from './claude-api/shared/models.md'
import sharedPromptCaching from './claude-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './claude-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './claude-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './claude-api/typescript/agent-sdk/README.md'
import typescriptClaudeApiBatches from './claude-api/typescript/claude-api/batches.md'
import typescriptClaudeApiFilesApi from './claude-api/typescript/claude-api/files-api.md'
import typescriptClaudeApiReadme from './claude-api/typescript/claude-api/README.md'
import typescriptClaudeApiStreaming from './claude-api/typescript/claude-api/streaming.md'
import typescriptClaudeApiToolUse from './claude-api/typescript/claude-api/tool-use.md'
import {
  getAllModelsForProvider,
  getDefaultModelIdForProvider,
  getModelMetadata,
} from '../../integrations/modelCatalog/catalog.js'
import type { ModelDefaultRole } from '../../integrations/modelCatalog/types.js'

function requireDefaultClaudeModel(role: ModelDefaultRole) {
  const modelId = getDefaultModelIdForProvider('anthropic', role)
  const metadata = modelId ? getModelMetadata(modelId, 'anthropic') : undefined
  if (!metadata) {
    throw new Error(`Missing default Anthropic catalog model for role "${role}"`)
  }
  return metadata
}

function getVersionParts(modelId: string): number[] {
  return modelId.match(/\d+/g)?.map(Number) ?? []
}

function compareVersionParts(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

function requirePreviousDefaultClaudeModel(role: ModelDefaultRole) {
  const currentModel = requireDefaultClaudeModel(role)
  const candidates = getAllModelsForProvider('anthropic')
    .filter(
      model =>
        model.family === currentModel.family &&
        model.id !== currentModel.id &&
        model.status !== 'hidden',
    )
    .sort((left, right) =>
      compareVersionParts(getVersionParts(right.id), getVersionParts(left.id)),
    )
  const previousModel = candidates[0]
  if (!previousModel) {
    throw new Error(`Missing previous Anthropic catalog model for role "${role}"`)
  }
  return previousModel
}

const opusModel = requireDefaultClaudeModel('opus')
const sonnetModel = requireDefaultClaudeModel('sonnet')
const haikuModel = requireDefaultClaudeModel('haiku')
const previousSonnetModel = requirePreviousDefaultClaudeModel('sonnet')

export const SKILL_MODEL_VARS = {
  OPUS_ID: opusModel.id,
  OPUS_NAME: opusModel.ui?.marketingName ?? opusModel.label,
  SONNET_ID: sonnetModel.id,
  SONNET_NAME: sonnetModel.ui?.marketingName ?? sonnetModel.label,
  HAIKU_ID: haikuModel.id,
  HAIKU_NAME: haikuModel.ui?.marketingName ?? haikuModel.label,
  PREV_SONNET_ID: previousSonnetModel.id,
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/claude-api.md': csharpClaudeApi,
  'curl/examples.md': curlExamples,
  'go/claude-api.md': goClaudeApi,
  'java/claude-api.md': javaClaudeApi,
  'php/claude-api.md': phpClaudeApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/claude-api/README.md': pythonClaudeApiReadme,
  'python/claude-api/batches.md': pythonClaudeApiBatches,
  'python/claude-api/files-api.md': pythonClaudeApiFilesApi,
  'python/claude-api/streaming.md': pythonClaudeApiStreaming,
  'python/claude-api/tool-use.md': pythonClaudeApiToolUse,
  'ruby/claude-api.md': rubyClaudeApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/claude-api/README.md': typescriptClaudeApiReadme,
  'typescript/claude-api/batches.md': typescriptClaudeApiBatches,
  'typescript/claude-api/files-api.md': typescriptClaudeApiFilesApi,
  'typescript/claude-api/streaming.md': typescriptClaudeApiStreaming,
  'typescript/claude-api/tool-use.md': typescriptClaudeApiToolUse,
}
