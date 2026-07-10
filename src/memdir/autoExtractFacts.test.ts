import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractFactsIntoMemdir } from './autoExtractFacts.js'

describe('autoExtractFacts', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'auto-extract-facts-test-'))
  })

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true })
  })

  function factsDir(): string {
    return join(memDir, '.facts')
  }

  function countFactFiles(): number {
    const dir = factsDir()
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.md')).length
  }

  it('extracts environment variables', async () => {
    await extractFactsIntoMemdir('export DATABASE_URL=postgres://localhost:5432/mydb', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('database-url'))).toBe(true)
  })

  it('redacts quoted multi-token env values so no residue reaches concept extractors', async () => {
    // The value "my secret password" contains spaces; without proper quoting
    // the individual words would leak into scrubbedContent and get extracted
    // as concept facts.
    await extractFactsIntoMemdir(
      'export SECRET_TOKEN="my secret password"',
      memDir,
    )
    const files = readdirSync(factsDir())
    // env fact should exist
    expect(files.some(f => f.includes('secret-token') || f.includes('SECRET_TOKEN'))).toBe(true)
    // no concept fact should be created from the value tokens
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('secret'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('password'))).toBe(false)
  })

  it('extracts versions', async () => {
    await extractFactsIntoMemdir('upgrade to v2.1.3 and use node v18', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts URLs', async () => {
    await extractFactsIntoMemdir('deployed at https://api.example.com/v1/users', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('redacts credentials, query strings, and fragments from URL facts', async () => {
    await extractFactsIntoMemdir(
      'endpoint https://user:pass@api.example.com/path?secret=token#section here',
      memDir,
    )
    const files = readdirSync(factsDir()).filter(f => f.includes('api-example-com'))
    expect(files.length).toBeGreaterThan(0)
    const content = readFileSync(join(factsDir(), files[0]), 'utf-8')
    expect(content).toContain('https://api.example.com/path')
    expect(content).not.toContain('user:pass')
    expect(content).not.toContain('secret=token')
    expect(content).not.toContain('#section')
  })

  it('extracts absolute paths', async () => {
    await extractFactsIntoMemdir('the config is at /opt/app/config/settings.json', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts backtick concepts', async () => {
    await extractFactsIntoMemdir('call the `PaymentProcessor` service', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('does not extract backtick-wrapped secret-like values', async () => {
    await extractFactsIntoMemdir(
      [
        'use key `sk-live-SUPERSECRET_123` for prod, `ghp_abc123def456ghi789` for CI,',
        'and `AKIAIOSFODNN7EXAMPLE` for AWS. The GitLab token is `glpat-abcdefghijklmnopqrstuvwxyz`.',
      ].join(' '),
      memDir,
    )
    const files = readdirSync(factsDir())
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    // None of the credentials should appear as concept facts
    expect(conceptFacts.some(f => f.includes('sk-live'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('ghp_'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('AKIA'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('glpat-'))).toBe(false)
  })

  it('extracts technical terms with PascalCase', async () => {
    await extractFactsIntoMemdir('the UserAuthentication flow handles login', memDir)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('userauthentication'))).toBe(true)
  })

  it('extracts project file signatures', async () => {
    await extractFactsIntoMemdir('check build.gradle and pom.xml', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts IP addresses', async () => {
    await extractFactsIntoMemdir('connect to 192.168.1.100 or 10.0.0.1', memDir)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('192' ) || f.includes('10'))).toBe(true)
  })

  it('detects React and Redux mentions', async () => {
    await extractFactsIntoMemdir('we use React with Redux', memDir)
    const files = readdirSync(factsDir()).map(f => f.toLowerCase())
    expect(files.some(f => f.includes('react'))).toBe(true)
    expect(files.some(f => f.includes('redux'))).toBe(true)
  })

  it('writes files with proper frontmatter', async () => {
    await extractFactsIntoMemdir('DATABASE_HOST=prod-db-1.internal', memDir)
    const files = readdirSync(factsDir())
    expect(files.length).toBeGreaterThan(0)
    const content = readFileSync(join(factsDir(), files[0]), 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain('type: reference')
  })

  it('handles empty content gracefully', async () => {
    await extractFactsIntoMemdir('', memDir)
    expect(countFactFiles()).toBe(0)
  })
})
