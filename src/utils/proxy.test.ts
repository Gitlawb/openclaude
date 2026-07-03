import { describe, expect, test } from 'bun:test'
import { shouldBypassProxy } from './proxy.js'

describe('shouldBypassProxy — NO_PROXY matching', () => {
  test('bare domain bypasses the domain and its subdomains', () => {
    // Regression: a bare NO_PROXY entry matched the host exactly only, so a
    // subdomain went THROUGH the proxy on the axios/WebSocket path even though
    // the fetch/undici path (undici EnvHttpProxyAgent, driven by getProxyAgent
    // in this same module) bypasses subdomains for a bare entry. The two paths
    // must agree for the same env var.
    expect(shouldBypassProxy('https://example.com/x', 'example.com')).toBe(true)
    expect(shouldBypassProxy('https://api.example.com/x', 'example.com')).toBe(
      true,
    )
    expect(
      shouldBypassProxy('https://a.b.example.com/x', 'example.com'),
    ).toBe(true)
  })

  test('a lookalike domain is not matched by a bare entry', () => {
    // The subdomain arm requires the leading dot, so a suffix that is not a
    // real subdomain boundary must not bypass.
    expect(shouldBypassProxy('https://notexample.com/x', 'example.com')).toBe(
      false,
    )
    expect(
      shouldBypassProxy('https://example.com.evil.test/x', 'example.com'),
    ).toBe(false)
  })

  test('leading-dot entry keeps matching the apex and subdomains', () => {
    expect(shouldBypassProxy('https://example.com/x', '.example.com')).toBe(
      true,
    )
    expect(shouldBypassProxy('https://api.example.com/x', '.example.com')).toBe(
      true,
    )
    expect(shouldBypassProxy('https://notexample.com/x', '.example.com')).toBe(
      false,
    )
  })

  test('exact host and wildcard still work; empty NO_PROXY never bypasses', () => {
    expect(shouldBypassProxy('http://localhost:3000/x', 'localhost')).toBe(true)
    expect(shouldBypassProxy('https://anything.test/x', '*')).toBe(true)
    expect(shouldBypassProxy('https://example.com/x', undefined)).toBe(false)
    expect(shouldBypassProxy('https://example.com/x', '')).toBe(false)
  })

  test('an IP-address entry is not widened into a subdomain suffix match', () => {
    expect(shouldBypassProxy('https://127.0.0.1/x', '127.0.0.1')).toBe(true)
    // A host that merely ends with the IP text is not a subdomain of it.
    expect(shouldBypassProxy('https://x127.0.0.1/x', '127.0.0.1')).toBe(false)
  })

  test('port-specific entries still require a matching port', () => {
    expect(
      shouldBypassProxy('https://example.com:8080/x', 'example.com:8080'),
    ).toBe(true)
    expect(
      shouldBypassProxy('https://example.com:9090/x', 'example.com:8080'),
    ).toBe(false)
  })
})
