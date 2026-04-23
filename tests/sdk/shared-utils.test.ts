import { describe, test, expect } from 'bun:test'
import {
  assertValidSessionId,
  mapMessageToSDK,
} from '../../src/entrypoints/sdk/shared.js'

describe('assertValidSessionId', () => {
  test('accepts valid UUID v4', () => {
    expect(() => assertValidSessionId('00000000-0000-0000-0000-000000000000')).not.toThrow()
    expect(() => assertValidSessionId('550e8400-e29b-41d4-a716-446655440000')).not.toThrow()
  })

  test('rejects non-UUID string', () => {
    expect(() => assertValidSessionId('not-a-uuid')).toThrow('Invalid session ID')
  })

  test('rejects empty string', () => {
    expect(() => assertValidSessionId('')).toThrow('Invalid session ID')
  })

  test('rejects UUID with wrong format', () => {
    expect(() => assertValidSessionId('00000000-0000-0000-0000')).toThrow('Invalid session ID')
  })

  test('rejects path traversal attempts', () => {
    expect(() => assertValidSessionId('../../etc/passwd')).toThrow('Invalid session ID')
  })
})

describe('mapMessageToSDK', () => {
  test('preserves type field from message', () => {
    const result = mapMessageToSDK({ type: 'assistant', content: 'hello' })
    expect(result.type).toBe('assistant')
  })

  test('defaults to unknown when type is missing', () => {
    const result = mapMessageToSDK({ content: 'hello' })
    expect(result.type).toBe('unknown')
  })

  test('spreads all fields through', () => {
    const msg = {
      type: 'result',
      session_id: 'test-123',
      subtype: 'success',
      cost_usd: 0.01,
    }
    const result = mapMessageToSDK(msg)
    expect((result as any).session_id).toBe('test-123')
    expect((result as any).subtype).toBe('success')
    expect((result as any).cost_usd).toBe(0.01)
  })

  test('preserves nested objects', () => {
    const msg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    }
    const result = mapMessageToSDK(msg)
    expect((result as any).message.content[0].text).toBe('Hello world')
  })
})
