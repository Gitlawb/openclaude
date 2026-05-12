import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'qiniu',
  label: 'Qiniu',
  canonicalVendorId: 'qiniu',
  defaultCapabilities: {
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsPreciseTokenCount: false,
  },
  modelIds: ['deepseek-v3'],
})
