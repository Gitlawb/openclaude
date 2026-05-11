import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyBenchmarkLatency,
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  rankOllamaModels,
  recommendOllamaModel,
  type OllamaModelDescriptor,
} from './providerRecommendation.ts'

function model(
  name: string,
  overrides: Partial<OllamaModelDescriptor> = {},
): OllamaModelDescriptor {
  return {
    name,
    sizeBytes: null,
    family: null,
    families: [],
    parameterSize: null,
    quantizationLevel: null,
    ...overrides,
  }
}

test('normalizes recommendation goals safely', () => {
  assert.equal(normalizeRecommendationGoal('coding'), 'coding')
  assert.equal(normalizeRecommendationGoal(' LATENCY '), 'latency')
  assert.equal(normalizeRecommendationGoal('weird'), 'balanced')
  assert.equal(normalizeRecommendationGoal(undefined), 'balanced')
})

test('coding goal prefers coding-oriented ollama models', () => {
  const recommended = recommendOllamaModel(
    [
      model('llama3.1:8b', {
        parameterSize: '8B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('qwen2.5-coder:7b', {
        parameterSize: '7B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'coding',
  )

  assert.equal(recommended?.name, 'qwen2.5-coder:7b')
})

test('latency goal prefers smaller models', () => {
  const recommended = recommendOllamaModel(
    [
      model('llama3.1:70b', {
        parameterSize: '70B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('llama3.2:3b', {
        parameterSize: '3B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'latency',
  )

  assert.equal(recommended?.name, 'llama3.2:3b')
})

test('non-chat embedding models are heavily demoted', () => {
  const ranked = rankOllamaModels(
    [
      model('nomic-embed-text', { parameterSize: '0.5B' }),
      model('mistral:7b-instruct', {
        parameterSize: '7B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'balanced',
  )

  assert.equal(ranked[0]?.name, 'mistral:7b-instruct')
})

test('auto-pick ignores non-chat ollama models', () => {
  const recommended = recommendOllamaModel(
    [
      model('nomic-embed-text', { parameterSize: '0.5B' }),
      model('bge-reranker-v2', { parameterSize: '1.5B' }),
      model('whisper-large-v3', { parameterSize: '1.6B' }),
    ],
    'balanced',
  )

  assert.equal(recommended, null)
})

test('benchmark latency can reorder close recommendations', () => {
  const ranked = rankOllamaModels(
    [
      model('llama3.1:8b', {
        parameterSize: '8B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('mistral:7b-instruct', {
        parameterSize: '7B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'latency',
  )

  const benchmarked = applyBenchmarkLatency(
    ranked,
    {
      'llama3.1:8b': 2000,
      'mistral:7b-instruct': 350,
    },
    'latency',
  )

  assert.equal(benchmarked[0]?.name, 'mistral:7b-instruct')
  assert.equal(benchmarked[0]?.benchmarkMs, 350)
})

test('unbenchmarked models stay behind benchmarked candidates', () => {
  const ranked = rankOllamaModels(
    [
      model('phi4-mini:4b', {
        parameterSize: '4B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('mistral:7b-instruct', {
        parameterSize: '7B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('llama3.1:8b', {
        parameterSize: '8B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('qwen2.5:14b', {
        parameterSize: '14B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'latency',
  )

  const benchmarked = applyBenchmarkLatency(
    ranked,
    {
      'phi4-mini:4b': 2400,
      'mistral:7b-instruct': 2200,
      'llama3.1:8b': 2100,
    },
    'latency',
  )

  assert.ok(benchmarked.slice(0, 3).every(item => item.benchmarkMs !== null))
  assert.equal(benchmarked[3]?.name, 'qwen2.5:14b')
  assert.equal(benchmarked[3]?.benchmarkMs, null)
})

test('coding goal recognizes codestral and devstral families', () => {
  const ranked = rankOllamaModels(
    [
      model('mistral:7b-instruct', {
        parameterSize: '7B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('codestral:22b', {
        parameterSize: '22B',
        quantizationLevel: 'Q4_K_M',
      }),
      model('devstral:24b', {
        parameterSize: '24B',
        quantizationLevel: 'Q4_K_M',
      }),
    ],
    'coding',
  )

  assert.deepEqual(ranked.slice(0, 2).map(item => item.name), [
    'devstral:24b',
    'codestral:22b',
  ])
})

test('goal defaults choose sensible openai models', () => {
  assert.equal(getGoalDefaultOpenAIModel('latency'), 'gpt-4o-mini')
  assert.equal(getGoalDefaultOpenAIModel('balanced'), 'gpt-5.5')
  assert.equal(getGoalDefaultOpenAIModel('coding'), 'gpt-5.5')
})
