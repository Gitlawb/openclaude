/**
 * iFlytek Spark (星火) vendor descriptor.
 *
 * Spark provides an OpenAI-compatible /v1/chat/completions endpoint
 * with Bearer token auth at https://spark-api-open.xf-yun.com
 */
import { defineCatalog, defineVendor } from '../define.js'

const catalog = defineCatalog({
  source: 'static',
  models: [
    {
      id: 'spark-generalv4.0',
      apiName: 'generalv4.0',
      label: 'Spark 4.0 Ultra',
      notes: 'Latest flagship model - best reasoning',
    },
    {
      id: 'spark-generalv4',
      apiName: 'generalv4',
      label: 'Spark 4.0',
      notes: 'High-capability model',
    },
    {
      id: 'spark-generalv3.5',
      apiName: 'generalv3.5',
      label: 'Spark 3.5',
      notes: 'Balanced performance',
    },
    {
      id: 'spark-general',
      apiName: 'general',
      label: 'Spark 2.0',
      notes: 'Standard model',
    },
    {
      id: 'spark-pro-128k',
      apiName: 'pro-128k',
      label: 'Spark Pro 128K',
      notes: 'Extended context window (128K)',
    },
    {
      id: 'spark-lite',
      apiName: 'lite',
      label: 'Spark Lite',
      notes: 'Fast & low cost',
    },
    {
      id: 'spark-max-32k',
      apiName: 'max-32k',
      label: 'Spark Max 32K',
      notes: 'High performance (32K context)',
    },
    {
      id: 'spark-4.0Ultra',
      apiName: '4.0Ultra',
      label: 'Spark 4.0 Ultra',
      notes: 'Premium reasoning model',
    },
  ],
})

export default defineVendor({
  id: 'spark',
  label: 'iFlytek Spark',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
  defaultModel: 'generalv3.5',
  requiredEnvVars: ['SPARK_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['SPARK_API_KEY'],
    setupPrompt: 'Enter your Spark API Password (APIPassword from the Spark console).',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      maxTokensField: 'max_tokens',
    },
  },
  preset: {
    id: 'spark',
    description: 'iFlytek Spark OpenAI-compatible endpoint',
    apiKeyEnvVars: ['SPARK_API_KEY'],
    baseUrlEnvVars: ['SPARK_BASE_URL'],
    modelEnvVars: ['SPARK_MODEL'],
  },
  catalog,
  usage: {
    supported: false,
  },
})
