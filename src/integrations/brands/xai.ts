import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'xai',
  label: 'xAI',
  canonicalVendorId: 'xai',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'grok-4.3',
    'grok-4',
    'grok-3',
  ],
})
