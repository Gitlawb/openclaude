import { defineModel } from '../define.js'

const glmCapabilities = {
  supportsVision: false,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsPreciseTokenCount: false,
}

function glmModel(
  id: string,
  label: string,
  contextWindow: number,
  maxOutputTokens: number,
) {
  return defineModel({
    id,
    label,
    brandId: 'glm',
    vendorId: 'zai',
    classification: ['chat', 'reasoning', 'coding'],
    defaultModel: id,
    capabilities: glmCapabilities,
    contextWindow,
    maxOutputTokens,
  })
}

export default [
  defineModel({
    id: 'glm-5v-turbo',
    label: 'GLM 5V Turbo',
    brandId: 'glm',
    vendorId: 'zai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: 'glm-5v-turbo',
    capabilities: {
      ...glmCapabilities,
      supportsVision: true,
    },
    contextWindow: 202_752,
    maxOutputTokens: 131_072,
  }),
  glmModel('glm-5.2', 'GLM 5.2', 1_000_000, 131_072),
  glmModel('GLM-5.1', 'GLM-5.1', 202_752, 131_072),
  glmModel('GLM-5-Turbo', 'GLM-5-Turbo', 202_752, 131_072),
  glmModel('GLM-5', 'GLM-5', 202_752, 131_072),
  glmModel('GLM-4.7', 'GLM-4.7', 202_752, 131_072),
  glmModel('GLM-4.5-Air', 'GLM-4.5-Air', 128_000, 65_536),
  glmModel('glm-5.1', 'GLM 5.1', 202_752, 16_384),
  glmModel('glm-5-turbo', 'GLM 5 Turbo', 202_752, 16_384),
  glmModel('glm-5', 'GLM 5', 202_752, 16_384),
  glmModel('glm-4.7', 'GLM 4.7', 202_752, 16_384),
  glmModel('glm-4.6', 'GLM 4.6', 202_752, 202_752),
  glmModel('glm-4.5-air', 'GLM 4.5 Air', 128_000, 16_384),
]
