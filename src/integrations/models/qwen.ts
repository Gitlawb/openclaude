import { defineModel } from '../define.js'

const qwenCapabilities = {
  supportsVision: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsReasoning: true,
  supportsPreciseTokenCount: false,
}

function qwenModel(
  id: string,
  label: string,
  contextWindow: number,
  maxOutputTokens: number,
) {
  return defineModel({
    id,
    label,
    brandId: 'qwen',
    vendorId: 'openai',
    classification: ['chat', 'reasoning', 'vision', 'coding'],
    defaultModel: id,
    capabilities: qwenCapabilities,
    contextWindow,
    maxOutputTokens,
  })
}

export default [
  qwenModel('qwen3.6-plus', 'Qwen 3.6 Plus', 1_000_000, 65_536),
  qwenModel('qwen3.5-plus', 'Qwen 3.5 Plus', 1_000_000, 65_536),
  qwenModel('qwen3-coder-plus', 'Qwen 3 Coder Plus', 1_000_000, 65_536),
  qwenModel('qwen3-coder-next', 'Qwen 3 Coder Next', 262_144, 65_536),
  qwenModel('qwen3-max', 'Qwen 3 Max', 262_144, 32_768),
  qwenModel('Qwen/Qwen3.5-9B', 'Qwen 3.5 9B', 128_000, 32_768),
]
