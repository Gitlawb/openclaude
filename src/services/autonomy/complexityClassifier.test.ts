import { describe, expect, test } from 'bun:test'
import { classifyComplexity } from './complexityClassifier.js'

describe('classifyComplexity', () => {
  test('short greeting is trivial', () => {
    expect(classifyComplexity({ text: 'olá' }).tier).toBe('trivial')
  })

  test('single file fix is standard', () => {
    const r = classifyComplexity({
      text: 'Corrige o bug no arquivo src/foo.ts na função parse',
    })
    expect(r.tier).toBe('standard')
  })

  test('architecture multi-module is hard', () => {
    const r = classifyComplexity({
      text: 'Redesenha a arquitetura de autenticação em vários módulos e propõe migration',
    })
    expect(r.tier).toBe('hard')
  })

  test('image mention is vision', () => {
    const r = classifyComplexity({
      text: 'Analisa este screenshot',
      hasImage: true,
    })
    expect(r.tier).toBe('vision')
  })

  test('vision keywords without attachment still vision', () => {
    const r = classifyComplexity({
      text: 'Descreva o que aparece na imagem anexada do dashboard',
    })
    expect(r.tier).toBe('vision')
  })

  test('multi-file hint is hard', () => {
    const r = classifyComplexity({
      text: 'Atualize several files across the codebase for the new API',
    })
    expect(r.tier).toBe('hard')
  })

  test('empty text defaults to standard', () => {
    expect(classifyComplexity({ text: '' }).tier).toBe('standard')
  })

  test('reasons are non-empty', () => {
    const r = classifyComplexity({ text: 'hello there' })
    expect(r.reasons.length).toBeGreaterThan(0)
  })
})
