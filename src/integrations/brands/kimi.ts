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
    'kimi-k2.5',
    'kimi-k2.6',
  ],
})
