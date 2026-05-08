import { defineGateway } from '../define.js'

/**
 * AWS Bedrock has dedicated transport behavior that is not yet fully
 * normalized into the generic descriptor model. It relies on ambient
 * AWS credentials and uses a separate runtime path.
 *
 * Do not collapse this into generic OpenAI-compatible routing.
 */
export default defineGateway({
  id: 'bedrock',
  label: 'AWS Bedrock',
  vendorId: 'anthropic',
  category: 'hosted',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'adc',
  },
  transportConfig: {
    kind: 'bedrock',
  },
  usage: { supported: false },
})
