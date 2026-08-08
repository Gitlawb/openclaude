import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'tencent',
  label: 'Tencent',
  canonicalVendorId: 'openai',
  defaultCapabilities: {
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: ['tencent/hy3'],
})
