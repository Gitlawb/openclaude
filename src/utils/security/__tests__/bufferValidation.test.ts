/**
 * Testes para validação de Buffer
 */

import { describe, it, expect } from '@jest/globals'
import {
  safeBase64Decode,
  safeBase64Encode,
  safeBufferFrom,
  safeBufferAlloc,
  safeBufferConcat,
  estimateBase64DecodedSize,
  BufferSizeError,
} from '../bufferValidation.js'

describe('estimateBase64DecodedSize', () => {
  it('deve estimar tamanho corretamente', () => {
    const base64 = 'SGVsbG8gV29ybGQ=' // "Hello World"
    const estimated = estimateBase64DecodedSize(base64)
    expect(estimated).toBe(11)
  })

  it('deve ignorar padding', () => {
    const base64 = 'SGVsbG8=' // "Hello"
    const estimated = estimateBase64DecodedSize(base64)
    expect(estimated).toBe(5)
  })
})

describe('safeBase64Decode', () => {
  it('deve decodificar base64 válido', () => {
    const base64 = 'SGVsbG8gV29ybGQ='
    const result = safeBase64Decode(base64)
    expect(result.toString()).toBe('Hello World')
  })

  it('deve rejeitar input muito grande', () => {
    const largeBase64 = 'A'.repeat(20_000_000)
    expect(() => safeBase64Decode(largeBase64, 1000)).toThrow(BufferSizeError)
  })

  it('deve rejeitar input vazio', () => {
    expect(() => safeBase64Decode('')).toThrow()
  })

  it('deve rejeitar input não-string', () => {
    expect(() => safeBase64Decode(null as any)).toThrow()
  })
})

describe('safeBase64Encode', () => {
  it('deve codificar buffer para base64', () => {
    const buffer = Buffer.from('Hello World')
    const result = safeBase64Encode(buffer)
    expect(result).toBe('SGVsbG8gV29ybGQ=')
  })

  it('deve rejeitar buffer muito grande', () => {
    const largeBuffer = Buffer.alloc(2000)
    expect(() => safeBase64Encode(largeBuffer, 1000)).toThrow(BufferSizeError)
  })

  it('deve rejeitar input não-buffer', () => {
    expect(() => safeBase64Encode('not a buffer' as any)).toThrow()
  })
})

describe('safeBufferFrom', () => {
  it('deve criar buffer de string', () => {
    const result = safeBufferFrom('Hello')
    expect(result.toString()).toBe('Hello')
  })

  it('deve criar buffer de ArrayBuffer', () => {
    const ab = new ArrayBuffer(5)
    const result = safeBufferFrom(ab)
    expect(result.length).toBe(5)
  })

  it('deve rejeitar string muito grande', () => {
    const largeString = 'A'.repeat(100_000_000)
    expect(() => safeBufferFrom(largeString, undefined, 1000)).toThrow(
      BufferSizeError
    )
  })
})

describe('safeBufferAlloc', () => {
  it('deve alocar buffer com tamanho válido', () => {
    const result = safeBufferAlloc(10)
    expect(result.length).toBe(10)
  })

  it('deve rejeitar tamanho muito grande', () => {
    expect(() => safeBufferAlloc(2000, undefined, undefined, 1000)).toThrow(
      BufferSizeError
    )
  })

  it('deve rejeitar tamanho negativo', () => {
    expect(() => safeBufferAlloc(-10)).toThrow()
  })

  it('deve aceitar fill', () => {
    const result = safeBufferAlloc(5, 'A')
    expect(result.toString()).toBe('AAAAA')
  })
})

describe('safeBufferConcat', () => {
  it('deve concatenar buffers', () => {
    const buf1 = Buffer.from('Hello')
    const buf2 = Buffer.from(' World')
    const result = safeBufferConcat([buf1, buf2])
    expect(result.toString()).toBe('Hello World')
  })

  it('deve rejeitar tamanho total muito grande', () => {
    const buf1 = Buffer.alloc(600)
    const buf2 = Buffer.alloc(600)
    expect(() => safeBufferConcat([buf1, buf2], 1000)).toThrow(BufferSizeError)
  })

  it('deve rejeitar input não-array', () => {
    expect(() => safeBufferConcat('not an array' as any)).toThrow()
  })

  it('deve rejeitar items não-buffer', () => {
    expect(() => safeBufferConcat(['not a buffer'] as any)).toThrow()
  })
})
