import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'qwen',
  label: 'Qwen',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'qwen3.6-plus',
    'qwen3.5-plus',
    'qwen3-coder-plus',
    'qwen3-coder-next',
    'qwen3-max',
    'Qwen/Qwen3.5-9B',
  ],
})
