import { defineBrand } from '../define.js'

export default defineBrand({
  id: 'gemini',
  label: 'Gemini',
  canonicalVendorId: 'gemini',
  defaultCapabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsPreciseTokenCount: false,
  },
  modelIds: [
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-pro',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'google/gemini-2.5-pro',
    'google/gemini-2.0-flash',
  ],
})
