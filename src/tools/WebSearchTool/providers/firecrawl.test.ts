import { afterEach, describe, expect, test } from 'bun:test'

import { firecrawlProvider } from './firecrawl.ts'

const originalEnv = {
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL: process.env.FIRECRAWL_API_URL,
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv('FIRECRAWL_API_KEY', originalEnv.FIRECRAWL_API_KEY)
  restoreEnv('FIRECRAWL_API_URL', originalEnv.FIRECRAWL_API_URL)
})

describe('firecrawlProvider isConfigured', () => {
  test('true when FIRECRAWL_API_KEY is set only', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    delete process.env.FIRECRAWL_API_URL
    expect(firecrawlProvider.isConfigured()).toBe(true)
  })

  test('true when FIRECRAWL_API_URL is set only', () => {
    process.env.FIRECRAWL_API_KEY = undefined
    process.env.FIRECRAWL_API_URL = 'https://self-hosted.firecrawl.dev'
    expect(firecrawlProvider.isConfigured()).toBe(true)
  })

  test('true when both FIRECRAWL_API_KEY and FIRECRAWL_API_URL are set', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key'
    process.env.FIRECRAWL_API_URL = 'https://self-hosted.firecrawl.dev'
    expect(firecrawlProvider.isConfigured()).toBe(true)
  })

  test('false when neither FIRECRAWL_API_KEY nor FIRECRAWL_API_URL is set', () => {
    delete process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_URL
    expect(firecrawlProvider.isConfigured()).toBe(false)
  })
})
