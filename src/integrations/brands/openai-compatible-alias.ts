import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'openai-compatible-alias',
  label: 'OpenAI-Compatible Alias',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsPreciseTokenCount: false,
  },
})
