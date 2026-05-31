import { describe, expect, test } from 'bun:test'
import { resolveProviderRequest } from './providerConfig.js'

describe('SSRF protection in resolveProviderRequest', () => {
  test('blocks cloud metadata endpoint 169.254.169.254 and falls back to default', () => {
    const result = resolveProviderRequest({
      baseUrl: 'http://169.254.169.254/latest/meta-data/',
    })
    // Should NOT use the metadata URL — should fall back to a safe default
    expect(result.baseUrl).not.toContain('169.254.169.254')
    expect(result.baseUrl).toContain('api.openai.com')
  })

  test('blocks GCP metadata endpoint and falls back', () => {
    const result = resolveProviderRequest({
      baseUrl: 'http://metadata.google.internal/computeMetadata/v1/',
    })
    expect(result.baseUrl).not.toContain('metadata.google.internal')
  })

  test('blocks private IP 10.x.x.x and falls back', () => {
    const result = resolveProviderRequest({
      baseUrl: 'http://10.0.0.1:8080/v1',
    })
    expect(result.baseUrl).not.toContain('10.0.0.1')
  })

  test('blocks private IP 192.168.x.x and falls back', () => {
    const result = resolveProviderRequest({
      baseUrl: 'http://192.168.1.100:3000/v1',
    })
    expect(result.baseUrl).not.toContain('192.168.1.100')
  })

  test('allows localhost (for local providers like Ollama)', () => {
    const result = resolveProviderRequest({
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(result.baseUrl).toContain('localhost:11434')
  })

  test('allows public URLs', () => {
    const result = resolveProviderRequest({
      baseUrl: 'https://api.example.com/v1',
    })
    expect(result.baseUrl).toContain('api.example.com')
  })
})
