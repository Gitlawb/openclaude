import { afterEach, expect, mock, test } from 'bun:test'
import axios from 'axios'

import {
  clearVerbooModelsCache,
  fetchVerbooModels,
  getCachedVerbooAgentModelRoles,
  getVerbooAgentModelForRole,
  getVerbooModelReasoning,
  getVerbooReasoningEffort,
} from './verbooModels.js'
import {
  getEffortSuffix,
  resolveAppliedEffort,
  toPersistableEffort,
} from '../../utils/effort.js'

const originalGet = axios.get
const originalEffortLevel = process.env.CLAUDE_CODE_EFFORT_LEVEL

afterEach(() => {
  axios.get = originalGet
  clearVerbooModelsCache()
  if (originalEffortLevel === undefined) {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  } else {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = originalEffortLevel
  }
})

test('uses the router reasoning contract as the model capability source', async () => {
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL
  const get = mock(async () => ({
    data: {
      data: [
        {
          id: 'verboo/reasoner',
          reasoning: {
            effort_levels: ['Fast', 'balanced', 'deep'],
            default_effort: 'BALANCED',
          },
        },
      ],
    },
  }))
  axios.get = get as typeof axios.get

  await expect(
    fetchVerbooModels('access-token', { force: true }),
  ).resolves.toEqual([
    expect.objectContaining({
      id: 'verboo/reasoner',
      reasoning: {
        effortLevels: ['Fast', 'balanced', 'deep'],
        defaultEffort: 'balanced',
      },
    }),
  ])
  expect(getVerbooModelReasoning('verboo/reasoner')).toEqual({
    effortLevels: ['Fast', 'balanced', 'deep'],
    defaultEffort: 'balanced',
  })
  expect(getVerbooReasoningEffort('verboo/reasoner', 'FAST')).toBe('Fast')
  expect(getVerbooReasoningEffort('verboo/reasoner', 'unknown')).toBeUndefined()
  expect(toPersistableEffort('Fast')).toBe('Fast')
  expect(resolveAppliedEffort('verboo/reasoner', undefined)).toBeUndefined()
  expect(resolveAppliedEffort('verboo/reasoner', 'deep')).toBe('deep')
  expect(getEffortSuffix('verboo/reasoner', undefined)).toBe(
    ' with balanced effort',
  )
  expect(getEffortSuffix('verboo/reasoner', 'deep')).toBe(' with deep effort')
})

test('does not advertise reasoning when the router response is incomplete', async () => {
  axios.get = mock(async () => ({
    data: {
      data: [
        {
          id: 'verboo/no-reasoning',
          reasoning: {
            effort_levels: ['low', 'high'],
            default_effort: 'medium',
          },
        },
      ],
    },
  })) as typeof axios.get

  await fetchVerbooModels('access-token', { force: true })

  expect(getVerbooModelReasoning('verboo/no-reasoning')).toBeUndefined()
})

test('keeps a virtual router on server-controlled automatic thinking', async () => {
  process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high'
  axios.get = mock(async () => ({
    data: {
      data: [{
        id: 'ultra/jev-router',
        reasoning: { effort_levels: ['auto'], default_effort: 'auto' },
      }],
    },
  })) as typeof axios.get

  await fetchVerbooModels('access-token', { force: true })

  expect(getVerbooModelReasoning('ultra/jev-router')).toEqual({ effortLevels: ['auto'], defaultEffort: 'auto' })
  expect(resolveAppliedEffort('ultra/jev-router', 'low')).toBeUndefined()
  expect(getEffortSuffix('ultra/jev-router', 'max')).toBe(' with automatic thinking')
})

test('accepts only entitled model IDs for agent catalog roles', async () => {
  axios.get = mock(async () => ({
    data: {
      data: [{ id: 'xiaomi/mimo-v2-flash' }, { id: 'gpt-5.6-sol' }],
      agent_model_roles: {
        explore: 'xiaomi/mimo-v2-flash',
        balanced: 'gpt-5.6-sol',
        review: 'gpt-5.6-sol',
        powerful: 'not-entitled',
        future_role: 'ignored',
        fast: { model: 'future-contract-shape' },
      },
    },
  })) as typeof axios.get

  await fetchVerbooModels('access-token', { force: true })

  expect(getCachedVerbooAgentModelRoles()).toEqual({
    explore: 'xiaomi/mimo-v2-flash',
    balanced: 'gpt-5.6-sol',
    review: 'gpt-5.6-sol',
  })
  expect(getVerbooAgentModelForRole('explore')).toBe('xiaomi/mimo-v2-flash')
  expect(getVerbooAgentModelForRole('powerful')).toBeUndefined()
  expect(getVerbooAgentModelForRole('fast')).toBeUndefined()
})

test('surfaces a model lookup failure instead of treating it as no models', async () => {
  axios.get = mock(async () => {
    throw new Error('timeout of 10000ms exceeded')
  }) as typeof axios.get

  await expect(
    fetchVerbooModels('access-token', { force: true }),
  ).rejects.toThrow('Não foi possível consultar os modelos.')
})
