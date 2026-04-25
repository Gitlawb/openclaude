import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'gpt',
  label: 'GPT',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsPreciseTokenCount: true,
  },
  modelIds: [
    'gpt-5.4',
    'gpt-5-mini',
    'gpt-4o',
    'gpt-4o-mini',
  ],
})
