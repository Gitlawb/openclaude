import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  discoverQiniuModelOptions,
  getCachedQiniuModelOptions,
  isQiniuProvider,
} from './qiniuModels.js'

const SAVED_ENV = {
  QINIU_API_KEY: process.env.QINIU_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

beforeEach(() => {
  delete process.env.QINIU_API_KEY
  delete process.env.OPENAI_BASE_URL
})

afterEach(() => {
  if (SAVED_ENV.QINIU_API_KEY === undefined) {
    delete process.env.QINIU_API_KEY
  } else {
    process.env.QINIU_API_KEY = SAVED_ENV.QINIU_API_KEY
  }
  if (SAVED_ENV.OPENAI_BASE_URL === undefined) {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = SAVED_ENV.OPENAI_BASE_URL
  }
})

test('isQiniuProvider is true when QINIU_API_KEY exists', () => {
  process.env.QINIU_API_KEY = 'qiniu-test-key'
  expect(isQiniuProvider()).toBe(true)
})

test('discoverQiniuModelOptions falls back to default list without API key', async () => {
  const options = await discoverQiniuModelOptions()
  expect(options).toEqual(getCachedQiniuModelOptions())
  expect(options[0]?.value).toBe('deepseek-v3')
})
