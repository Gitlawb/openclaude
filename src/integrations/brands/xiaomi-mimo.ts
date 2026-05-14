import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'xiaomi-mimo',
  label: 'Xiaomi MiMo',
  canonicalVendorId: 'xiaomi-mimo',
  defaultCapabilities: {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'mimo-v2.5-pro',
    'mimo-v2-pro',
    'mimo-v2.5',
    'mimo-v2-omni',
    'mimo-v2-flash',
  ],
})
