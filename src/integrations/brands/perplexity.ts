import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'perplexity',
  label: 'Perplexity',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsJsonMode: false,
    supportsReasoning: false,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'sonar-pro',
    'sonar',
    'sonar-reasoning-pro',
    'sonar-reasoning',
    'sonar-deep-research',
  ],
})
