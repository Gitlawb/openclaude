import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'mistral',
  label: 'Mistral',
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
    'mistral-large-latest',
    'mistral-small-latest',
    'devstral-latest',
    'ministral-3b-latest',
    'mixtral-8x7b-32768',
    'codestral',
    'mistral:7b',
  ],
})
