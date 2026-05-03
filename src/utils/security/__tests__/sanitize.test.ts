/**
 * Testes para utilitários de sanitização
 */

import { describe, it, expect } from '@jest/globals'
import {
  sanitizeString,
  sanitizeObject,
  sanitizeEnv,
  containsSensitiveData,
} from '../sanitize.js'

describe('sanitizeString', () => {
  it('deve redactar API keys', () => {
    const input = 'API_KEY=sk-ant-1234567890abcdefghij'
    const result = sanitizeString(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('1234567890abcdefghij')
  })

  it('deve redactar tokens Bearer', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    const result = sanitizeString(input)
    expect(result).toContain('[REDACTED]')
  })

  it('deve redactar passwords', () => {
    const input = 'password=mySecretPass123'
    const result = sanitizeString(input)
    expect(result).toContain('[REDACTED]')
  })

  it('deve manter texto normal intacto', () => {
    const input = 'This is a normal string without secrets'
    const result = sanitizeString(input)
    expect(result).toBe(input)
  })

  it('deve redactar múltiplos secrets', () => {
    const input = 'API_KEY=secret1 TOKEN=secret2'
    const result = sanitizeString(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('secret1')
    expect(result).not.toContain('secret2')
  })
})

describe('sanitizeObject', () => {
  it('deve redactar valores de chaves sensíveis', () => {
    const input = {
      username: 'john',
      API_KEY: 'sk-ant-secret123',
      data: 'normal data',
    }
    const result = sanitizeObject(input)
    expect(result.username).toBe('john')
    expect(result.API_KEY).toBe('[REDACTED]')
    expect(result.data).toBe('normal data')
  })

  it('deve processar objetos aninhados', () => {
    const input = {
      config: {
        ANTHROPIC_API_KEY: 'secret',
        timeout: 5000,
      },
    }
    const result = sanitizeObject(input)
    expect(result.config.ANTHROPIC_API_KEY).toBe('[REDACTED]')
    expect(result.config.timeout).toBe(5000)
  })

  it('deve processar arrays', () => {
    const input = ['normal', 'API_KEY=secret', 'data']
    const result = sanitizeObject(input)
    expect(result[0]).toBe('normal')
    expect(result[1]).toContain('[REDACTED]')
    expect(result[2]).toBe('data')
  })

  it('deve prevenir recursão infinita', () => {
    const input: any = { a: 1 }
    input.self = input
    expect(() => sanitizeObject(input, 5)).not.toThrow()
  })
})

describe('sanitizeEnv', () => {
  it('deve redactar variáveis sensíveis', () => {
    const env = {
      HOME: '/home/user',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      PATH: '/usr/bin',
    }
    const result = sanitizeEnv(env)
    expect(result.HOME).toBe('/home/user')
    expect(result.ANTHROPIC_API_KEY).toContain('[REDACTED]')
    expect(result.PATH).toBe('/usr/bin')
  })
})

describe('containsSensitiveData', () => {
  it('deve detectar API keys', () => {
    expect(containsSensitiveData('API_KEY=sk-ant-123456')).toBe(true)
  })

  it('deve detectar tokens', () => {
    expect(containsSensitiveData('token=abc123def456')).toBe(true)
  })

  it('deve retornar false para texto normal', () => {
    expect(containsSensitiveData('normal text')).toBe(false)
  })
})
