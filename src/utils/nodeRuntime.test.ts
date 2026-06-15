import { describe, expect, test } from 'bun:test'

import {
  MIN_NODE_ENGINE_RANGE,
  MIN_NODE_MAJOR,
  MIN_NODE_VERSION,
  checkSupportedNodeVersion,
} from './nodeRuntime.js'

describe('node runtime contract', () => {
  test('matches the package engines contract', async () => {
    const packageJson = await Bun.file(
      new URL('../../package.json', import.meta.url),
    ).json()

    expect(MIN_NODE_MAJOR).toBe(22)
    expect(MIN_NODE_VERSION).toBe('22.0.0')
    expect(MIN_NODE_ENGINE_RANGE).toBe('>=22.0.0')
    expect(packageJson.engines.node).toBe(MIN_NODE_ENGINE_RANGE)
  })

  test('accepts supported Node versions', () => {
    expect(checkSupportedNodeVersion('v22.0.0')).toEqual({
      ok: true,
      version: '22.0.0',
      major: 22,
    })
    expect(checkSupportedNodeVersion('22.0.0')).toEqual({
      ok: true,
      version: '22.0.0',
      major: 22,
    })
    expect(checkSupportedNodeVersion('25.5.0')).toEqual({
      ok: true,
      version: '25.5.0',
      major: 25,
    })
  })

  test('rejects unsupported Node versions with an actionable message', () => {
    expect(checkSupportedNodeVersion('20.11.1')).toEqual({
      ok: false,
      version: '20.11.1',
      major: 20,
      message:
        'Detected 20.11.1. OpenClaude requires Node.js >=22.0.0. Install Node 22 LTS or newer, then reinstall/re-run OpenClaude.',
    })
  })

  test('rejects malformed Node versions with the same required minimum', () => {
    expect(checkSupportedNodeVersion('nightly')).toEqual({
      ok: false,
      version: 'nightly',
      major: null,
      message:
        'Could not parse Node.js version: nightly. OpenClaude requires Node.js >=22.0.0.',
    })
  })
})
