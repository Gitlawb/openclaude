import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'claude',
  label: 'Claude',
  canonicalVendorId: 'anthropic',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5',
  ],
})
