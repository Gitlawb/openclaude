import { describe, expect, test } from 'bun:test'

import '../index.js'
import {
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  resolveRouteIdFromBaseUrl,
} from '../routeMetadata.js'

describe('xiaomi-mimo-token gateway', () => {
  test('default base URL is the token-plan SGP endpoint', () => {
    expect(getRouteDefaultBaseUrl('xiaomi-mimo-token')).toBe(
      'https://token-plan-sgp.xiaomimimo.com/v1',
    )
  })

  test('default model is mimo-v2.5-pro', () => {
    expect(getRouteDefaultModel('xiaomi-mimo-token')).toBe('mimo-v2.5-pro')
  })

  test('resolves token-plan SGP base URL', () => {
    expect(
      resolveRouteIdFromBaseUrl('https://token-plan-sgp.xiaomimimo.com/v1'),
    ).toBe('xiaomi-mimo-token')
  })

  test('resolves token-plan CN base URL', () => {
    expect(
      resolveRouteIdFromBaseUrl('https://token-plan-cn.xiaomimimo.com/v1'),
    ).toBe('xiaomi-mimo-token')
  })

  test('resolves token-plan chat completions path', () => {
    expect(
      resolveRouteIdFromBaseUrl(
        'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
      ),
    ).toBe('xiaomi-mimo-token')
  })
})
