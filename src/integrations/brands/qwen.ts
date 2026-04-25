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
  ],
})
