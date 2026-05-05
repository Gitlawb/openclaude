import { expect, test } from 'bun:test'
import spark from './spark.js'

test('spark vendor descriptor has correct identity', () => {
  expect(spark.id).toBe('spark')
  expect(spark.label).toBe('iFlytek Spark')
  expect(spark.classification).toBe('openai-compatible')
})

test('spark vendor descriptor has correct defaults', () => {
  expect(spark.defaultBaseUrl).toBe(
    'https://spark-api-open.xf-yun.com/v1/chat/completions',
  )
  expect(spark.defaultModel).toBe('generalv3.5')
  expect(spark.requiredEnvVars).toEqual(['SPARK_API_KEY'])
})

test('spark vendor descriptor has correct auth setup', () => {
  expect(spark.setup.requiresAuth).toBe(true)
  expect(spark.setup.authMode).toBe('api-key')
  expect(spark.setup.credentialEnvVars).toEqual(['SPARK_API_KEY'])
})

test('spark vendor descriptor has correct transport config', () => {
  expect(spark.transportConfig.kind).toBe('openai-compatible')
  const shim = spark.transportConfig.openaiShim
  expect(shim?.supportsApiFormatSelection).toBe(false)
  expect(shim?.supportsAuthHeaders).toBe(false)
  expect(shim?.maxTokensField).toBe('max_tokens')
})

test('spark vendor descriptor has preset metadata', () => {
  expect(spark.preset).toBeDefined()
  expect(spark.preset?.id).toBe('spark')
  expect(spark.preset?.apiKeyEnvVars).toEqual(['SPARK_API_KEY'])
  expect(spark.preset?.baseUrlEnvVars).toEqual(['SPARK_BASE_URL'])
  expect(spark.preset?.modelEnvVars).toEqual(['SPARK_MODEL'])
})

test('spark vendor descriptor has static catalog with 8 models', () => {
  expect(spark.catalog?.source).toBe('static')
  const models = spark.catalog?.models ?? []
  expect(models).toHaveLength(8)
})

test('spark catalog contains expected model api names', () => {
  const apiNames = spark.catalog?.models?.map(m => m.apiName) ?? []
  expect(apiNames).toContain('generalv4.0')
  expect(apiNames).toContain('generalv4')
  expect(apiNames).toContain('generalv3.5')
  expect(apiNames).toContain('general')
  expect(apiNames).toContain('pro-128k')
  expect(apiNames).toContain('lite')
  expect(apiNames).toContain('max-32k')
  expect(apiNames).toContain('4.0Ultra')
})

test('spark vendor usage is unsupported', () => {
  expect(spark.usage?.supported).toBe(false)
})
