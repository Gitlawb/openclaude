import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'kimi',
  label: 'Kimi',
  canonicalVendorId: 'moonshot',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'kimi-for-coding',
    'kimi-k2.6',
    'kimi-k2.5',
    'kimi-k2-thinking',
    'kimi-k2-instruct',
    'kimi-k2',
    'moonshot-v1-128k',
    'moonshot-v1-32k',
    'moonshot-v1-8k',
  ],
})
