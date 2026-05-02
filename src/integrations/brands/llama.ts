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
    'llama-3.3-70b-versatile',
    'llama-3.3-70b',
    'llama-3.1-8b-instant',
    'llama-3.1-8b',
    'llama3.3:70b',
    'llama3.2:3b',
    'llama3.2:1b',
    'llama3.1:8b',
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
    'meta/llama-3.2-90b-instruct',
    'meta/llama-3.2-3b-instruct',
    'meta/llama-3.2-1b-instruct',
    'meta/llama-3.3-70b-instruct',
  ],
})
