import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getLocalFastPathConfig } from './providerConfig.js'

const ENV_VAR = 'OPENCLAUDE_LOCAL_FAST_PATH'
const originalEnv = process.env[ENV_VAR]

beforeEach(() => {
  delete process.env[ENV_VAR]
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_VAR]
  } else {
    process.env[ENV_VAR] = originalEnv
  }
})

describe('getLocalFastPathConfig — auto-detect from baseUrl', () => {
  test('engages on loopback', () => {
    const cfg = getLocalFastPathConfig('http://localhost:11434/v1')
    expect(cfg.enabled).toBe(true)
    expect(cfg.skipStableStringify).toBe(true)
    expect(cfg.skipStrictTools).toBe(true)
    expect(cfg.skipToolHistoryCompression).toBe(true)
  })

  test('engages on private IPv4', () => {
    expect(getLocalFastPathConfig('http://192.168.1.10:8000/v1').enabled).toBe(true)
    expect(getLocalFastPathConfig('http://10.0.0.5:8000/v1').enabled).toBe(true)
    expect(getLocalFastPathConfig('http://172.16.5.1:8000/v1').enabled).toBe(true)
  })

  test('engages on .local hostnames', () => {
    expect(getLocalFastPathConfig('http://gpu-rig.local:11434/v1').enabled).toBe(true)
  })

  test('does not engage on public hosts', () => {
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

  test('OPENCLAUDE_LOCAL_FAST_PATH=0 forces off against localhost', () => {
    process.env[ENV_VAR] = '0'
    const cfg = getLocalFastPathConfig('http://localhost:11434/v1')
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
    for (const v of ['false', 'off', 'no', 'FALSE', 'Off']) {
      process.env[ENV_VAR] = v
      expect(getLocalFastPathConfig('http://localhost:11434/v1').enabled).toBe(false)
    }
  })

  test('"auto" / empty string fall through to baseUrl detection', () => {
    process.env[ENV_VAR] = 'auto'
    expect(getLocalFastPathConfig('http://localhost:11434/v1').enabled).toBe(true)
    expect(getLocalFastPathConfig('https://api.openai.com/v1').enabled).toBe(false)

    process.env[ENV_VAR] = ''
    expect(getLocalFastPathConfig('http://localhost:11434/v1').enabled).toBe(true)
  })

  test('garbage values fall through to auto-detect', () => {
    process.env[ENV_VAR] = 'maybe'
    expect(getLocalFastPathConfig('http://localhost:11434/v1').enabled).toBe(true)
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
