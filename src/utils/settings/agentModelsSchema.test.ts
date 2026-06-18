import { expect, test } from 'bun:test'
import { SettingsSchema } from './types.js'

test('agentModels accepts a model-only entry (no base_url/api_key)', () => {
  const result = SettingsSchema().safeParse({
    agentModels: { mini: { model: 'gpt-5-mini' } },
    agentRouting: { verification: 'mini' },
  })
  expect(result.success).toBe(true)
})

test('agentModels accepts a bare entry whose key is the model name', () => {
  const result = SettingsSchema().safeParse({
    agentModels: { 'gpt-5-mini': {} },
    agentRouting: { verification: 'gpt-5-mini' },
  })
  expect(result.success).toBe(true)
})

test('agentModels still accepts a full cross-provider entry', () => {
  const result = SettingsSchema().safeParse({
    agentModels: {
      ds: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-ds' },
    },
    agentRouting: { verification: 'ds' },
  })
  expect(result.success).toBe(true)
})

test('agentModels rejects a non-URL base_url', () => {
  const result = SettingsSchema().safeParse({
    agentModels: { bad: { base_url: 'not-a-url', api_key: 'sk' } },
  })
  expect(result.success).toBe(false)
})
