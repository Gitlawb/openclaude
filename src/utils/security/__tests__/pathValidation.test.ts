/**
 * Testes para validação de paths
 */

import { describe, it, expect } from '@jest/globals'
import * as path from 'path'
import {
  validatePath,
  isPathSafe,
  sanitizeFilename,
  PathTraversalError,
  DangerousPathError,
} from '../pathValidation.js'

describe('validatePath', () => {
  const baseDir = '/home/user/project'

  it('deve aceitar path válido dentro do baseDir', () => {
    const result = validatePath('src/index.ts', baseDir)
    expect(result).toContain('src')
    expect(result).toContain('index.ts')
  })

  it('deve rejeitar path traversal com ..', () => {
    expect(() => validatePath('../../../etc/passwd', baseDir)).toThrow(
      PathTraversalError
    )
  })

  it('deve rejeitar path absoluto fora do baseDir', () => {
    expect(() => validatePath('/etc/passwd', baseDir)).toThrow(
      PathTraversalError
    )
  })

  it('deve rejeitar caracteres de controle', () => {
    expect(() => validatePath('file\x00name.txt', baseDir)).toThrow(
      DangerousPathError
    )
  })

  it('deve aceitar path com espaços', () => {
    const result = validatePath('my file.txt', baseDir)
    expect(result).toContain('my file.txt')
  })

  it('deve normalizar path corretamente', () => {
    const result = validatePath('./src/../src/index.ts', baseDir)
    expect(result).toContain('src')
    expect(result).toContain('index.ts')
  })
})

describe('isPathSafe', () => {
  it('deve retornar true para paths seguros', () => {
    expect(isPathSafe('src/index.ts')).toBe(true)
    expect(isPathSafe('my-file.txt')).toBe(true)
  })

  it('deve retornar false para path traversal', () => {
    expect(isPathSafe('../../../etc/passwd')).toBe(false)
  })

  it('deve retornar false para caracteres perigosos', () => {
    expect(isPathSafe('file\x00name.txt')).toBe(false)
  })

  it('deve retornar false para string vazia', () => {
    expect(isPathSafe('')).toBe(false)
  })
})

describe('sanitizeFilename', () => {
  it('deve remover path separators', () => {
    const result = sanitizeFilename('path/to/file.txt')
    expect(result).not.toContain('/')
    expect(result).toContain('file.txt')
  })

  it('deve remover caracteres perigosos', () => {
    const result = sanitizeFilename('file<>:"|?*.txt')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain(':')
  })

  it('deve remover dots no início', () => {
    const result = sanitizeFilename('...hidden.txt')
    expect(result).not.toMatch(/^\./)
  })

  it('deve limitar tamanho a 255 caracteres', () => {
    const longName = 'a'.repeat(300) + '.txt'
    const result = sanitizeFilename(longName)
    expect(result.length).toBeLessThanOrEqual(255)
    expect(result).toContain('.txt')
  })

  it('deve lançar erro se resultado for vazio', () => {
    expect(() => sanitizeFilename('...')).toThrow()
  })
})
