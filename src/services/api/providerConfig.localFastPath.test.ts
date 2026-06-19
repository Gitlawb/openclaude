import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

import { getLocalFastPathConfig } from './providerConfig.js'

const ENV_VAR = 'OPENCLAUDE_LOCAL_FAST_PATH'
const PARSE_ENV = 'OPENAI_PARSE_TEXT_TOOL_CALLS'
const originalEnv = process.env[ENV_VAR]
const originalParseEnv = process.env[PARSE_ENV]

beforeEach(async () => {
  await acquireSharedMutationLock('providerConfig.localFastPath.test.ts')
  delete process.env[ENV_VAR]
  delete process.env[PARSE_ENV]
})

afterEach(() => {
  try {
    if (originalEnv === undefined) {
      delete process.env[ENV_VAR]
    } else {
      process.env[ENV_VAR] = originalEnv
    }
    if (originalParseEnv === undefined) {
      delete process.env[PARSE_ENV]
    } else {
      process.env[PARSE_ENV] = originalParseEnv
    }
  } finally {
    releaseSharedMutationLock()
  }
})

const selfHostedEnv = { [PARSE_ENV]: '1' } as NodeJS.ProcessEnv

describe('getLocalFastPathConfig — profile option (no host/IP detection)', () => {
  test('does not engage from loopback or RFC1918 addresses alone', () => {
    expect(getLocalFastPathConfig('http://localhost:11434/v1').enabled).toBe(false)
    expect(getLocalFastPathConfig('http://192.168.1.10:8000/v1').enabled).toBe(false)
    expect(getLocalFastPathConfig('http://10.0.0.5:8000/v1').enabled).toBe(false)
    expect(getLocalFastPathConfig('http://172.16.5.1:8081/v1').enabled).toBe(false)
    expect(getLocalFastPathConfig('http://gpu-rig.local:11434/v1').enabled).toBe(false)
  })

  test('engages on any base URL when self-hosted compat is enabled', () => {
    const cfg = getLocalFastPathConfig('http://172.16.5.1:8081/v1', selfHostedEnv)
    expect(cfg.enabled).toBe(true)
    expect(cfg.skipStableStringify).toBe(true)
    expect(cfg.skipStrictTools).toBe(true)
    expect(cfg.skipToolHistoryCompression).toBe(true)

    expect(
      getLocalFastPathConfig('http://gpu-box.internal:8081/v1', selfHostedEnv).enabled,
    ).toBe(true)
    expect(
      getLocalFastPathConfig('https://llm.example.com/v1', selfHostedEnv).enabled,
    ).toBe(true)
  })

  test('does not engage on public hosts without the profile option', () => {
    const cfg = getLocalFastPathConfig('https://api.openai.com/v1')
    expect(cfg.enabled).toBe(false)
    expect(cfg.skipStableStringify).toBe(false)
    expect(cfg.skipStrictTools).toBe(false)
    expect(cfg.skipToolHistoryCompression).toBe(false)
  })

  test('does not engage when baseUrl is undefined', () => {
    expect(getLocalFastPathConfig(undefined).enabled).toBe(false)
  })
})

describe('getLocalFastPathConfig — explicit env override', () => {
  test('OPENCLAUDE_LOCAL_FAST_PATH=1 forces on against a public host', () => {
    process.env[ENV_VAR] = '1'
    const cfg = getLocalFastPathConfig('https://api.openai.com/v1')
    expect(cfg.enabled).toBe(true)
    expect(cfg.skipStableStringify).toBe(true)
  })

  test('OPENCLAUDE_LOCAL_FAST_PATH=0 forces off even when self-hosted compat is enabled', () => {
    process.env[ENV_VAR] = '0'
    process.env[PARSE_ENV] = '1'
    const cfg = getLocalFastPathConfig('http://172.16.5.1:8081/v1')
    expect(cfg.enabled).toBe(false)
    expect(cfg.skipStrictTools).toBe(false)
  })

  test('accepts truthy aliases (true / on / yes)', () => {
    for (const v of ['true', 'on', 'yes', 'TRUE', 'On']) {
      process.env[ENV_VAR] = v
      expect(getLocalFastPathConfig('https://api.openai.com/v1').enabled).toBe(true)
    }
  })

  test('accepts falsy aliases (false / off / no)', () => {
    process.env[PARSE_ENV] = '1'
    for (const v of ['false', 'off', 'no', 'FALSE', 'Off']) {
      process.env[ENV_VAR] = v
      expect(getLocalFastPathConfig('http://172.16.5.1:8081/v1').enabled).toBe(false)
    }
  })

  test('"auto" / empty string fall through to profile option', () => {
    process.env[ENV_VAR] = 'auto'
    expect(
      getLocalFastPathConfig('http://172.16.5.1:8081/v1', selfHostedEnv).enabled,
    ).toBe(true)
    expect(getLocalFastPathConfig('https://api.openai.com/v1').enabled).toBe(false)

    process.env[ENV_VAR] = ''
    expect(
      getLocalFastPathConfig('http://172.16.5.1:8081/v1', selfHostedEnv).enabled,
    ).toBe(true)
  })

  test('garbage values fall through to profile option', () => {
    process.env[ENV_VAR] = 'maybe'
    expect(
      getLocalFastPathConfig('http://172.16.5.1:8081/v1', selfHostedEnv).enabled,
    ).toBe(true)
    expect(getLocalFastPathConfig('https://api.openai.com/v1').enabled).toBe(false)
  })

  test('explicit env arg takes precedence over process.env', () => {
    process.env[ENV_VAR] = '0'
    const cfg = getLocalFastPathConfig('https://api.openai.com/v1', {
      [ENV_VAR]: '1',
    } as NodeJS.ProcessEnv)
    expect(cfg.enabled).toBe(true)
  })
})