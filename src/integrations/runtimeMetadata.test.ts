import { describe, expect, test } from 'bun:test'

import { resolveModelRuntimeLimits } from './runtimeMetadata.js'

describe('resolveModelRuntimeLimits', () => {
  test('uses Gemini 3.5 Flash Vertex metadata instead of fallback limits', () => {
    const limits = resolveModelRuntimeLimits({
      model: 'gemini-3.5-flash',
      processEnv: {
        CLAUDE_CODE_USE_GEMINI_VERTEX: '1',
      },
      activeProfileProvider: 'gemini-vertex',
    })

    expect(limits).toEqual({
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
    })
  })
})
