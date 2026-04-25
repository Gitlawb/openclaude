import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'llama',
  label: 'Llama',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'llama-3.3-70b',
    'llama-3.1-8b',
  ],
})
